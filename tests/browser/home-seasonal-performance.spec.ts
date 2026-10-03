import { expect, test, type Page } from '@playwright/test';
import type { HomeSeasonalAppearance } from '../../src/home-collection-settings';

type Layers = { layers?: { drawsContent: boolean }[] };
const cards = (page: Page) => page.locator('#homeTab [data-home-row="seasonal-films"] .tvl-home-row-card');

async function fixture(page: Page, count: number, reveal: 'doors' | 'curtains' | 'advent') {
  const theme = reveal === 'advent' ? 'christmas' : 'halloween';
  const style = theme === 'halloween' ? 'nightmare' : 'photoreal';
  const appearance: HomeSeasonalAppearance = { theme, background: 'parallax', expansion: 'large', frame: true, reveal,
    backgroundStyle: style, frameStyle: style, coverStyle: style, ...(reveal === 'advent' ? { adventUnlock: 'focus' } : {}) };
  const base = { kind: 'items', title: 'Seasonal films', collectionIds: ['collection-coast'], ranked: true,
    placement: 'start', itemSort: 'collection', itemOrder: [] };
  const settings = { version: 1, rows: [{ ...base, id: 'season', kind: 'seasonal', title: '', collectionIds: [], children: [
    { ...base, id: 'seasonal-films', season: { start: '01-01', end: '12-31' }, appearance }
  ] }] };
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const session = await page.context().newCDPSession(page);
  let layers = 0;
  await session.send('LayerTree.enable');
  session.on('LayerTree.layerTreeDidChange', (event: Layers) => { layers = event.layers?.filter(layer => layer.drawsContent).length || 0; });
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(()=>{
      const api=window.TvItemLayoutDemo.api,members=api.getCollectionItems,image=api.image;
      api.homeCollections={isCurrent:()=>true,load:async()=>({Revision:'effect-budget',Settings:${JSON.stringify(settings)}}),save:async()=>{throw new Error('Unexpected write')}};
      api.getCollectionItems=async id=>{const found=await members(id);return id==='collection-coast'?Array.from({length:${count}},(_,i)=>({...found[i%found.length],Id:'effect-film-'+i,Name:'Seasonal film '+(i+1)})):found;};
      api.image=(item,kind)=>image(item.Id.startsWith('effect-film-')?{...item,Id:Number(item.Id.slice(12))%2?'movie-blue':'movie-tide'}:item,kind);
    })();` });
  });
  await page.goto('/?featured=0&layout=tv#/home');
  await expect(cards(page)).toHaveCount(count);
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await page.locator('.skinHeader .emby-tab-button[data-index="0"]').focus();
  await expect(page.locator('.tvl-seasonal-item-open')).toHaveCount(0);
  await expect(page.locator('.tvl-seasonal-reveal-active')).toHaveCount(0);
  await expect.poll(() => layers).toBeGreaterThan(0);
  // The browser removes completed animation layers asynchronously after style settlement.
  await page.waitForTimeout(600);
  return { layers: () => layers, failures };
}

for (const reveal of ['doors', 'curtains', 'advent'] as const) {
  test(`sixty ${reveal} cards keep a bounded compositor budget and reveal normally`, async ({ page, context }) => {
    // A two-card reference includes the actual native Home, frame filters and scenery.
    // The regression was allocating persistent 3D layers for every closed/offscreen door.
    const reference = await context.newPage();
    const small = await fixture(reference, 2, reveal);
    const baseline = small.layers();
    await reference.close();
    const full = await fixture(page, 60, reveal);
    await expect.poll(full.layers).toBeLessThanOrEqual(baseline + 6);
    const geometry = await cards(page).locator('.tvl-home-row-art').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height };
    }));
    expect(geometry.every(rect => rect.width > 0 && rect.height > 0 && Math.abs(rect.width - geometry[0].width) < .1 && Math.abs(rect.height - geometry[0].height) < .1)).toBe(true);
    const first = cards(page).first();
    await first.focus();
    await expect(first).toHaveClass(/tvl-seasonal-item-open/);
    if (reveal === 'curtains') await expect(page.locator('.tvl-seasonal-reveal-active')).toHaveCount(0);
    else await expect(first).toHaveClass(/tvl-seasonal-reveal-active/);
    await expect.poll(full.layers).toBeLessThanOrEqual(baseline + 12);
    await page.keyboard.press('ArrowRight');
    await expect(cards(page).nth(1)).toBeFocused();
    await expect(first).not.toHaveClass(/tvl-seasonal-item-open/);
    await expect(cards(page).nth(1)).toHaveClass(/tvl-seasonal-item-open/);
    await expect(first).not.toHaveClass(/tvl-seasonal-reveal-active/);
    await expect.poll(full.layers).toBeLessThanOrEqual(baseline + 12);
    const after = await first.locator('.tvl-home-row-art').boundingBox();
    expect(after?.width).toBeCloseTo(geometry[0].width, 1);
    expect(after?.height).toBeCloseTo(geometry[0].height, 1);
    await page.locator('.skinHeader .emby-tab-button[data-index="0"]').focus();
    await expect(page.locator('.tvl-seasonal-item-open')).toHaveCount(0);
    await expect(page.locator('.tvl-seasonal-reveal-active')).toHaveCount(0);
    await expect.poll(full.layers).toBeLessThanOrEqual(baseline + 6);
    await expect(cards(page)).toHaveCount(60);
    expect(full.failures).toEqual([]);
  });
}
