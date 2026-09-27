import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

// Exercise the real Featured teardown/remount, whose placeholder survives its
// feed request and artwork preload. A static preview cannot reproduce this wait.
const source = process.env.TVL_FEATURED_SOURCE || '/tmp/tvl-featured-audit';
const available = existsSync(resolve(source, 'src/main.ts'));
const bundle = available ? buildSync({ stdin: { contents: `import {createFeaturedResponseDefaults} from ${JSON.stringify(resolve(source, 'src/config/libs/defaults.ts'))};
  import ${JSON.stringify(resolve(source, 'src/main.ts'))};window.__featuredDefaults=createFeaturedResponseDefaults();`, loader: 'ts', resolveDir: source },
  bundle: true, format: 'iife', target: 'chrome79', loader: { '.css': 'text' }, write: false, logLevel: 'silent' }).outputFiles[0].text : '';
test.skip(!available, 'Set TVL_FEATURED_SOURCE to the audited Featured checkout.');

test('real Featured remount refreshes independently while warm native and collection rows appear together', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify({version:1,rows:[
    {id:'featured-warm',kind:'items',title:'Cached films',collectionIds:['collection-coast'],ranked:false,placement:'end'}
  ]})));
  await page.route('**/dist/demo.js', async route => {
    const response=await route.fetch();
    await route.fulfill({response,body:`${await response.text()}\n(()=>{
      const api=window.TvItemLayoutDemo.api,list=api.getCollectionList,members=api.getCollectionItems;
      const state=window.__featuredWarm={calls:0,holdFeatured:false,holdCollections:false,collections:[],frames:[],loaderMounts:0};
      api.getCollectionList=async()=>{if(state.holdCollections)await new Promise(resolve=>state.collections.push(resolve));return list();};
      api.getCollectionItems=async id=>{if(state.holdCollections)await new Promise(resolve=>state.collections.push(resolve));return members(id);};
    })();`});
  });
  await page.route('**/Items/**/Images/**', route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="800"><rect width="1440" height="800" fill="#253c31"/></svg>'}));
  await page.goto('/?featured=0&layout=desktop#/home');
  const row=page.locator('#homeTab [data-home-row="featured-warm"]');
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    const win=window as any;
    win.JellyfinFeaturedPluginConfig={hideOnTvLayout:false,useHeroLayout:false,heroHeightMode:'custom',bannerHeight:430};
    win.ApiClient={getCurrentUserId:()=> 'featured-user',serverId:()=> 'featured-server',deviceId:()=> 'test',accessToken:()=> 'test',
      getUrl:(path: string)=>new URL('/'+path.replace(/^\//,''),location.origin).href,
      ajax:async(request: {url: string})=>{
        const state=win.__featuredWarm,path=new URL(request.url,location.origin).pathname;
        if(path!=='/featured/items')return {};
        state.calls++;if(state.holdFeatured)await new Promise(resolve=>{state.releaseFeatured=resolve;});
        return {...win.__featuredDefaults,autoplay:false,infiniteLoading:false,trackDisplayedItems:false,personalizationEnabled:false,hideOnTvLayout:false,
          useHeroLayout:false,showDescription:true,showYear:false,showRating:false,titleDisplayMode:'title',showControlsOnHoverOnly:false,
          showPlayButton:false,showSecondaryButton:true,secondaryButtonText:'Details',showFavoriteButton:false,showPlaystateButton:false,
          enableBackgroundTrailers:false,items:[{id:'movie-tide',name:'After the Tide',mediaType:'Movie',hasImage:true,hasLogo:false,imageType:'Backdrop',isFavorite:false,isPlayed:false}]};
      }};
  });
  await page.addScriptTag({content:bundle});await expect(page.locator('.ec-root.ec-ready')).toBeVisible();
  await row.locator('.tvl-home-row-card').first().click();await expect(page.getByRole('dialog',{name:'After the Tide details',exact:true})).toBeVisible();
  await expect(page.locator('.ec-root.ec-ready')).toHaveCount(0);
  await page.evaluate(() => {
    const state=(window as any).__featuredWarm;state.holdFeatured=true;state.holdCollections=true;
    state.nativeBusy=document.querySelector('#homeTab .sections .itemsContainer');state.nativeBusy.setAttribute('aria-busy','true');
    const shown=(selector: string)=>{const node=document.querySelector<HTMLElement>(selector);return !!node?.getClientRects().length&&getComputedStyle(node).visibility==='visible';};
    const sample=()=>{
      state.frames.push(['#homeTab [aria-label="Latest in Movies"] button','#homeTab [data-home-row="featured-warm"]','#homeTab .tvl-home-provider-row'].map(shown));
      if(!state.stopFrames)requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node instanceof Element&&(node.matches('.tvl-home-loading-status')||node.querySelector('.tvl-home-loading-status')))state.loaderMounts++;
    }))).observe(document.body,{childList:true,subtree:true});
  });
  await page.goBack();await expect.poll(() => page.evaluate(() => (window as any).__featuredWarm.calls)).toBe(2);
  await expect(page.locator('.ec-placeholder')).toBeAttached();await expect(row).toBeHidden();
  await expect(page.locator('#homeTab [aria-label="Latest in Movies"] button').first()).toBeHidden();
  await page.evaluate(() => (window as any).__featuredWarm.nativeBusy.removeAttribute('aria-busy'));
  await expect(row).toBeVisible({timeout:1_000});await expect(row.locator('.tvl-home-row-card')).toHaveCount(2);
  await expect(page.locator('#homeTab .tvl-provider-tile').first()).toBeVisible();
  await expect(page.locator('#homeTab [aria-label="Latest in Movies"] button').first()).toBeVisible();
  await expect(page.locator('.ec-placeholder')).toBeAttached();await expect(page.getByRole('status',{name:'Loading Home',exact:true})).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__featuredWarm.collections.length)).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const observed=await page.evaluate(()=>{const state=(window as any).__featuredWarm;state.stopFrames=true;return {frames:state.frames as boolean[][],loaders:state.loaderMounts};});
  expect(observed.frames.some(frame=>frame.every(Boolean))).toBe(true);
  expect(observed.frames.filter(frame=>frame.some(Boolean)&&!frame.every(Boolean))).toEqual([]);expect(observed.loaders).toBe(0);
  await page.evaluate(()=>{const state=(window as any).__featuredWarm;state.releaseFeatured();state.holdCollections=false;state.collections.splice(0).forEach((resolve:()=>void)=>resolve());});
  await expect(page.locator('.ec-root.ec-ready')).toBeVisible();await expect(row).toBeVisible();
});
