import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { defaultProviderHomes } from '../../src/provider-settings';

// Native refreshItems/onDataFetched/afterRefresh behavior comes from the actual
// GPL-2.0 Jellyfin web checkout, not a vendored copy or a synthetic loading flag.
// Audited jellyfin/jellyfin-web v12.0 @ 0e83c6a724b31f3e9b5a499244331a288c060a4a.
const source = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const entry = resolve(source, 'src/elements/emby-itemscontainer/emby-itemscontainer.js');
const available = existsSync(entry);
let native = '';
test.skip(!available, 'Set TVL_JELLYFIN_WEB_SOURCE to the audited Jellyfin 12 web checkout.');
test.beforeAll(async () => {
  if (!available) return;
  native = (await build({ stdin: { contents: `import ${JSON.stringify(entry)};`, resolveDir: source },
    bundle: true, format: 'iife', target: 'chrome79', write: false, logLevel: 'silent', plugins: [{ name: 'native-home-adapters', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path === entry ? { path: entry } : { path: args.path, namespace: 'fixture' });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
        export const ServerConnections={}, OutboundWebSocketMessageType={}, playbackManager={};
        export default {lazyChildren(){},focus(node){node.focus()},autoFocus(root){root.querySelector('button')?.focus()}};` }));
    } }] })).outputFiles[0].text;
});

const settings = (placement = 'native:next up:1') => ({ version: 1, rows: [{ id: 'staged', kind: 'items', title: 'Weekend picks', collectionIds: ['collection-coast'], ranked: true, placement }] });
const rows = (page: Page) => page.locator('#homeTab [data-home-row="staged"]');
async function fixture(page: Page, options: { inflight?: boolean; placement?: string; synced?: boolean; fresh?: boolean; holdSettings?: boolean; holdProviders?: boolean; holdItems?: boolean; failedSettings?: boolean } = {}) {
  const saved = settings(options.placement);
  if (!options.fresh) await page.addInitScript(saved => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify(saved)), saved);
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const register = document.registerElement;
      document.registerElement = (_name, options) => {window.__nativeItemsPrototype = options.prototype;};
      ${native}
      if(register) document.registerElement = register; else delete document.registerElement;
      const api = window.TvItemLayoutDemo.api, list = api.getCollectionList, members = api.getCollectionItems;
      const state = window.__nativeHome = { listCalls: 0, itemCalls: 0, nativeAfter: 0, failures: 0, nodes: [], originals: [], fetchCalls: [], deferred: [], settings: ${JSON.stringify(saved)}, providers: ${JSON.stringify(defaultProviderHomes())}, holdItems: ${!!options.holdItems} };
      api.getCollectionList = async (...args) => {
        state.listCalls++;
        if(state.holdList) await new Promise(resolve => {state.releaseList=resolve;});
        return list(...args);
      };
      api.getCollectionItems = async (...args) => {const items=await members(...args);state.itemCalls++;if(state.holdItems)await new Promise(resolve=>{state.releaseItems=resolve;});return items;};
      if(${!!options.synced}) api.homeCollections = {isCurrent:()=>true, load:async()=>{
        if(${!!options.holdSettings})await new Promise(resolve=>{state.releaseSettings=resolve;});
        if(${!!options.failedSettings})throw new Error('Offline settings');
        return {Revision:'1',Settings:state.settings};
      }, save:async()=>{throw new Error('Unexpected save')}};
      if(${!!options.holdProviders}) api.providerHomes = {isCurrent:()=>true, load:async()=>{
        await new Promise(resolve=>{state.releaseProviders=resolve;});return {Revision:'1',Settings:state.providers};
      },save:async()=>{throw new Error('Unexpected save')}};
      const host = document.querySelector('#homeTab .sections');
      host.replaceChildren(); host.classList.remove('homeSectionsContainer');
      state.build = () => {
        host.classList.add('homeSectionsContainer');
        const library=document.createElement('div');library.className='verticalSection';
        library.innerHTML='<h2 class="sectionTitle">My Media</h2><div class="itemsContainer focuscontainer-x"><button>Native library</button></div>';
        host.append(library);
        for(const name of ['Continue watching','Next up']) {
          const row=document.createElement('div');row.className='verticalSection hide';
          row.innerHTML='<h2 class="sectionTitle">'+name+'</h2><div is="emby-itemscontainer" class="itemsContainer focuscontainer-x"></div>';
          const node=row.querySelector('.itemsContainer');Object.setPrototypeOf(node,window.__nativeItemsPrototype);
          const index=state.nodes.length;let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
          node.parentContainer=row;node.getItemsHtml=items=>items.map(item=>'<button data-id="'+item.Id+'">'+item.Name+'</button>').join('');
          node.fetchData=function(){state.fetchCalls[index]=(state.fetchCalls[index]||0)+1;return promise;};
          node.afterRefresh=()=>{state.nativeAfter++;};
          state.originals.push({fetchData:node.fetchData,afterRefresh:node.afterRefresh});state.nodes.push(node);state.deferred.push({resolve,reject});host.append(row);
        }
        const extension=document.createElement('div');extension.className='extraHomeScreenSections';
        extension.innerHTML='<div class="verticalSection"></div><div class="verticalSection hide"></div>';host.append(extension);
      };
      state.start = () => state.nodes.forEach(node=>{node.resume({refresh:true}).catch(()=>{state.failures++;});});
      state.resolve = (index, empty=false) => state.deferred[index].resolve({Items:empty?[]:[{Id:'native-'+index,Name:'Native item '+index}]});
      state.reject = index => state.deferred[index].reject(new Error('Native library unavailable'));
      if(${!!options.inflight}) {state.build();state.start();}
    })();` });
  });
}
async function built(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__nativeHome.itemCalls)).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
async function buildNative(page: Page) {
  await page.evaluate(() => (window as any).__nativeHome.build());
  await expect.poll(() => page.evaluate(() => {const s=(window as any).__nativeHome;return s.nodes.every((node:any,i:number)=>node.fetchData!==s.originals[i].fetchData);})).toBe(true);
  await page.evaluate(() => (window as any).__nativeHome.start());
}
async function finishNative(page: Page) { await page.evaluate(() => {const s=(window as any).__nativeHome;s.resolve(0);s.resolve(1);}); }

