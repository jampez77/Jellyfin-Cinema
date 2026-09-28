import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const upstream = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const templatePath = resolve(upstream, 'src/apps/legacy/controllers/playback/video/index.html');
const actions = (page: Page) => page.locator('#tvl-trailer-actions');
const skip = (page: Page) => actions(page).getByRole('button', { name: 'Skip trailer', exact: true });
const add = (page: Page) => actions(page).getByRole('button', { name: 'Add to watchlist', exact: true });

test.beforeEach(() => test.skip(!existsSync(templatePath), 'Set TVL_JELLYFIN_WEB_SOURCE to audited Jellyfin 12 source.'));

async function fixture(page: Page, extra = '', pointerEvents = true) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api=window.TvItemLayoutDemo.api, original=api.getItem;
      const items=[
        {Id:'trailer-a',Type:'Trailer',Name:'Advertised A trailer'},
        {Id:'trailer-b',Type:'Trailer',Name:'Advertised B trailer'},
        {Id:'advertised-a',Type:'Movie',Name:'Advertised A'},
        {Id:'advertised-b',Type:'Movie',Name:'Advertised B'},
        {Id:'feature',Type:'Movie',Name:'The selected feature'}
      ];
      window.__trailerItems=new Map(items.map(item=>[item.Id,item]));
      window.__trailerAdds=[]; window.__trailerReads=[]; window.__savedMovies=[]; window.__nativePlays=[]; window.__nativeToggles=0;
      api.serverId='trailer-server'; api.userId='trailer-user';
      api.getItem=async id=>window.__trailerItems.get(id)||original(id);
      api.getPlaybackContext=async()=>window.__playbackContext||null;
      window.__trailerResult=()=>{
        const context=window.__playbackContext;
        if(!context || !context.PlayingItemId.startsWith('trailer-'))return null;
        const id=context.PlayingItemId.replace('trailer-','advertised-');
        const item=window.__trailerItems.get(id);
        return {PlayingItemId:context.PlayingItemId,PlaylistItemId:context.PlaylistItemId,
          Movie:window.__unmapped?null:{Id:id,Name:item.Name},InWatchlist:window.__savedMovies.includes(id),
          WatchlistId:window.__savedMovies.includes(id)?'private-watchlist':undefined};
      };
      api.getTrailerActions=async expected=>{
        window.__trailerReads.push({...expected});
        const result=window.__trailerResult();
        if(window.__deferRead)await new Promise(resolve=>window.__resolveRead=resolve);
        if(window.__readError)throw new Error('Cannot check the current trailer.');
        if(window.__nullResult)return null;
        return result;
      };
      api.getTrailerDetails=async()=>window.__trailerResult();
      api.addTrailerToWatchlist=async expected=>{
        const result=window.__trailerResult();
        window.__trailerAdds.push({...expected,MovieId:result.Movie.Id});
        if(window.__deferAdd)await new Promise(resolve=>window.__resolveAdd=resolve);
        if(window.__addError)throw new Error('Unable to save your watchlist. Try again.');
        window.__savedMovies.push(result.Movie.Id);
        return {...result,InWatchlist:true,WatchlistId:'private-watchlist'};
      };
      ${extra}
    })();` });
  });
  await page.goto('/#/video');
  const template = readFileSync(templatePath, 'utf8').replace(/\$\{([^}]+)\}/g, '$1');
  const css = readFileSync(resolve(upstream, 'src/styles/videoosd.scss'), 'utf8')
    .replace(/@include conditional-max\(padding-bottom[^;]+;/g, 'padding-bottom:1.75em;')
    .replace(/^\s*@(?:use|include)\s+[^;]+;/gm, '');
  await page.evaluate(async ({ template, css }) => {
    const testWindow = window as any;
    const container = document.createElement('div'); container.className = 'videoPlayerContainer';
    container.style.cssText = 'position:fixed;inset:0;background:#0a0e0c';
    const video = document.createElement('video'); video.className = 'htmlvideoplayer'; video.muted = true;
    video.style.cssText = 'width:100%;height:100%'; container.append(video); document.body.append(container);
    document.body.insertAdjacentHTML('beforeend', template);
    const osd = document.querySelector<HTMLElement>('#videoOsdPage')!;
    osd.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none';
    const style = document.createElement('style');
    style.textContent = css + '.hide,.demo-switcher,.demo-native-page{display:none!important}.flex{display:flex}.flex-grow{flex-grow:1}.align-items-center{align-items:center}.material-icons{line-height:1;width:1em;height:1em;display:inline-block}.videoOsdBottom{pointer-events:auto}.videoOsdBottom button{font-size:20px;min-width:40px;min-height:40px}.videoOsdBottom-hidden{visibility:hidden;pointer-events:none}.videoOsdBottom-hidden *{pointer-events:none}';
    document.head.append(style);
    testWindow.__setPlaying = async (id: string, playlistItemId: string, queue: any[]) => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
      video.srcObject = canvas.captureStream(5);
      const item = testWindow.__trailerItems.get(id);
      testWindow.__playbackContext = {PlayingItemId:id,PlayingItemType:item.Type,PlaylistItemId:playlistItemId,Queue:queue};
      osd.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = id;
      await video.play(); osd.dispatchEvent(new CustomEvent('viewshow', {bubbles:true}));
    };
    osd.querySelector('.btnNextTrack')!.classList.remove('hide');
    (osd.querySelector('.btnNextTrack') as HTMLButtonElement).disabled = false;
    const rating = osd.querySelector<HTMLElement>('.btnUserRating')!;
    rating.classList.remove('hide'); rating.focus();
  }, { template, css });
  // Execute Jellyfin's actual next-track queue implementation and native OSD
  // button listener. Only media transport is replaced with a canvas stream.
  const manager = readFileSync(resolve(upstream, 'src/components/playback/playbackmanager.js'), 'utf8');
  const nextMethod = manager.slice(manager.indexOf('self.nextTrack = function (player)'), manager.indexOf('self.previousTrack = function (player)'));
  const controller = readFileSync(resolve(upstream, 'src/apps/legacy/controllers/playback/video/index.js'), 'utf8');
  const nextListener = controller.slice(controller.indexOf("view.querySelector('.btnNextTrack').addEventListener('click'"), controller.indexOf("    btnRewind.addEventListener('click'"));
  // Native background clicks toggle playback after 300ms. Trailer controls live
  // outside .videoOsdBottom, so exercising the actual handler catches bubbling
  // that a next-track-only fixture cannot detect.
  const pointerListener = controller.slice(controller.indexOf('    let lastPointerDown = 0;'), controller.indexOf("    dom.addEventListener(view, 'dblclick'"))
    .replace('window.PointerEvent', String(pointerEvents));
  const queuePath = resolve(upstream, 'src/components/playback/playqueuemanager.js');
  const native = await build({ stdin: { resolveDir: upstream, contents: `
    import PlayQueueManager from ${JSON.stringify(queuePath)};
    const self={_playQueueManager:new PlayQueueManager(),_currentPlayer:{}};
    const enableLocalPlaylistManagement=()=>true, getPreviousSource=()=>({Id:'selected-source'});
    const getMatchingMediaSource=()=>null, getDefaultPlayOptions=()=>({});
    function setPlaylistState(id,index){self._playQueueManager.setPlaylistState(id,index);}
    function playInternal(item,options,started,source){
      window.__nativePlays.push({Id:item.Id,options:{...options},source}); started();
      window.__setPlaying(item.Id,item.PlaylistItemId,self._playQueueManager.getPlaylist());
    }
    ${nextMethod}
    const playbackManager=self,currentPlayer=self._currentPlayer,view=document.querySelector('#videoOsdPage');
    ${nextListener}
    const layoutManager={mobile:false};
    const dom={parentWithClass:(node,names)=>node.closest(names.map(name=>'.'+name).join(',')),
      addEventListener:(node,name,listener,options)=>node.addEventListener(name,listener,options)};
    let playPauseClickTimeout;
    const showOsd=()=>view.querySelector('.videoOsdBottom').classList.remove('videoOsdBottom-hidden');
    const toggleOsd=()=>view.querySelector('.videoOsdBottom').classList.toggle('videoOsdBottom-hidden');
    playbackManager.playPause=()=>{
      window.__nativeToggles++;
      const video=document.querySelector('video');
      if(video.paused)void video.play();else video.pause();
    };
    ${pointerListener}
    const items=['trailer-a','trailer-b','feature'].map((id,index)=>({...window.__trailerItems.get(id),PlaylistItemId:'queue-'+index,
      ...(id==='feature'?{playOptions:{mediaSourceId:'chosen-feature-version',audioStreamIndex:2,subtitleStreamIndex:5}}:{})}));
    self._playQueueManager.setPlaylist(items); self._playQueueManager.setPlaylistState(items[0].PlaylistItemId);
    window.__nativeQueue=self._playQueueManager;
    window.__setPlaying(items[0].Id,items[0].PlaylistItemId,self._playQueueManager.getPlaylist());
  ` }, bundle: true, write: false, format: 'iife', target: 'chrome79' });
  await page.addScriptTag({ content: native.outputFiles[0].text });
}

async function nativeNavigation(page: Page) {
  const input = resolve(upstream, 'src/scripts/inputManager.js');
  const keyboard = resolve(upstream, 'src/scripts/keyboardNavigation.js');
  const native = await build({ stdin: { resolveDir: upstream, contents: `
    import keyboard from ${JSON.stringify(keyboard)};
    import * as input from ${JSON.stringify(input)};
    input.on(window,event=>{
      if(['up','down','select'].includes(event.detail?.command))document.querySelector('.videoOsdBottom').classList.remove('videoOsdBottom-hidden');
    });
    keyboard.enable(); window.__nativeInput=input;
  ` }, bundle:true,write:false,format:'iife',target:'chrome79',plugins:[{name:'native-navigation-adapters',setup(build){
    const adapters: Record<string,string> = {
      './browser':'export default {tv:true};',
      '../components/layoutManager':'export default {tv:true};',
      './settings/appSettings':'export default {enableGamepad:()=>false};',
      './gamepadtokey':'export {};',
      'components/apphost':'export const appHost={supports:()=>false};',
      'components/playback/playbackmanager':'export const playbackManager={};',
      'components/router/appRouter':'export const appRouter={};',
      'constants/appFeature':'export const AppFeature={};',
      './scrollManager':'export default {isEnabled:()=>false};',
      'utils/dom':'export default {parentWithClass:(node,name)=>node?.closest("."+name),addEventListener:(node,name,fn,options)=>node.addEventListener(name,fn,options),removeEventListener:(node,name,fn,options)=>node.removeEventListener(name,fn,options)};',
      '../utils/dom':'export default {parentWithClass:(node,name)=>node?.closest("."+name)};'
    };
    build.onResolve({filter:/.*/},args=>args.path==='components/focusManager'?{path:resolve(upstream,'src/components/focusManager.js')}
      :args.path in adapters?{path:args.path,namespace:'native-adapter'}:undefined);
    build.onLoad({filter:/.*/,namespace:'native-adapter'},args=>({loader:'js',contents:adapters[args.path]}));
  }}] });
  await page.addScriptTag({content:native.outputFiles[0].text});
}

test('skip advances Jellyfin’s existing queue by one trailer and preserves feature selections', async ({ page }) => {
  await fixture(page);
  await expect(actions(page)).toBeVisible();
  await expect(actions(page)).toHaveAttribute('data-movie-id', 'advertised-a');
  await skip(page).click();
  await expect(actions(page)).toHaveAttribute('data-movie-id', 'advertised-b');
  expect(await page.evaluate(() => (window as any).__nativePlays)).toHaveLength(1);
  await skip(page).click();
  await expect(actions(page)).toBeHidden();
  const result = await page.evaluate(() => ({ plays:(window as any).__nativePlays, queue:(window as any).__nativeQueue.getPlaylist() }));
  expect(result.plays.map((entry: any) => entry.Id)).toEqual(['trailer-b', 'feature']);
  expect(result.plays[1].options).toEqual({ mediaSourceId:'chosen-feature-version',audioStreamIndex:2,subtitleStreamIndex:5 });
  expect(result.queue.map((entry: any) => entry.Id)).toEqual(['trailer-a', 'trailer-b', 'feature']);
});

test('Skip receives initial focus for each trailer and held Select advances only one entry', async ({ page }) => {
  await fixture(page); await expect(skip(page)).toBeFocused();
  await page.keyboard.down('Enter');
  await expect(actions(page)).toHaveAttribute('data-movie-id','advertised-b');
  await expect(skip(page)).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  expect(await page.evaluate(() => (window as any).__nativePlays.map((item: any) => item.Id))).toEqual(['trailer-b']);
  await page.keyboard.press('ArrowLeft'); await expect(add(page)).toBeFocused();
});

test('initial focus waits for an unobstructed trailer and never returns after polling or another panel', async ({ page }) => {
  await fixture(page,'window.__deferRead=true;');
  await expect.poll(() => page.evaluate(() => !!(window as any).__resolveRead)).toBe(true);
  await page.evaluate(() => {
    const dialog=document.createElement('dialog'); dialog.id='focus-native-dialog';
    dialog.innerHTML='<button id="native-option">Audio settings</button>'; document.body.append(dialog); dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button')!.focus();
    (window as any).__deferRead=false; (window as any).__resolveRead();
  });
  await expect(actions(page)).toBeHidden(); await expect(page.locator('#native-option')).toBeFocused();
  await page.evaluate(() => document.querySelector('#focus-native-dialog')!.remove());
  await expect(skip(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(add(page)).toBeFocused();
  const reads = await page.evaluate(() => (window as any).__trailerReads.length);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
  await expect(actions(page)).toHaveClass(/tvl-trailer-paused/); await expect(add(page)).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).__trailerReads.length), {timeout:8000}).toBeGreaterThan(reads);
  await expect(add(page)).toBeFocused();
  await page.evaluate(() => {
    document.body.setAttribute('data-tvl-player-browser-open','');
    document.querySelector<HTMLButtonElement>('.btnPause')!.focus();
  });
  await expect(actions(page)).toBeHidden(); await expect(page.locator('.btnPause')).toBeFocused();
  await page.evaluate(() => document.body.removeAttribute('data-tvl-player-browser-open'));
  await expect(actions(page)).toBeVisible(); await expect(page.locator('.btnPause')).toBeFocused();
});

test('watchlist saves the advertised movie once, without changing the playing trailer', async ({ page }) => {
  await fixture(page); await expect(add(page)).toBeEnabled();
  await add(page).click();
  await expect(actions(page).getByRole('button', {name:'In watchlist',exact:true})).toBeDisabled();
  await expect(actions(page).getByRole('status')).toHaveText('Advertised A added to your watchlist.');
  expect(await page.evaluate(() => (window as any).__trailerAdds)).toEqual([{PlayingItemId:'trailer-a',PlaylistItemId:'queue-0',MovieId:'advertised-a'}]);
  expect(await page.evaluate(() => (window as any).__nativePlays)).toEqual([]);
});

for (const pointerEvents of [true, false]) test(`trailer ${pointerEvents ? 'pointer' : 'legacy click'} actions do not trigger Jellyfin's delayed play/pause handler`, async ({ page }) => {
  await fixture(page, '', pointerEvents);
  await expect(actions(page)).toBeVisible();
  await add(page).click();
  await expect(actions(page).getByRole('button', {name:'In watchlist',exact:true})).toBeDisabled();
  // Wait past Jellyfin's double-click interval: a leaked input would pause the
  // original trailer here, or the next queue entry following Skip below.
  await page.waitForTimeout(400);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  expect(await page.evaluate(() => (window as any).__nativeToggles)).toBe(0);
  await skip(page).click();
  await expect(actions(page)).toHaveAttribute('data-movie-id', 'advertised-b');
  await page.waitForTimeout(400);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  expect(await page.evaluate(() => (window as any).__nativeToggles)).toBe(0);
  expect(await page.evaluate(() => (window as any).__nativePlays.map((entry: any) => entry.Id))).toEqual(['trailer-b']);
});

