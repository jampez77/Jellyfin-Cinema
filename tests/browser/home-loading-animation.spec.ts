import { expect, test, type Page } from '@playwright/test';
import { defaultProviderHomes } from '../../src/provider-settings';

const collection = '#homeTab [data-home-row="long-row"]';
const loader = (page: Page) => page.getByRole('status', { name: 'Loading Home', exact: true });
async function fixture(page: Page, hold = false) {
  await page.addInitScript(() => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify({ version: 1, rows: [
    { id: 'long-row', kind: 'items', title: 'Weekend films', collectionIds: ['collection-coast'], ranked: true, placement: 'end' }
  ] })));
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api=window.TvItemLayoutDemo.api, members=api.getCollectionItems, item=api.getItem;
      const state=window.__homeLoading={hold:${hold},calls:0,releases:[],release(){this.hold=false;this.releases.splice(0).forEach(resolve=>resolve());}};
      api.getCollectionItems=async id=>{const found=await members(id);state.calls++;
        if(state.hold&&id==='collection-coast')await new Promise(resolve=>state.releases.push(resolve));
        return id==='collection-coast'?Array.from({length:20},(_,i)=>({...found[i%found.length],Id:'scroll-film-'+i,Name:'Weekend film '+(i+1)})):found;};
      api.getItem=async id=>id.startsWith('scroll-film-')?{...await item('movie-tide'),Id:id,Name:'Weekend film '+(Number(id.slice(12))+1)}:item(id);
    })();` });
  });
}
async function release(page: Page) { await page.evaluate(() => (window as any).__homeLoading.release()); }
async function waiting(page: Page) { await expect.poll(() => page.evaluate(() => (window as any).__homeLoading.releases.length)).toBeGreaterThan(0); }
async function ready(page: Page) { await expect(page.locator(`${collection} button.tvl-home-row-card`)).toHaveCount(20); await expect(loader(page)).toHaveCount(0); }
async function capture(page: Page) {
  return page.evaluate(() => ({
    document: document.scrollingElement!.scrollTop,
    nested: document.querySelector('#indexPage')!.scrollTop,
    horizontal: document.querySelector('.tvl-home-collection-row .tvl-home-row-cards')?.scrollLeft || 0,
    focus: (document.activeElement as HTMLElement).dataset.focusId || (document.activeElement as HTMLElement).dataset.id
  }));
}

test('cinema loading art stays in the viewport above a deeply scrolled transformed Home', async ({ page }, info) => {
  await fixture(page, true); await page.goto('/?featured=0&layout=tv#/home'); await waiting(page);
  await page.evaluate(() => { const home=document.querySelector<HTMLElement>('#homeTab')!; home.style.transform='translate3d(0,0,0)'; home.style.minHeight='5000px'; window.scrollTo(0,2300); });
  await expect(loader(page)).toBeVisible();
  const bounds=await loader(page).boundingBox(); expect(bounds).toEqual({x:0,y:0,width:1440,height:900});
  expect(await loader(page).evaluate(node=>node.parentElement===document.body)).toBe(true);
  expect(await page.locator('.tvl-home-loading-reel').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('tvl-cinema-reel');
  await expect(page.locator('#homeTab')).toHaveAttribute('aria-busy','true');
  await page.screenshot({path:info.outputPath('cinema-loading-tv.png')});
  await release(page); await ready(page); await expect(page.locator('#homeTab')).not.toHaveAttribute('aria-busy','true');
});

test('reduced motion keeps a static accessible projector and leaving Home removes every loading element', async ({ page }, info) => {
  await page.emulateMedia({reducedMotion:'reduce'}); await fixture(page,true); await page.goto('/?featured=0&layout=desktop#/home'); await waiting(page);
  await expect(loader(page)).toHaveAttribute('aria-live','polite');
  expect(await loader(page).locator('*').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none'))).toBe(true);
  await page.screenshot({path:info.outputPath('cinema-loading-desktop-static.png')});
  await page.evaluate(()=>{location.hash='/mypreferencesmenu';});
  await expect(loader(page)).toHaveCount(0); await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await release(page); await expect(page.locator('.tvl-home-loading-status')).toHaveCount(0);
});

test('direct Favourites stays visible while cached Home collections are still loading', async ({ page }) => {
  await fixture(page,true);await page.goto('/?featured=0&layout=tv#/home?tab=1');await waiting(page);
  await expect(page.locator('#favoritesTab')).toBeVisible();await expect(loader(page)).toHaveCount(0);
  await expect(page.locator('#homeTab')).toHaveClass(/hide/);
  await release(page);await expect(loader(page)).toHaveCount(0);await expect(page.locator('#favoritesTab')).toBeVisible();
});

test('switching to Favourites hides the loader immediately and returning to pending Home restores it', async ({ page }) => {
  await fixture(page,true);await page.goto('/?featured=0&layout=tv#/home');await waiting(page);await expect(loader(page)).toBeVisible();
  const tabs=page.getByRole('navigation',{name:'Home tabs',exact:true});
  await tabs.getByRole('button',{name:'Favourites',exact:true}).click();
  await expect(loader(page)).toHaveCount(0);await expect(page.locator('#favoritesTab')).toBeVisible();
  await tabs.getByRole('button',{name:'Home',exact:true}).click();await expect(loader(page)).toBeVisible();
  await release(page);await ready(page);
});

for (const nested of [false,true]) test(`Back restores exact ${nested?'native page':'document'} position and custom row offset before its background members arrive`, async ({ page }) => {
  await page.setViewportSize({width:1080,height:720}); await fixture(page); await page.goto('/?featured=0&layout=tv#/home'); await ready(page);
  if(nested)await page.addStyleTag({content:'#indexPage { height:100vh;box-sizing:border-box;overflow-y:auto; }'});
  const target=page.locator(`${collection} button.tvl-home-row-card`).nth(14); await target.focus();
  await target.evaluate((node,nested)=>{
    const row=node.closest('.tvl-home-row-cards')!; row.scrollLeft+=node.getBoundingClientRect().left-row.getBoundingClientRect().left-140;
    const owner=nested?document.querySelector('#indexPage')!:document.scrollingElement!;
    owner.scrollTop+=node.getBoundingClientRect().top-220;
  },nested);
  const saved=await capture(page); expect(saved.horizontal).toBeGreaterThan(1500); expect(nested?saved.nested:saved.document).toBeGreaterThan(500);
  await page.evaluate(()=>{(window as any).__homeLoading.hold=true;});
  await page.keyboard.press('Enter'); await expect(page.getByRole('dialog',{name:'Weekend film 15 details',exact:true})).toBeVisible();
  await page.keyboard.press('Escape'); await waiting(page); await ready(page); await expect(target).toBeFocused();
  await expect.poll(()=>capture(page)).toEqual(saved);
  await release(page); await ready(page); await expect(target).toBeFocused();
  await expect.poll(()=>capture(page)).toEqual(saved);
});

test('native card Back preserves the focused card, scroll owner and transform-based row position', async ({ page }) => {
  await fixture(page); await page.goto('/?featured=0&layout=tv#/home'); await ready(page);
  const target=page.locator('#homeTab [aria-label="Latest in Movies"] button').first();
  await target.evaluate(node=>{
    const scroller=node.closest('.emby-scroller') as any; let position=-67;
    scroller.getScrollPosition=()=>position;
    scroller.scrollToPosition=(next:number)=>{position=next;scroller.firstElementChild.style.transform='translateX('+next+'px)';};
    scroller.scrollToPosition(position);node.focus({preventScroll:true});window.scrollTo(0,node.getBoundingClientRect().top+window.scrollY-250);
  });
  const saved=await capture(page); expect(saved.document).toBeGreaterThan(500);
  await page.evaluate(()=>{(window as any).__homeLoading.hold=true;});
  await page.keyboard.press('Enter'); await expect(page.getByRole('dialog', {name:/ details$/})).toBeVisible();
  await target.evaluate(node=>(node.closest('.emby-scroller') as any).scrollToPosition(0));
  await page.goBack(); await waiting(page); await ready(page);
  await expect(target).toBeFocused(); await expect.poll(()=>capture(page)).toEqual(saved);
  await release(page); await ready(page); await expect(target).toBeFocused(); await expect.poll(()=>capture(page)).toEqual(saved);
  expect(await target.evaluate(node=>(node.closest('.emby-scroller') as any).getScrollPosition())).toBe(-67);
});

test('fresh header focus while returning takes priority over saved Home position', async ({ page }) => {
  await fixture(page); await page.goto('/?featured=0&layout=desktop#/home'); await ready(page);
  const target=page.locator(`${collection} button.tvl-home-row-card`).nth(12); await target.focus();
  await page.evaluate(()=>{(window as any).__homeLoading.hold=true;}); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', {name:/ details$/})).toBeVisible(); await page.keyboard.press('Escape'); await waiting(page); await ready(page);
  const settings=page.locator('.skinHeader').getByRole('link',{name:'Settings',exact:true}); await settings.focus();
  await page.mouse.wheel(0,-500); const before=await capture(page); await release(page); await ready(page);
  await expect(settings).toBeFocused(); expect((await capture(page)).document).toBe(before.document);
});

test('returning from a service restores its tile and the exact lower Home position', async ({ page }) => {
  const providers=defaultProviderHomes();providers.placement='end';
  await page.addInitScript(providers=>localStorage.setItem(`jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`,JSON.stringify(providers)),providers);
  await fixture(page);await page.goto('/?featured=0&layout=tv#/home');await ready(page);
  const netflix=page.locator('#homeTab [data-provider="netflix"]'); await netflix.focus();
  await netflix.evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+window.scrollY-160));
  const saved=await capture(page);expect(saved.document).toBeGreaterThan(500);
  await page.evaluate(()=>{(window as any).__homeLoading.hold=true;});await page.keyboard.press('Enter');
  const service=page.getByRole('dialog',{name:'Netflix home',exact:true});await expect(service).toBeVisible();
  await service.getByRole('button',{name:'Back',exact:true}).click();await waiting(page);await ready(page);
  await expect(netflix).toBeFocused();await expect.poll(()=>capture(page)).toEqual(saved);
  await release(page);await ready(page);await expect(netflix).toBeFocused();await expect.poll(()=>capture(page)).toEqual(saved);
});

test('saved Home position is isolated from another account on the same cached host', async ({ page }) => {
  await fixture(page);await page.goto('/?featured=0&layout=tv#/home');await ready(page);
  const target=page.locator(`${collection} button.tvl-home-row-card`).nth(12);await target.focus();
  await target.evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+window.scrollY-180));
  expect((await capture(page)).document).toBeGreaterThan(500);
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:/ details$/})).toBeVisible();
  await page.evaluate(()=>{window.TvItemLayoutDemo!.api.userId='another-account';window.scrollTo(0,0);location.hash='/home';});
  await expect(loader(page)).toHaveCount(0);
  await expect(page.locator('#homeTab .tvl-provider-tile').first()).toBeFocused();
  await expect(page.locator(collection)).toHaveCount(0);expect((await capture(page)).document).toBe(0);
});