test('custom rows stay detached until slow native sections settle, then appear directly at their chosen anchor', async ({ page }) => {
  await fixture(page); await page.goto('/?featured=0#/home'); await built(page);
  await expect(rows(page)).toHaveCount(0); await expect(page.getByText('Loading your collection rows…')).toHaveCount(0);
  await buildNative(page); await page.evaluate(() => (window as any).__nativeHome.resolve(0));
  await expect(page.locator('[data-id="native-0"]')).toBeAttached(); await expect(page.locator('[data-id="native-0"]')).toBeHidden(); await expect(rows(page)).toHaveCount(0);
  await page.locator('.skinHeader').getByRole('link', { name: 'Settings', exact: true }).focus();
  await page.evaluate(() => (window as any).__nativeHome.resolve(1));
  await expect(rows(page)).toBeVisible();
  expect(await rows(page).evaluate(node => node.nextElementSibling?.querySelector('h2')?.textContent)).toBe('Next up');
  await expect(page.getByRole('button', { name: 'Native item 0', exact: true })).toBeVisible();
  await expect(page.locator('.skinHeader').getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__nativeHome.fetchCalls)).toEqual([1, 1]);
  expect(await page.evaluate(() => {const s=(window as any).__nativeHome;return s.nodes.every((node:any,i:number)=>node.fetchData===s.originals[i].fetchData&&node.afterRefresh===s.originals[i].afterRefresh);})).toBe(true);
});

test('already-inflight empty native results complete through afterRefresh and cached Back does not wait again', async ({ page }) => {
  await fixture(page, { inflight: true }); await page.goto('/?featured=0#/home'); await built(page); await expect(rows(page)).toHaveCount(0);
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.resolve(0,true);s.resolve(1,true);});
  await expect(rows(page)).toBeVisible(); expect(await page.evaluate(() => (window as any).__nativeHome.nativeAfter)).toBe(2);
  const selected = rows(page).getByRole('button', { name: 'Rank 1: After the Tide', exact: true });
  await selected.click(); await expect(page.getByRole('dialog', { name: 'After the Tide details', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(selected).toBeFocused();
  expect(await page.evaluate(() => (window as any).__nativeHome.fetchCalls)).toEqual([1, 1]);
});

test('observed native failures and permanently empty extension slots do not block custom rows', async ({ page }) => {
  await fixture(page); await page.goto('/?featured=0#/home'); await built(page); await buildNative(page);
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.reject(0);s.resolve(1,true);});
  await expect(rows(page)).toBeVisible(); expect(await page.evaluate(() => (window as any).__nativeHome.failures)).toBe(1);
  await expect(page.locator('.extraHomeScreenSections .verticalSection')).toHaveCount(2);
});