test('trailer controls stay usable over the pause screen and Skip starts the next trailer playing', async ({ page }) => {
  await fixture(page); await expect(actions(page)).toBeVisible();
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
  const pauseScreen = page.getByRole('region', {name:'Paused media details',exact:true});
  await expect(pauseScreen).toBeVisible();
  await expect(pauseScreen).toContainText('Advertised A');
  await expect(pauseScreen).not.toContainText('Advertised A trailer');
  await expect(actions(page)).toBeVisible();
  await add(page).click();
  await expect(actions(page).getByRole('button', {name:'In watchlist',exact:true})).toBeDisabled();
  await page.waitForTimeout(400);
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await expect(pauseScreen).toBeVisible();
  await skip(page).click();
  await expect(actions(page)).toHaveAttribute('data-movie-id', 'advertised-b');
  await page.waitForTimeout(400);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(pauseScreen).toBeHidden();
  expect(await page.evaluate(() => (window as any).__nativeToggles)).toBe(0);
});

for (const viewport of [{width:1440,height:900},{width:1920,height:1080},{width:1280,height:720},{width:1280,height:600}]) {
  for (const elegant of [false, true]) test(`paused trailer actions sit below long synopsis and above native controls at ${viewport.width}×${viewport.height}${elegant ? ' with ElegantFin' : ''}`, async ({ page }) => {
    const elegantPath = process.env.TVL_ELEGANTFIN_CSS || '/tmp/cinema-elegantfin-theme.css';
    test.skip(elegant && !existsSync(elegantPath), 'Set TVL_ELEGANTFIN_CSS to the audited ElegantFin stylesheet.');
    await page.setViewportSize(viewport);
    await fixture(page, `Object.assign(window.__trailerItems.get('advertised-a'), {
      Name:'Advertised A: The Journey to the Other Side',
      Overview:'A cartographer follows a vanished coastline, discovering unfamiliar towns and the stories of the people who live there. '.repeat(15),
      ProductionYear:2026, OfficialRating:'12', RunTimeTicks:900000000,
      Taglines:['Every tide leaves a trace.']
    });`);
    if (elegant) await page.addStyleTag({content:readFileSync(elegantPath,'utf8')});
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.videoOsdBottom')!;
      host.style.fontSize = '22px';
      host.querySelector('.osdTitle')!.textContent = 'Advertised A trailer: The Journey to the Other Side';
      host.querySelector('.osdSecondaryMediaInfo')!.textContent = '2026 · 12 · 2m · Drama / Adventure';
    });
    await expect(actions(page)).toBeVisible();
    await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
    await expect(page.locator('#tvl-pause-screen')).toBeVisible();
    await expect(actions(page)).toHaveClass(/tvl-trailer-paused/);
    await expect(page.locator('.tvl-pause-synopsis')).toHaveClass(/tvl-pause-synopsis-clipped/);
    const geometry = () => page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      };
      return {copy:rect('.tvl-pause-copy'),buttons:rect('.tvl-trailer-buttons'),native:rect('.osdControls'),status:rect('.tvl-trailer-status')};
    });
    const assertGap = async (withStatus = false) => {
      const bounds = await geometry();
      expect(bounds.buttons.left).toBeCloseTo(bounds.copy.left, 0);
      expect(bounds.buttons.top).toBeGreaterThanOrEqual(bounds.copy.bottom + 12);
      expect(bounds.native.top - bounds.buttons.bottom).toBeGreaterThanOrEqual(15);
      expect(bounds.native.top - bounds.buttons.bottom).toBeLessThanOrEqual(17);
      expect(bounds.buttons.right).toBeLessThan(viewport.width - 20);
      if (withStatus) {
        expect(bounds.status.bottom).toBeLessThanOrEqual(bounds.buttons.top - 8);
        expect(bounds.copy.bottom).toBeLessThanOrEqual(bounds.status.top - 12);
      }
      return bounds;
    };
    const before = await assertGap();
    await page.evaluate(() => document.querySelector('.videoOsdBottom')!.classList.add('videoOsdBottom-hidden'));
    await expect(actions(page)).not.toHaveClass(/tvl-trailer-native-visible/);
    await expect(actions(page)).toHaveClass(/tvl-trailer-paused/);
    const faded = await assertGap();
    expect(faded.buttons.top).toBeCloseTo(before.buttons.top, 0);
    // Jellyfin may remove the OSD from layout entirely after its opacity fade.
    await page.evaluate(() => document.querySelector('.videoOsdBottom')!.classList.add('hide'));
    await expect.poll(async () => (await actions(page).locator('.tvl-trailer-buttons').boundingBox())!.y).toBeCloseTo(before.buttons.top, 0);
    await page.evaluate(() => document.querySelector('.videoOsdBottom')!.classList.remove('hide'));
    await add(page).click();
    const saved = actions(page).getByRole('button',{name:'In watchlist',exact:true});
    await expect(saved).toBeDisabled(); await expect(saved).toBeFocused();
    await expect(saved).toHaveCSS('background-color','rgb(245, 245, 242)');
    await expect(saved.locator('span')).toHaveCSS('color','rgb(16, 17, 18)');
    await expect(skip(page).locator('span')).toHaveCSS('color','rgb(245, 245, 242)');
    await assertGap(true);
    await page.screenshot({path:test.info().outputPath('paused-trailer-actions-left.png')});
    await skip(page).click();
    await expect(actions(page)).toHaveAttribute('data-movie-id','advertised-b');
    await page.waitForTimeout(400);
    await expect(page.locator('video')).toHaveJSProperty('paused',false);
    expect(await page.evaluate(() => (window as any).__nativeToggles)).toBe(0);
  });
}

