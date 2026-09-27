import { expect, test, type Page } from '@playwright/test';
import { parseHomeCollections } from '../../src/home-collection-settings';
import { defaultProviderHomes } from '../../src/provider-settings';

const settings = parseHomeCollections({ version: 1, rows: [{ id: 'weekend', kind: 'items', title: 'Weekend films', collectionIds: ['collection-coast'], ranked: true, placement: 'end' }] });
const row = (page: Page) => page.locator('#homeTab [data-home-row="weekend"]');
const cards = (page: Page) => row(page).locator('.tvl-home-row-card');
const loader = (page: Page) => page.getByRole('status', { name: 'Loading Home', exact: true });

async function fixture(page: Page, empty = false) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api=window.TvItemLayoutDemo.api, members=api.getCollectionItems, item=api.getItem, list=api.getCollectionList;
      const state=window.__warmHome={settings:${JSON.stringify(empty ? { version: 1, rows: [] } : settings)},providers:${JSON.stringify(defaultProviderHomes())},count:20,
        holdSettings:false,holdMembers:false,holdList:false,pendingSettings:[],pendingMembers:[],pendingList:[],settingsReads:0,memberReads:0,loaderMounts:0,
        releaseList(){this.holdList=false;this.pendingList.splice(0).forEach(resolve=>resolve());},
        releaseSettings(){this.holdSettings=false;this.pendingSettings.splice(0).forEach(resolve=>resolve());},
        releaseMembers(){this.holdMembers=false;this.pendingMembers.splice(0).forEach(resolve=>resolve());}};
      api.homeCollections={isCurrent:()=>true,load:async()=>{state.settingsReads++;if(state.holdSettings)await new Promise(resolve=>state.pendingSettings.push(resolve));return {Revision:'rows',Settings:state.settings};},save:async()=>{throw new Error('Unexpected write');}};
      api.providerHomes={isCurrent:()=>true,load:async()=>{state.settingsReads++;if(state.holdSettings)await new Promise(resolve=>state.pendingSettings.push(resolve));return {Revision:'providers',Settings:state.providers};},save:async()=>{throw new Error('Unexpected write');}};
      api.getCollectionList=async()=>{if(state.holdList)await new Promise(resolve=>state.pendingList.push(resolve));return list();};
      api.getCollectionItems=async id=>{
        const found=await members(id);if(id!=='collection-coast')return found;state.memberReads++;
        if(state.holdMembers)await new Promise(resolve=>state.pendingMembers.push(resolve));
        return Array.from({length:state.count},(_,i)=>({...found[i%found.length],Id:'warm-film-'+i,Name:'Weekend film '+(i+1)}));};
      api.getItem=async id=>id.startsWith('warm-film-')?{...await item('movie-tide'),Id:id,Name:'Weekend film '+(Number(id.slice(10))+1)}:item(id);
    })();` });
  });
  await page.goto('/?featured=0&layout=desktop#/home');
  await expect(cards(page)).toHaveCount(empty ? 0 : 20);
  await expect(page.locator('#homeTab .tvl-provider-tile').first()).toBeVisible(); await expect(loader(page)).toHaveCount(0);
}
async function holdAndLeave(page: Page) {
  const target = cards(page).nth(12); await target.focus();
  await target.evaluate(node => {
    const strip = node.closest('.tvl-home-row-cards')!;
    strip.scrollLeft += node.getBoundingClientRect().left - strip.getBoundingClientRect().left - 100;
    window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 220);
  });
  const saved = await position(page);
  await page.evaluate(() => { const state=(window as any).__warmHome; state.holdSettings=true; state.holdMembers=true; });
  await page.keyboard.press('Enter'); await expect(page.getByRole('dialog', { name: 'Weekend film 13 details', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state=(window as any).__warmHome;
    new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node instanceof Element && (node.matches('.tvl-home-loading-status') || node.querySelector('.tvl-home-loading-status'))) state.loaderMounts++;
      }));
      if (state.returnStarted !== undefined && state.returnReady === undefined
        && document.querySelector('#homeTab [data-home-row="weekend"] .tvl-home-row-card')?.getClientRects().length)
        state.returnReady=performance.now()-state.returnStarted;
    }).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','hidden','style'] });
  });
  return saved;
}
async function position(page: Page) {
  return page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollTop,
    horizontal: document.querySelector('#homeTab [data-home-row="weekend"] .tvl-home-row-cards')?.scrollLeft || 0,
    focus: (document.activeElement as HTMLElement).dataset.focusId
  }));
}
async function returnHome(page: Page) {
  await page.evaluate(() => { (window as any).__warmHome.returnStarted=performance.now(); });
  await page.goBack();
}
async function expectWarm(page: Page) {
  await expect(cards(page)).toHaveCount(20, { timeout: 1_000 });
  await expect(row(page)).toBeVisible(); await expect(loader(page)).toHaveCount(0);
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  expect(await page.evaluate(() => (window as any).__warmHome.loaderMounts)).toBe(0);
  const elapsed = await page.evaluate(() => (window as any).__warmHome.returnReady as number);
  expect(elapsed).toBeLessThan(1_000);
  await test.info().attach('warm-return-ms', { body: String(elapsed), contentType: 'text/plain' });
}
async function release(page: Page) {
  await page.evaluate(() => { const state=(window as any).__warmHome; state.releaseSettings(); state.releaseMembers(); });
}

test('Back rebuilds cached rows immediately while both account settings and membership refresh are held', async ({ page }) => {
  await fixture(page); const saved = await holdAndLeave(page);
  expect(saved.vertical).toBeGreaterThan(500); expect(saved.horizontal).toBeGreaterThan(1500);
  await returnHome(page); await expectWarm(page);
  await expect.poll(() => page.evaluate(() => (window as any).__warmHome.pendingSettings.length)).toBeGreaterThan(0);
  await expect.poll(() => position(page)).toEqual(saved);
  await release(page); await expect(cards(page)).toHaveCount(20);
  await expect.poll(() => position(page)).toEqual(saved); await expect(loader(page)).toHaveCount(0);
});

test('warm Home applies new settings and members in the background without losing the returned card or scroll', async ({ page }) => {
  await fixture(page); const saved = await holdAndLeave(page);
  await page.evaluate(() => {
    const state=(window as any).__warmHome;
    state.settings={...state.settings,rows:state.settings.rows.map((row: any)=>({...row,title:'Fresh weekend films'}))};
    state.count=21;
  });
  await returnHome(page); await expectWarm(page); await expect.poll(() => position(page)).toEqual(saved);
  await page.evaluate(() => (window as any).__warmHome.releaseSettings());
  await expect.poll(() => page.evaluate(() => (window as any).__warmHome.pendingMembers.length)).toBeGreaterThan(0);
  await expect(cards(page)).toHaveCount(20); await expect(loader(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).__warmHome.releaseMembers());
  await expect(row(page)).toHaveAttribute('aria-label', 'Fresh weekend films'); await expect(cards(page)).toHaveCount(21);
  await expect.poll(() => position(page)).toEqual(saved); await expect(loader(page)).toHaveCount(0);
});

test('another account cannot reuse the first account’s warm rows while its own preferences are pending', async ({ page }) => {
  await fixture(page); await holdAndLeave(page);
  await page.evaluate(() => {
    const state=(window as any).__warmHome;
    state.settings={version:1,rows:[]};state.providers={...state.providers,enabled:false};
    window.TvItemLayoutDemo!.api.userId='kids';location.hash='/home';
  });
  await expect.poll(() => page.evaluate(() => (window as any).__warmHome.pendingSettings.length)).toBeGreaterThan(0);
  await expect(row(page)).toHaveCount(0); await expect(loader(page)).toBeVisible();
  await release(page); await expect(loader(page)).toHaveCount(0);
  await expect(row(page)).toHaveCount(0); await expect(page.locator('#homeTab .tvl-provider-tile')).toHaveCount(0);
});

for (const savedLocally of [true, false]) test(`adding the first collection ${savedLocally ? 'on this device' : 'on another device'} leaves cached service tiles usable while its catalogue loads`, async ({ page }) => {
  await fixture(page, true);
  await page.locator('#homeTab [aria-label="Latest in Movies"] button').first().click();
  await expect(page.getByRole('dialog', { name: / details$/ })).toBeVisible();
  await page.evaluate(({ settings, savedLocally }) => {
    const state=(window as any).__warmHome; state.settings=settings; state.holdList=true;
    // Same-device saves update the local account cache. Another device's save
    // arrives only through the preferences read that runs during warm return.
    if (savedLocally) {
      const key=`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`;
      localStorage.setItem(key,JSON.stringify(settings));
      localStorage.setItem(key+':synced',JSON.stringify({Revision:'rows-saved',Settings:settings}));
    }
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node instanceof Element&&(node.matches('.tvl-home-loading-status')||node.querySelector('.tvl-home-loading-status')))state.loaderMounts++;
    }))).observe(document.body,{childList:true,subtree:true});
  }, { settings, savedLocally });
  await page.goBack();
  await expect.poll(() => page.evaluate(() => (window as any).__warmHome.pendingList.length)).toBeGreaterThan(0);
  await expect(page.locator('#homeTab .tvl-provider-tile').first()).toBeVisible();
  await expect(loader(page)).toHaveCount(0); await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  expect(await page.evaluate(() => (window as any).__warmHome.loaderMounts)).toBe(0);
  await page.evaluate(() => (window as any).__warmHome.releaseList());
  await expect(cards(page)).toHaveCount(20); await expect(loader(page)).toHaveCount(0);
});

for (const userInput of [false, true]) test(userInput
  ? 'late native viewshow preserves a new remote selection made after the cached Home return'
  : 'late native autofocus and viewshow restore the cached collection card and scroll', async ({ page }) => {
  await fixture(page); const saved = await holdAndLeave(page);
  await returnHome(page); await expectWarm(page); await expect.poll(() => position(page)).toEqual(saved);
  let expected = saved;
  if (userInput) {
    await page.keyboard.press('ArrowRight'); await expect(cards(page).nth(13)).toBeFocused();
    expected = await position(page); expect(expected.focus).not.toBe(saved.focus);
  }
  await page.evaluate(userInput => {
    const host = document.querySelector<HTMLElement>('#indexPage')!;
    if (!userInput) {
      // Native viewManager restores its first control after unhide when the
      // previously focused custom node was replaced during the warm rebuild.
      host.querySelector<HTMLElement>('[aria-label="My Media"] button')!.focus();
      window.scrollTo(0,0);
    }
    host.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
  }, userInput);
  await expect.poll(() => position(page)).toEqual(expected); await expect(loader(page)).toHaveCount(0);
  await release(page); await expect.poll(() => position(page)).toEqual(expected);
});