test('native empty-state markup releases immediately, while an unknown stalled Home has a bounded fallback', async ({ page }) => {
  await page.clock.install(); await fixture(page); await page.goto('/?featured=0#/home'); await built(page);
  await page.evaluate(() => {document.querySelector('#homeTab .sections')!.innerHTML='<div class="centerMessage"><h2>Nothing here</h2></div>';});
  await expect(rows(page)).toBeVisible();
  await page.reload(); await built(page); await expect(rows(page)).toHaveCount(0);
  await page.clock.fastForward(3_000); await expect(rows(page)).toHaveCount(0);
  await page.clock.fastForward(600); await page.clock.runFor(50); await expect(rows(page)).toBeVisible();
});

test('spinner and Featured placeholder completion are observed; a later anchor keeps the selected custom card focused', async ({ page }) => {
  await fixture(page, { placement: 'native:extension:1' }); await page.goto('/?featured=0#/home'); await built(page);
  await page.evaluate(() => {
    const spinner=document.createElement('div');spinner.className='docspinner mdlSpinnerActive';document.body.append(spinner);
    const featured=document.createElement('section');featured.className='ec-root ec-placeholder';featured.innerHTML='<button>Featured control</button>';
    featured.querySelector('button')!.addEventListener('click',()=>{featured.dataset.clicked='true';});
    document.querySelector('#homeTab .sections')!.append(featured);
  });
  await buildNative(page); await finishNative(page); await built(page); await expect(rows(page)).toHaveCount(0);
  await page.evaluate(() => document.querySelector('.docspinner')!.classList.remove('mdlSpinnerActive')); await built(page); await expect(rows(page)).toHaveCount(0);
  await page.evaluate(() => document.querySelector('.ec-root')!.classList.replace('ec-placeholder','ec-ready'));
  await expect(rows(page)).toBeVisible();
  const selected=rows(page).getByRole('button',{name:'Rank 1: After the Tide',exact:true});await selected.focus();
  await page.evaluate(() => {const row=document.createElement('section');row.className='verticalSection';row.innerHTML='<h2 class="sectionTitle">Extension</h2><button>Extension control</button>';document.querySelector('#homeTab .sections')!.append(row);});
  await expect.poll(() => rows(page).evaluate(node => node.nextElementSibling?.querySelector('h2')?.textContent)).toBe('Extension');
  await expect(selected).toBeFocused();
  await page.getByRole('button',{name:'Featured control',exact:true}).click();await expect(page.locator('.ec-root')).toHaveAttribute('data-clicked','true');
});

test('navigation destroys native observers and a late completion cannot reattach the previous account’s rows', async ({ page }) => {
  await fixture(page); await page.goto('/?featured=0#/home'); await built(page); await buildNative(page);
  await page.evaluate(() => {window.TvItemLayoutDemo!.api.userId='another-account';location.hash='/movies';window.TvItemLayout!.refresh();});
  await expect(page.getByRole('dialog',{name:'Movies',exact:true})).toBeVisible();
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(page.locator('#homeTab')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('.tvl-home-loading-status')).toHaveCount(0);
  expect(await page.evaluate(() => {const s=(window as any).__nativeHome;return s.nodes.every((node:any,i:number)=>node.fetchData===s.originals[i].fetchData&&node.afterRefresh===s.originals[i].afterRefresh);})).toBe(true);
  await finishNative(page); await expect(rows(page)).toHaveCount(0);
  await page.evaluate(() => {location.hash='/home';});await expect(rows(page)).toHaveCount(0);
});