test('watchlist feedback stays within a short screen when playing controls are faded', async ({ page }) => {
  await page.setViewportSize({width:1280,height:600});
  await fixture(page); await expect(skip(page)).toBeFocused();
  await page.evaluate(() => document.querySelector('.videoOsdBottom')!.classList.add('videoOsdBottom-hidden'));
  await expect(actions(page)).not.toHaveClass(/tvl-trailer-native-visible/);
  await add(page).click();
  const status = actions(page).getByRole('status');
  await expect(status).toContainText('Advertised A added');
  const box = await status.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  await expect(actions(page).getByRole('button',{name:'In watchlist',exact:true})).toBeFocused();
  await page.waitForTimeout(400);
  await expect(page.locator('video')).toHaveJSProperty('paused',false);
});

test('short pause descriptions stay clear while trailer spacing adapts to native controls and resizing', async ({ page }) => {
  await fixture(page, `window.__deferRead=true; window.__trailerItems.get('advertised-a').Overview='A short, complete description.';`);
  await expect.poll(() => page.evaluate(() => !!(window as any).__resolveRead)).toBe(true);
  await page.evaluate(() => {
    document.querySelector('.videoOsdBottom')!.classList.add('hide');
    (window as any).__deferRead = false;
    (window as any).__resolveRead();
  });
  await expect(skip(page)).toBeFocused();
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
  const synopsis = page.locator('.tvl-pause-synopsis');
  await expect(synopsis).toBeVisible();
  await expect(synopsis).not.toHaveClass(/tvl-pause-synopsis-clipped/);
  await expect(synopsis).toHaveCSS('mask-image', 'none');
  await page.evaluate(() => document.querySelector('.videoOsdBottom')!.classList.remove('hide'));
  const gap = () => page.evaluate(() => document.querySelector('.osdControls')!.getBoundingClientRect().top
    - document.querySelector('.tvl-trailer-buttons')!.getBoundingClientRect().bottom);
  await expect.poll(gap).toBeCloseTo(16, 0);
  await page.setViewportSize({width:1280,height:720});
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.videoOsdBottom')!.style.fontSize = '28px';
    document.querySelector('.osdTitle')!.textContent = 'The current trailer';
  });
  await expect.poll(gap).toBeCloseTo(16, 0);
  await expect(synopsis).not.toHaveClass(/tvl-pause-synopsis-clipped/);
  await expect(skip(page)).toBeFocused();
});

