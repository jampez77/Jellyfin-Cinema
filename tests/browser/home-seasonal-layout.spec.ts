import { expect, test } from '@playwright/test';

test('legacy webOS numeric CSSOM cannot keep seasonal Home in a style-mutation loop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    const audit = { writes: 0, stoppedLoop: false, heartbeat: 0 };
    (window as typeof window & { seasonalLayoutAudit: typeof audit }).seasonalLayoutAudit = audit;
    window.setInterval(() => audit.heartbeat++, 50);
    const set = CSSStyleDeclaration.prototype.setProperty;
    const cssText = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText')!;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (!name.startsWith('--tvl-seasonal-') || !value || !/^\d+(?:\.\d+)?px$/.test(value)) return set.call(this, name, value, priority);
      // Chromium 79 stores numeric custom-property tokens and serializes them
      // to six significant digits. Reassigning the unrounded value emits a new
      // style mutation even though the serialized text looks unchanged.
      if (++audit.writes > 100) { audit.stoppedLoop = true; return; }
      const serialized = `${Number(Number.parseFloat(value).toPrecision(6))}px`;
      set.call(this, name, serialized, priority);
      if (serialized !== value) cssText.set!.call(this, this.cssText);
    };
  });
  const settings = { version: 1, rows: [{ id: 'seasons', kind: 'seasonal', title: '', collectionIds: [], ranked: false,
    placement: 'start', itemSort: 'collection', itemOrder: [], children: [{ id: 'spooky', kind: 'items', title: 'Spooky Season',
      collectionIds: ['collection-coast'], ranked: false, placement: 'start', itemSort: 'collection', itemOrder: [],
      season: { start: '01-01', end: '12-31' }, appearance: { theme: 'halloween', background: 'static', expansion: 'large',
        frame: false, reveal: 'none', backgroundStyle: 'nightmare' } }] }] };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(()=>{
      const api=window.TvItemLayoutDemo.api,members=api.getCollectionItems;
      api.homeCollections={isCurrent:()=>true,load:async()=>({Revision:'legacy-layout',Settings:${JSON.stringify(settings)}}),save:async()=>{throw new Error('Unexpected write')}};
      api.getCollectionItems=async id=>{const found=await members(id);return id==='collection-coast'?Array.from({length:60},(_,i)=>({...found[i%found.length],Id:'season-film-'+i})):found;};
      const style=document.createElement('style');style.textContent='[data-home-row="spooky"] {min-height:485px;box-sizing:content-box}';document.head.append(style);
    })();` });
  });
  await page.goto('/?featured=0&layout=tv#/home');
  const row = page.locator('#homeTab [data-home-row="spooky"]');
  const cards = row.locator('.tvl-home-row-card');
  await expect(cards).toHaveCount(60);
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  const audit = () => page.evaluate(() => (window as typeof window & { seasonalLayoutAudit: { writes: number; stoppedLoop: boolean; heartbeat: number } }).seasonalLayoutAudit);
  expect((await audit()).stoppedLoop).toBe(false);
  await expect.poll(() => row.evaluate(node => parseFloat((node as HTMLElement).style.getPropertyValue('--tvl-seasonal-space')))).toBeCloseTo(38.3, 1);
  const before = await audit();
  await expect.poll(async () => (await audit()).heartbeat).toBeGreaterThan(before.heartbeat + 2);
  expect((await audit()).writes).toBe(before.writes);
  await cards.first().focus();
  await expect(row).toHaveClass(/tvl-seasonal-expanded/);
  await expect(cards.first()).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 960 });
  // Native Home reports layout changes through the same observer used on TV.
  await row.evaluate(node => node.classList.add('native-layout-resized'));
  await expect.poll(() => row.evaluate(node => parseFloat((node as HTMLElement).style.getPropertyValue('--tvl-seasonal-space')))).toBeCloseTo(131.9, 1);
  await page.locator('.skinHeader .emby-tab-button[data-index="0"]').focus();
  await expect(row).not.toHaveClass(/tvl-seasonal-expanded/);
  const after = await audit();
  await expect.poll(async () => (await audit()).heartbeat).toBeGreaterThan(after.heartbeat + 2);
  expect((await audit()).writes).toBe(after.writes);
  expect((await audit()).stoppedLoop).toBe(false);
  await expect(cards).toHaveCount(60);
  expect(errors).toEqual([]);
});