for (const layout of ['tv', 'desktop']) test(`${layout}: a reused Home host never adopts the previous account’s native focus`, async ({ page }) => {
  await fixture(page, { fresh: true }); await page.goto(`/?featured=0&providers=1&layout=${layout}#/home`);
  await buildNative(page); await finishNative(page);
  const previous = page.getByRole('button', { name: 'Native item 1', exact: true });
  await expect(previous).toBeVisible(); await previous.focus();
  await page.evaluate(() => {
    (window as any).__nativeHome.previousHost = document.querySelector('#homeTab');
    window.TvItemLayoutDemo!.api.userId = 'another-account'; window.TvItemLayout!.refresh();
    // The native controller can blur the outgoing target before replacing its
    // cached DOM. Cinema must not relabel that target for the new account.
    (document.activeElement as HTMLElement).blur();
  });
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  expect(await page.evaluate(() => document.querySelector('#homeTab') === (window as any).__nativeHome.previousHost)).toBe(true);
  await expect(previous).not.toBeFocused();
  if (layout === 'tv') await expect(page.locator('#homeTab .tvl-provider-tile').first()).toBeFocused();
  else await expect(page.locator('body')).toBeFocused();
});

test('saved row refresh leaves current cards mounted and usable until the replacement is ready', async ({ page }) => {
  await page.clock.install(); await fixture(page,{synced:true});await page.goto('/?featured=0#/home');await built(page);await buildNative(page);await finishNative(page);
  await expect(rows(page)).toBeVisible();
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.originalRow=document.querySelector('[data-home-row="staged"]');s.holdList=true;s.settings={...s.settings,rows:s.settings.rows.map((row:any)=>({...row,title:'Updated picks'}))};});
  await page.clock.fastForward(5_100);await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(() => typeof (window as any).__nativeHome.releaseList)).toBe('function');
  await expect(rows(page)).toHaveAttribute('aria-label','Weekend picks');
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(page.locator('[data-id="native-0"]')).toBeVisible();
  expect(await rows(page).evaluate(node => node===(window as any).__nativeHome.originalRow)).toBe(true);
  const selected=rows(page).getByRole('button',{name:'Rank 1: After the Tide',exact:true});await selected.focus();
  await page.evaluate(() => (window as any).__nativeHome.releaseList());
  await expect(rows(page)).toHaveAttribute('aria-label','Updated picks');await expect(selected).toBeFocused();
  await expect(page.getByText('Loading your collection rows…')).toHaveCount(0);
});

test('fresh account preferences and slow members join native and streaming rows in the same first paint', async ({ page }) => {
  await fixture(page, { synced: true, fresh: true, holdSettings: true, holdProviders: true, holdItems: true });
  await page.goto('/?featured=0#/home'); await buildNative(page); await finishNative(page);
  await expect(page.locator('[data-id="native-0"]')).toBeAttached();
  await expect(page.locator('[data-id="native-0"]')).toBeHidden();
  await page.evaluate(() => {
    const state = (window as any).__nativeHome; state.frames = [];
    const shown = (selector: string) => { const node = document.querySelector<HTMLElement>(selector); return !!node && !!node.getClientRects().length && getComputedStyle(node).visibility === 'visible'; };
    const sample = () => { state.frames.push(['[data-id="native-0"]', '[data-home-row="staged"]', '.tvl-home-provider-row'].map(shown)); if (!state.stopFrames) requestAnimationFrame(sample); };
    requestAnimationFrame(sample); state.releaseProviders();
  });
  await expect(rows(page)).toHaveCount(0); await expect(page.locator('[data-id="native-0"]')).toBeHidden();
  await page.evaluate(() => (window as any).__nativeHome.releaseSettings());
  await expect.poll(() => page.evaluate(() => typeof (window as any).__nativeHome.releaseItems)).toBe('function');
  await expect(page.locator('[data-id="native-0"]')).toBeHidden(); await expect(rows(page)).toHaveCount(0);
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.holdItems=false;s.releaseItems();});
  await expect(rows(page)).toBeVisible(); await expect(page.locator('.tvl-home-provider-row')).toBeVisible();
  await expect(page.locator('[data-id="native-0"]')).toBeVisible();
  const frames = await page.evaluate(() => {const s=(window as any).__nativeHome;s.stopFrames=true;return s.frames as boolean[][];});
  expect(frames.some(frame => frame.every(Boolean))).toBe(true);
  expect(frames.filter(frame => frame.some(Boolean) && !frame.every(Boolean))).toEqual([]);
  await expect(page.locator('#homeTab')).not.toHaveAttribute('aria-busy');
});