test('unmapped trailer remains skippable without saving an unrelated movie', async ({ page }) => {
  await fixture(page, 'window.__unmapped=true;');
  await expect(actions(page)).toBeVisible(); await expect(add(page)).toBeDisabled(); await expect(skip(page)).toBeEnabled();
  await skip(page).click(); await expect.poll(() => page.evaluate(() => (window as any).__nativePlays.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__trailerAdds)).toEqual([]);
});

test('server-ineligible trailers and ordinary feature playback do not gain actions', async ({ page }) => {
  await fixture(page, 'window.__nullResult=true;');
  await expect.poll(() => page.evaluate(() => (window as any).__trailerReads.length)).toBeGreaterThan(0);
  await expect(actions(page)).toBeHidden();
  await page.evaluate(() => (window as any).__setPlaying('feature', 'queue-2', (window as any).__nativeQueue.getPlaylist()));
  await expect(actions(page)).toHaveCount(0);
});

test('late owner responses cannot attach actions to another source or account', async ({ page }) => {
  await fixture(page, 'window.__deferRead=true;');
  await expect.poll(() => page.evaluate(() => !!(window as any).__resolveRead)).toBe(true);
  await page.evaluate(async () => {
    (window as any).__deferRead=false;
    window.TvItemLayoutDemo!.api.userId='another-profile';
    await (window as any).__setPlaying('feature', 'queue-2', (window as any).__nativeQueue.getPlaylist());
    (window as any).__resolveRead();
  });
  await expect(actions(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__trailerAdds)).toEqual([]);
});

test('skip revalidates identity and rejects a changed trailer without advancing the queue', async ({ page }) => {
  await fixture(page); await expect(skip(page)).toBeEnabled();
  await page.evaluate(() => { (window as any).__deferRead=true; });
  await skip(page).click(); await expect(actions(page).getByRole('button', { name:'Skipping…' })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => !!(window as any).__resolveRead)).toBe(true);
  await page.evaluate(async () => {
    (window as any).__deferRead=false;
    await (window as any).__setPlaying('trailer-b','queue-1',(window as any).__nativeQueue.getPlaylist());
    (window as any).__resolveRead();
  });
  await expect(actions(page)).toHaveAttribute('data-movie-id','advertised-b');
  expect(await page.evaluate(() => (window as any).__nativePlays)).toEqual([]);
});

test('native skip unavailability and watchlist errors are recoverable', async ({ page }) => {
  await fixture(page); await expect(skip(page)).toBeEnabled();
  await page.evaluate(() => { (document.querySelector('.btnNextTrack') as HTMLButtonElement).disabled=true; });
  await skip(page).click(); await expect(actions(page).getByRole('status')).toHaveText('Skipping is unavailable in this player.');
  await expect(skip(page)).toBeEnabled();
  await page.evaluate(() => { (window as any).__addError=true; });
  await add(page).click(); await expect(actions(page).getByRole('status')).toHaveText('Unable to save your watchlist. Try again.');
  await expect(add(page)).toBeEnabled();
  await page.evaluate(() => { (window as any).__addError=false; });
  await add(page).click(); await expect(actions(page).getByRole('button',{name:'In watchlist',exact:true})).toBeDisabled();
});