test('failed initial account preferences use cached rows promptly without an error banner', async ({ page }) => {
  await page.clock.install(); await fixture(page, { synced: true, failedSettings: true });
  await page.goto('/?featured=0#/home'); await built(page); await buildNative(page); await finishNative(page);
  await page.clock.runFor(100); await expect(rows(page)).toBeVisible();
  await expect(page.locator('[data-id="native-0"]')).toBeVisible();
  await expect(page.getByText(/could not sync|Retry row sync|Offline settings/)).toHaveCount(0);
});

test('a hung preference read has a bounded fallback using the other fresh settings, and late results never remask Home', async ({ page }) => {
  await page.clock.install(); await fixture(page, { synced: true, fresh: true, holdProviders: true });
  await page.goto('/?featured=0#/home'); await built(page); await buildNative(page); await finishNative(page);
  await page.clock.runFor(100); await expect(page.locator('[data-id="native-0"]')).toBeHidden();
  await page.clock.fastForward(3_600); await page.clock.runFor(50);
  await expect(rows(page)).toBeVisible(); await expect(page.locator('[data-id="native-0"]')).toBeVisible();
  await expect(page.locator('.tvl-home-provider-row')).toBeVisible();
  await page.getByRole('button', { name: 'Native item 0', exact: true }).focus();
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.providers={...s.providers,title:'My streaming services'};s.releaseProviders();});
  await expect(page.locator('.tvl-home-provider-row')).toHaveAttribute('aria-label', 'My streaming services');
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(page.getByRole('button', { name: 'Native item 0', exact: true })).toBeFocused();
});

test('slow collection members cannot keep native Home hidden beyond the initial deadline', async ({ page }) => {
  await page.clock.install(); await fixture(page, { holdItems: true });
  await page.goto('/?featured=0#/home'); await built(page); await buildNative(page); await finishNative(page);
  await expect(page.locator('[data-id="native-0"]')).toBeHidden();
  await page.clock.fastForward(3_600); await page.clock.runFor(50);
  await expect(page.locator('[data-id="native-0"]')).toBeVisible(); await expect(rows(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Native item 0', exact: true }).focus();
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.holdItems=false;s.releaseItems();});
  await expect(rows(page)).toBeVisible(); await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(page.getByRole('button', { name: 'Native item 0', exact: true })).toBeFocused();
});

test('paused inactive empty native rows and an account without custom rows do not wait for the deadline', async ({ page }) => {
  await page.clock.install(); await fixture(page, { fresh: true }); await page.goto('/?featured=0#/home');
  await page.evaluate(() => (window as any).__nativeHome.build());
  await expect.poll(() => page.evaluate(() => {const s=(window as any).__nativeHome;return s.nodes.every((node:any,i:number)=>node.fetchData!==s.originals[i].fetchData);})).toBe(true);
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.nodes[1].paused=true;void s.nodes[0].resume({refresh:true});s.resolve(0);});
  await page.clock.runFor(100); await expect(page.locator('[data-id="native-0"]')).toBeVisible();
  await expect(page.locator('.tvl-home-provider-row')).toBeVisible(); await expect(rows(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__nativeHome.fetchCalls)).toEqual([1]);
});

test('native host replacement releases the old initial mask and paints all rows into the new host', async ({ page }) => {
  await fixture(page, { holdItems: true }); await page.goto('/?featured=0#/home'); await built(page); await buildNative(page);
  await page.evaluate(() => {
    const s=(window as any).__nativeHome; s.oldHost=document.querySelector('#homeTab');
    const host=document.createElement('div');host.id='homeTab';
    host.innerHTML='<div class="sections homeSectionsContainer"><section class="verticalSection"><h2 class="sectionTitle">Next up</h2><div class="itemsContainer"><button>Replacement native item</button></div></section></div>';
    s.oldHost.replaceWith(host);
  });
  await expect(page.locator('#homeTab')).toHaveClass(/tvl-home-initial-loading/);
  expect(await page.evaluate(() => {const host=(window as any).__nativeHome.oldHost;return {held:host.classList.contains('tvl-home-initial-loading'),busy:host.getAttribute('aria-busy')};})).toEqual({held:false,busy:null});
  await page.evaluate(() => {const s=(window as any).__nativeHome;s.holdItems=false;s.releaseItems();});
  await expect(rows(page)).toBeVisible(); await expect(page.getByRole('button', {name:'Replacement native item'})).toBeVisible();
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
});