test('persistent actions remain while paused and yield to native dialogs, player browsing and route teardown', async ({ page }) => {
  await fixture(page); await expect(actions(page)).toBeVisible();
  await page.evaluate(() => document.querySelector('.videoOsdBottom')!.classList.add('videoOsdBottom-hidden'));
  await expect(actions(page)).toBeVisible();
  await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).pause());
  await expect(actions(page)).toBeVisible();
  await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
  await expect(actions(page)).toBeVisible();
  await page.evaluate(() => { const dialog=document.createElement('dialog'); dialog.id='test-native-dialog'; dialog.textContent='Native settings'; document.body.append(dialog); dialog.showModal(); });
  await expect(actions(page)).toBeHidden();
  await page.evaluate(() => document.querySelector('#test-native-dialog')!.remove());
  await expect(actions(page)).toBeVisible();
  await page.evaluate(() => document.body.setAttribute('data-tvl-player-browser-open',''));
  await expect(actions(page)).toBeHidden();
  await page.evaluate(() => { document.body.removeAttribute('data-tvl-player-browser-open'); location.hash='/home'; });
  await expect(actions(page)).toHaveCount(0);
});

test('keyboard and remote selection start at Skip and preserve subsequent navigation', async ({ page }) => {
  await fixture(page); await expect(actions(page)).toBeVisible();
  await expect(skip(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(add(page)).toBeFocused(); await page.keyboard.press('ArrowRight'); await expect(skip(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(add(page)).toBeFocused();
  await page.evaluate(() => document.activeElement!.dispatchEvent(new CustomEvent('command',{bubbles:true,cancelable:true,detail:{command:'select'}})));
  await expect(actions(page).getByRole('button',{name:'In watchlist',exact:true})).toBeDisabled();
  await skip(page).focus(); await page.keyboard.press('Enter');
  await expect(actions(page)).toHaveAttribute('data-movie-id','advertised-b');
  expect(await page.evaluate(() => (window as any).__nativePlays)).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__trailerAdds)).toHaveLength(1);
});

test('late watchlist success is not displayed against the next trailer', async ({ page }) => {
  await fixture(page, 'window.__deferAdd=true;'); await expect(add(page)).toBeEnabled(); await add(page).click();
  await expect(actions(page).getByRole('button',{name:'Adding…',exact:true})).toBeDisabled();
  await page.evaluate(async () => {
    await (window as any).__setPlaying('trailer-b','queue-1',(window as any).__nativeQueue.getPlaylist());
    (window as any).__resolveAdd();
  });
  await expect(actions(page)).toHaveAttribute('data-movie-id','advertised-b');
  await expect(add(page)).toBeEnabled(); await expect(actions(page).locator('.tvl-trailer-status')).toBeEmpty();
});

test('Jellyfin’s TV spatial navigation reaches trailer buttons from native controls and returns on Down', async ({ page }) => {
  await fixture(page); await expect(actions(page)).toBeVisible(); await nativeNavigation(page);
  await page.locator('.btnPause').focus();
  for(let attempt=0;attempt<6;attempt++) {
    await page.keyboard.press('ArrowUp');
    if(await actions(page).locator('button:focus').count())break;
  }
  await expect(actions(page).locator('button:focus')).toHaveCount(1);
  await expect(page.locator('#tvl-player-browser')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.videoOsdBottom button:focus')).toHaveCount(1);
  await expect(page.locator('#tvl-player-browser')).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(actions(page).locator('button:focus')).toHaveCount(1);
  await page.evaluate(()=>document.querySelector('.videoOsdBottom')!.classList.add('videoOsdBottom-hidden'));
  await page.evaluate(()=>(window as any).__nativeInput.handleCommand('down'));
  await expect(page.locator('.videoOsdBottom')).not.toHaveClass(/videoOsdBottom-hidden/);
  await expect(page.locator('#tvl-player-browser')).toHaveCount(0);
});

test('destroy removes trailer controls and listeners even during a pending request', async ({ page }) => {
  await fixture(page, 'window.__deferAdd=true;'); await expect(add(page)).toBeEnabled(); await add(page).click();
  await page.evaluate(()=>{window.TvItemLayout!.destroy();(window as any).__resolveAdd();});
  await expect(actions(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>(window as any).__nativePlays)).toEqual([]);
});

test('saving and saved watchlist control retains TV focus without held Select skipping the trailer', async ({ page }) => {
  await fixture(page, 'window.__deferAdd=true;'); await expect(add(page)).toBeEnabled(); await nativeNavigation(page);
  await page.locator('.btnPause').focus();
  for(let attempt=0;attempt<6;attempt++) {
    await page.keyboard.press('ArrowUp');
    if(await actions(page).locator('button:focus').count())break;
  }
  await expect(actions(page).locator('button:focus')).toHaveCount(1);
  if(await skip(page).evaluate(button=>button===document.activeElement))await page.keyboard.press('ArrowLeft');
  await expect(add(page)).toBeFocused();
  await page.keyboard.down('Enter');
  const pending=actions(page).getByRole('button',{name:'Adding…',exact:true});
  await expect(pending).toBeDisabled(); await expect(pending).toBeFocused();
  await page.keyboard.down('Enter');
  await page.evaluate(()=>(window as any).__resolveAdd());
  const saved=actions(page).getByRole('button',{name:'In watchlist',exact:true});
  await expect(saved).toBeDisabled(); await expect(saved).toBeFocused();
  await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  await page.evaluate(()=>(window as any).__nativeInput.handleCommand('select'));
  expect(await page.evaluate(()=>(window as any).__trailerAdds)).toHaveLength(1);
  expect(await page.evaluate(()=>(window as any).__nativePlays)).toEqual([]);
  await page.keyboard.press('ArrowRight'); await expect(skip(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.videoOsdBottom button:focus')).toHaveCount(1);
  await expect(page.locator('#tvl-player-browser')).toHaveCount(0);
});
