import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Exercise Jellyfin's own OSD template and spatial navigation without bundling
// its GPL source. Audited jellyfin-web v12.0: 0e83c6a724b31f3e9b5a499244331a288c060a4a.
const nativeSource = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const nativeTemplatePath = resolve(nativeSource, 'src/apps/legacy/controllers/playback/video/index.html');
const elegantSource = process.env.TVL_ELEGANTFIN_CSS || '/tmp/cinema-elegantfin-theme.css';

const records = [
  { Id: 'browse-series', Type: 'Series', Name: 'Northbound' },
  { Id: 'browse-season-1', Type: 'Season', Name: 'Season 1', IndexNumber: 1 },
  { Id: 'browse-season-2', Type: 'Season', Name: 'Season 2', IndexNumber: 2 },
  { Id: 'browse-episode-1', Type: 'Episode', Name: 'Departure', SeriesId: 'browse-series', SeriesName: 'Northbound', SeasonId: 'browse-season-1', ParentIndexNumber: 1, IndexNumber: 1, Overview: 'The first steps on a long journey.', RunTimeTicks: 24000000000, UserData: { Played: true }, ImageTags: { Primary: 'image' } },
  { Id: 'browse-episode-2', Type: 'Episode', Name: 'The Crossing', SeriesId: 'browse-series', SeriesName: 'Northbound', SeasonId: 'browse-season-1', ParentIndexNumber: 1, IndexNumber: 2, Overview: 'Finding a way over the frozen strait.', RunTimeTicks: 24000000000, UserData: { PlaybackPositionTicks: 6000000000 }, ImageTags: { Primary: 'image' } },
  { Id: 'browse-episode-3', Type: 'Episode', Name: 'New Shores', SeriesId: 'browse-series', SeriesName: 'Northbound', SeasonId: 'browse-season-2', ParentIndexNumber: 2, IndexNumber: 1, Overview: 'A new season of discovery.', ImageTags: { Primary: 'image' } },
  { Id: 'browse-movie', Type: 'Movie', Name: 'Moon Glass', Overview: 'A cartographer follows a vanished coastline.', ImageTags: { Primary: 'image' } },
  { Id: 'browse-next', Type: 'Movie', Name: 'The Other Shore', Overview: 'A new mystery on the far side.', ProductionYear: 2025, RunTimeTicks: 57000000000, UserData: { PlaybackPositionTicks: 3000000000 }, ImageTags: { Primary: 'image' } },
  { Id: 'browse-missing', Type: 'Movie', Name: 'Missing Film', IsMissing: true },
  { Id: 'browse-trailer', Type: 'Trailer', Name: 'Cinema intro' },
  { Id: 'browse-channel', Type: 'TvChannel', Name: 'Field Notes', Number: '101', ImageTags: { Logo: 'channel' }, CurrentProgram: { Id: 'browse-program', Type: 'Program', Name: 'Hidden Forests', Overview: 'Discover life under the canopy.', StartDate: '2026-09-23T12:00:00Z', EndDate: '2026-09-23T13:00:00Z', ImageTags: { Primary: 'image' } } },
  { Id: 'browse-channel-2', Type: 'TvChannel', Name: 'Horizon', Number: '102', ImageTags: { Logo: 'channel' }, CurrentProgram: { Id: 'browse-program-2', Type: 'Program', Name: 'Coastal Roads', Overview: 'A journey beyond the familiar.', ImageTags: { Primary: 'broken' } } },
  { Id: 'browse-program-2', Type: 'Program', Name: 'Coastal Roads', ChannelId: 'browse-channel-2' },
];
const browser = (page: Page) => page.locator('#tvl-player-browser');

async function fixture(page: Page, extra = '') {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    const script = `(() => {
      const api = window.TvItemLayoutDemo.api;
      const originalGet = api.getItem, originalImage = api.image;
      const items = new Map(${JSON.stringify(records)}.map(item => [item.Id, item]));
      window.__browserItems = items;
      window.__browserPlays = [];
      api.getItem = async id => items.get(id) || originalGet(id);
      api.getSeasons = async () => [...items.values()].filter(item => item.Type === 'Season');
      api.getEpisodes = async () => [...items.values()].filter(item => item.Type === 'Episode');
      api.getSimilar = async () => ['browse-movie', 'browse-next', 'browse-missing', 'browse-series'].map(id => items.get(id));
      api.getChannels = async () => ['browse-channel', 'browse-channel-2'].map(id => items.get(id));
      window.__browserContextReads = 0;
      api.getPlaybackContext = async () => { window.__browserContextReads++; return window.__browserContext || null; };
      api.play = async (item, ticks, current) => { if (current()) window.__browserPlays.push({id:item.Id,ticks}); };
      api.image = (item, kind) => item.Id.startsWith('browse-')
        ? (item.ImageTags?.[kind === 'logo' ? 'Logo' : 'Primary'] ? '/browse-assets/' + item.Id + '-' + kind + '.svg' : null)
        : originalImage(item,kind);
      ${extra}
    })();`;
    await route.fulfill({ response, body: `${await response.text()}\n${script}` });
  });
  await page.route('**/browse-assets/**', route => route.request().url().includes('browse-program-2')
    ? route.fulfill({ status: 404, body: 'Missing image' })
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#39664d"/><circle cx="450" cy="150" r="80" fill="#a0bca3"/></svg>' }));
}
async function player(page: Page, id = 'browse-episode-2', rating = true) {
  await page.goto('/#/video');
  await page.evaluate(async ({ id, rating }) => {
    const container = document.createElement('div'); container.className = 'videoPlayerContainer';
    container.style.cssText = 'position:fixed;inset:0;background:#15241c';
    const video = document.createElement('video'); video.className = 'htmlvideoplayer'; video.muted = true;
    video.style.cssText = 'width:100%;height:100%';
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d')!; context.fillStyle = '#264d39'; context.fillRect(0, 0, 320, 180);
    video.srcObject = canvas.captureStream(5); container.append(video); document.body.append(container);
    const osd = document.createElement('div'); osd.id = 'videoOsdPage'; osd.dataset.type = 'video-osd';
    osd.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none';
    const bottom = document.createElement('div'); bottom.className = 'videoOsdBottom';
    bottom.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:7.5em 24px 24px;display:flex;pointer-events:none';
    const nativeControls = document.createElement('div'); nativeControls.className = 'osdControls'; nativeControls.style.cssText = 'flex:1;min-width:0;pointer-events:auto';
    const controls = document.createElement('div'); controls.className = 'buttons';
    controls.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;pointer-events:auto';
    const button = document.createElement('button'); button.className = 'btnUserRating'; button.textContent = 'Native control';
    if (rating) button.dataset.id = id;
    controls.append(button); nativeControls.append(controls); bottom.append(nativeControls); osd.append(bottom); document.body.append(osd);
    await video.play(); button.focus(); osd.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
  }, { id, rating });
  await expect.poll(() => page.evaluate(() => (window as any).__browserContextReads)).toBeGreaterThan(0);
  const desktop = await page.evaluate(() => {
    const roots = [document.documentElement, document.body];
    return roots.some(root => root.classList.contains('layout-desktop')) && !roots.some(root => root.classList.contains('layout-tv'));
  });
  if (desktop) await expect(page.locator('#tvl-player-browse')).toBeVisible();
  else await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
}
async function remote(page: Page, command: string) {
  return page.evaluate(command => document.activeElement!.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command } })), command);
}

async function nativePlayer(page: Page, elegant = false, tv = true, simplifiedInput = true) {
  const template = readFileSync(nativeTemplatePath, 'utf8').replace(/\$\{([^}]+)\}/g, '$1');
  const css = [
    'src/styles/videoosd.scss', 'src/elements/emby-button/emby-button.scss', 'src/elements/emby-slider/emby-slider.scss',
  ].map(path => readFileSync(resolve(nativeSource, path), 'utf8')
    .replace(/@include conditional-max\(padding-bottom[^;]+;/g, 'padding-bottom:1.75em;')
    .replace(/^\s*@(?:use|include)\s+[^;]+;/gm, '')).join('\n')
    + (elegant ? readFileSync(elegantSource, 'utf8') : '');
  const focusManager = readFileSync(resolve(nativeSource, 'src/components/focusManager.js'), 'utf8')
    .replace(/^import .+;$/gm, '').replace('export default {', 'window.__nativeFocus = {');
  await page.evaluate(({ template, css, tv }) => {
    document.querySelector('#videoOsdPage')!.remove();
    document.body.insertAdjacentHTML('beforeend', template);
    const osd = document.querySelector<HTMLElement>('#videoOsdPage')!;
    osd.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none';
    const rating = osd.querySelector<HTMLElement>('.btnUserRating')!;
    rating.dataset.id = 'browse-episode-2';
    const seek = osd.querySelector<HTMLInputElement>('.osdPositionSlider')!;
    if (tv) seek.classList.add('focusable'); seek.setAttribute('aria-label', 'Native seek');
    const style = document.createElement('style');
    style.textContent = css + '.hide,.demo-switcher,.demo-native-page{display:none!important}.flex{display:flex}.flex-grow{flex-grow:1}.align-items-center{align-items:center}.osdHeader{position:fixed;top:15px;left:15px;z-index:1200}.material-icons{line-height:1;width:1em;height:1em;display:inline-block}';
    // Match the native custom elements' classes without replacing their sizes.
    osd.querySelectorAll('button[is="paper-icon-button-light"]').forEach(control => { control.classList.add('paper-icon-button-light'); if (tv) control.classList.add('show-focus'); });
    osd.querySelectorAll('input[is="emby-slider"]').forEach(control => {
      control.classList.add('mdl-slider', 'mdl-js-slider', 'show-focus');
      control.parentElement!.classList.add('mdl-slider-container');
    });
    document.head.append(style);
    const header = document.createElement('header'); header.className = 'skinHeader osdHeader';
    const back = document.createElement('button'); back.className = 'headerBackButton'; back.textContent = 'Native Back';
    header.append(back); document.body.append(header); back.focus();
  }, { template, css, tv });
  if (simplifiedInput) await page.addScriptTag({ content: `(() => {
    const dom = { parentWithClass: (element, name) => element?.closest('.' + name) };
    const scrollManager = { isEnabled: () => false };
    ${focusManager}
    document.addEventListener('command', event => {
      if (!event.defaultPrevented && event.detail?.command === 'down') window.__nativeFocus.moveDown(event.target);
    });
    window.addEventListener('keydown', event => {
      if (${tv} && !event.defaultPrevented && event.key === 'ArrowDown') {
        document.activeElement.dispatchEvent(new CustomEvent('command', {bubbles:true,cancelable:true,detail:{command:'down'}}));
        event.preventDefault();
      }
    });
  })();` });
}

test('WebOS keyCode Down follows native Jellyfin keyboard and command dispatch through ElegantFin controls', async ({ page }) => {
  test.skip(!existsSync(nativeTemplatePath) || !existsSync(elegantSource), 'Set TVL_JELLYFIN_WEB_SOURCE and TVL_ELEGANTFIN_CSS to audited upstream sources.');
  const keyboard = resolve(nativeSource, 'src/scripts/keyboardNavigation.js'), input = resolve(nativeSource, 'src/scripts/inputManager.js');
  const bundle = await build({ stdin: { resolveDir: nativeSource, contents: `
    import keyboard from ${JSON.stringify(keyboard)};
    import * as input from ${JSON.stringify(input)};
    input.on(window, () => {}); keyboard.enable(); window.__actualNativeInput = input;
  ` }, bundle: true, write: false, format: 'iife', target: 'chrome79', logLevel: 'silent', plugins: [{ name: 'native-input-dependencies', setup(build) {
    const adapters: Record<string, string> = {
      './browser': 'export default {tv:true};',
      '../components/layoutManager': 'export default {tv:true};',
      './settings/appSettings': 'export default {enableGamepad:()=>false};',
      './gamepadtokey': 'export {};',
      'components/apphost': 'export const appHost={supports:()=>false};',
      'components/playback/playbackmanager': 'export const playbackManager={};',
      'components/router/appRouter': 'export const appRouter={};',
      'constants/appFeature': 'export const AppFeature={};',
      './scrollManager': 'export default {isEnabled:()=>false};',
      'utils/dom': 'export default {parentWithClass:(node,name)=>node?.closest("."+name),addEventListener:(node,name,fn,options)=>node.addEventListener(name,fn,options),removeEventListener:(node,name,fn,options)=>node.removeEventListener(name,fn,options)};',
      '../utils/dom': 'export default {parentWithClass:(node,name)=>node?.closest("."+name)};'
    };
    build.onResolve({ filter: /.*/ }, args => args.path === 'components/focusManager' ? { path: resolve(nativeSource, 'src/components/focusManager.js') }
      : args.path in adapters ? { path: args.path, namespace: 'native-adapter' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'native-adapter' }, args => ({ loader: 'js', contents: adapters[args.path] }));
  } }] });
  await fixture(page); await player(page); await nativePlayer(page, true, true, false);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const down = () => page.evaluate(() => {
    const active = document.activeElement!;
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
  });
  await down(); await expect(browser(page)).toHaveCount(0); await expect(page.locator('.videoOsdBottom .buttons button:focus')).toHaveCount(1);
  await down(); await expect(browser(page)).toHaveCount(0); await expect(page.locator('.osdPositionSlider')).toBeFocused();
  await down(); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back'); await expect(page.locator('.osdPositionSlider')).toBeFocused();
  await page.evaluate(() => (window as any).__actualNativeInput.handleCommand('down'));
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
});

for (const input of ['keyboard', 'remote'] as const) test(`${input} Down reaches native player controls before opening episode browsing`, async ({ page }) => {
  test.skip(!existsSync(nativeTemplatePath), 'Set TVL_JELLYFIN_WEB_SOURCE to audited Jellyfin 12 source.');
  await fixture(page); await player(page);
  await nativePlayer(page);
  const down = () => input === 'keyboard' ? page.keyboard.press('ArrowDown') : remote(page, 'down');
  await down(); await expect(browser(page)).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Native seek', exact: true })).toBeFocused();
  await down(); await expect(browser(page)).toHaveCount(0);
  await expect(page.locator('.videoOsdBottom .buttons button:focus')).toHaveCount(1);
  await down(); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await expect(page.locator('.videoOsdBottom .buttons button:focus')).toHaveCount(1);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
});

for (const input of ['keyboard', 'remote'] as const) test(`${input} Down opens episode browsing below ElegantFin's native seek slider`, async ({ page }) => {
  test.skip(!existsSync(nativeTemplatePath) || !existsSync(elegantSource), 'Set TVL_JELLYFIN_WEB_SOURCE and TVL_ELEGANTFIN_CSS to the audited upstream sources.');
  await fixture(page); await player(page); await nativePlayer(page, true);
  const seek = page.getByRole('slider', { name: 'Native seek', exact: true });
  const down = () => input === 'keyboard' ? page.keyboard.press('ArrowDown') : remote(page, 'down');
  const pauseBox = await page.locator('.btnPause').boundingBox(), seekBox = await seek.boundingBox();
  // ElegantFin reverses the native OSD rows: buttons first, then the seek bar.
  expect(seekBox!.y).toBeGreaterThan(pauseBox!.y + pauseBox!.height);
  await down(); await expect(browser(page)).toHaveCount(0);
  await expect(page.locator('.videoOsdBottom .buttons button:focus')).toHaveCount(1);
  await down(); await expect(browser(page)).toHaveCount(0); await expect(seek).toBeFocused();
  await seek.evaluate((slider: HTMLInputElement) => { slider.value = '25'; });
  await page.keyboard.press('ArrowLeft'); await expect(seek).toHaveValue('24.99');
  await page.keyboard.press('ArrowRight'); await expect(seek).toHaveValue('25');
  await down(); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back'); await expect(seek).toBeFocused();
  await expect(seek).toHaveValue('25'); await expect(page.locator('video')).toHaveJSProperty('paused', false);
  // A stale focus left in the hidden header must not disable browsing either.
  await page.getByRole('button', { name: 'Native Back', exact: true }).focus();
  await page.locator('.osdHeader').evaluate(element => element.classList.add('osdHeader-hidden'));
  await down(); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  if (input === 'keyboard') await page.screenshot({ path: test.info().outputPath('elegantfin-episode-browser.png') });
});

test('desktop Down browses below buttons while mouse seek and volume keep native editing', async ({ page }) => {
  test.skip(!existsSync(nativeTemplatePath) || !existsSync(elegantSource), 'Set TVL_JELLYFIN_WEB_SOURCE and TVL_ELEGANTFIN_CSS to the audited upstream sources.');
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`);
  await player(page); await nativePlayer(page, true, false);
  const seek = page.getByRole('slider', { name: 'Native seek', exact: true });
  await expect(seek).not.toHaveClass(/focusable/);
  await page.locator('.btnPause').focus();
  await page.keyboard.press('ArrowDown'); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await seek.evaluate((slider: HTMLInputElement) => { slider.value = '25'; }); await seek.focus(); await page.keyboard.press('ArrowDown');
  await expect(seek).toHaveValue('24.99'); await expect(browser(page)).toHaveCount(0);
  const volume = page.locator('.osdVolumeSlider');
  await volume.evaluate((slider: HTMLInputElement) => { slider.value = '25'; }); await volume.focus(); await page.keyboard.press('ArrowDown');
  await expect(volume).toHaveValue('24'); await expect(browser(page)).toHaveCount(0);
});

test('mouse-only ranges and tabindex wrappers below the player do not block remote browsing', async ({ page }) => {
  await fixture(page); await player(page);
  await page.evaluate(() => {
    const osd = document.querySelector('#videoOsdPage')!;
    const volume = document.createElement('input'); volume.type = 'range'; volume.setAttribute('aria-label', 'Mouse-only volume');
    volume.style.cssText = 'position:fixed;bottom:0;left:100px';
    const wrapper = document.createElement('div'); wrapper.tabIndex = 0;
    wrapper.style.cssText = 'position:fixed;bottom:0;left:0;width:50px;height:10px';
    osd.append(volume, wrapper);
  });
  await remote(page, 'down'); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
});

test('Down passes through wrapped playback controls and ignores hidden or disabled rows', async ({ page }) => {
  await fixture(page); await player(page);
  await page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'native-lower-control'; button.textContent = 'Lower native control';
    button.style.cssText = 'position:fixed;bottom:2px;left:24px';
    document.querySelector('#videoOsdPage')!.append(button);
  });
  expect(await remote(page, 'down')).toBe(true);
  await expect(browser(page)).toHaveCount(0);
  await page.locator('#native-lower-control').focus();
  await remote(page, 'down'); await expect(browser(page)).toBeVisible();
  await remote(page, 'back');
  for (const hidden of [false, true]) {
    await page.locator('#native-lower-control').evaluate((control: HTMLButtonElement, hidden) => { control.hidden = hidden; control.disabled = !hidden; }, hidden);
    await page.getByRole('button', { name: 'Native control', exact: true }).focus();
    await remote(page, 'down'); await expect(browser(page)).toBeVisible(); await remote(page, 'back');
  }
});
async function transition(page: Page, id: string) {
  await page.evaluate(async id => {
    const video = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer')!;
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d')!; context.fillStyle = '#38465c'; context.fillRect(0, 0, 320, 180);
    video.srcObject = canvas.captureStream(5);
    document.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = id;
    await video.play();
  }, id);
}

test('desktop mouse browsing preserves native player controls, sliders and layout, while mobile stays native', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page);
  await page.evaluate(() => {
    const state = { clicks: 0 }; (window as any).__desktopPlayerState = state;
    document.querySelector('.btnUserRating')!.addEventListener('click', () => state.clicks++);
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '25';
    slider.setAttribute('aria-label', 'Native volume'); document.querySelector('.osdControls')!.append(slider);
    document.querySelector<HTMLVideoElement>('video')!.style.cursor = 'crosshair';
  });
  await expect(page.locator('body')).toHaveClass(/layout-desktop/);
  await expect(page.locator('body')).not.toHaveClass(/layout-tv/);
  const native = page.locator('.btnUserRating'), controls = page.locator('.osdControls');
  const before = await controls.boundingBox();
  await page.locator('#tvl-player-browse').click();
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await page.screenshot({ path: test.info().outputPath('desktop-episode-browser.png') });
  await browser(page).locator('.tvl-player-next').click();
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-3');
  await browser(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(browser(page)).toHaveCount(0); await native.click();
  expect(await page.evaluate(() => (window as any).__desktopPlayerState.clicks)).toBe(1);
  const after = await controls.boundingBox();
  expect(after!.x).toBe(before!.x); expect(after!.width).toBe(before!.width);
  const slider = page.getByRole('slider', { name: 'Native volume', exact: true });
  await slider.focus(); await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveValue('24'); await expect(browser(page)).toHaveCount(0);
  await expect(page.locator('video')).toHaveCSS('cursor', 'crosshair');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.evaluate(() => document.documentElement.classList.add('layout-mobile'));
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await native.click(); expect(await page.evaluate(() => (window as any).__desktopPlayerState.clicks)).toBe(2);
  await page.evaluate(() => document.documentElement.classList.remove('layout-mobile'));
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
});

test('TV layout has no browse icon and retains remote Down entry after switching display modes', async ({ page }) => {
  await fixture(page); await player(page);
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await expect(page.getByRole('button', { name: 'Native control', exact: true })).toBeFocused();
  await page.evaluate(() => document.body.classList.replace('layout-tv', 'layout-desktop'));
  await expect(page.locator('#tvl-player-browse')).toHaveAttribute('title', 'Episodes & seasons');
  await page.evaluate(() => document.body.classList.replace('layout-desktop', 'layout-tv'));
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
});

test('native html layout changes remove the icon immediately while playback metadata is still pending', async ({ page }) => {
  await fixture(page, `
    document.body.classList.remove('layout-tv');
    document.documentElement.classList.add('layout-desktop');
    api.getPlaybackContext = async () => { window.__browserContextReads++; return new Promise(() => {}); };
  `);
  await player(page);
  const entry = page.locator('#tvl-player-browse');
  await expect(entry).toBeVisible();
  // Jellyfin's real layoutManager changes html, and the initial session request
  // can still be pending. The CSS guard must apply before observers get a turn.
  const immediateDisplay = await page.evaluate(() => {
    const current = document.getElementById('tvl-player-browse')!;
    document.documentElement.classList.replace('layout-desktop', 'layout-tv');
    return getComputedStyle(current).display;
  });
  await expect(entry).toHaveCount(0);
  expect(immediateDisplay).toBe('none');
  await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await expect(page.getByRole('button', { name: 'Native control', exact: true })).toBeFocused();
  await page.evaluate(() => document.documentElement.classList.replace('layout-tv', 'layout-desktop'));
  await expect(entry).toBeVisible();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
});

test('Down browses the complete show continuously across seasons and wraps without interrupting playback', async ({ page }) => {
  await fixture(page); await player(page);
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await expect(browser(page).getByRole('button', { name: 'Return to playback', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(browser(page).getByRole('heading', { name: 'New Shores' })).toBeVisible();
  await expect(browser(page)).toContainText('Season 2 · Episode 1');
  await expect.poll(() => browser(page).locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('episode-browser.png') });
  await page.keyboard.press('ArrowRight');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-1');
  await expect(browser(page)).toContainText('Watched');
  await page.keyboard.press('ArrowLeft');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-3');
  await page.keyboard.press('ArrowUp');
  await expect(browser(page).getByRole('button', { name: 'Season 2', exact: true })).toBeFocused();
  await remote(page, 'left'); await remote(page, 'select');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-1');
  await remote(page, 'back');
  await expect(browser(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Native control' })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([]);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
});

test('the mouse preview trigger stays outside native OSD layout and hides with its controls', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page);
  const unchangedGeometry = () => page.evaluate(() => {
    const entry = document.querySelector<HTMLElement>('#tvl-player-browse')!;
    const parent = entry.parentElement!;
    const nodes = [document.querySelector('.videoOsdBottom')!, document.querySelector('.osdControls')!, document.querySelector('.buttons')!, document.querySelector('video')!];
    const bounds = () => nodes.map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const present = bounds(); entry.remove(); const absent = bounds(); parent.append(entry);
    return { present, absent };
  });
  for (const paused of [false, true, false]) {
    await page.locator('video').evaluate(async (video: HTMLVideoElement, paused) => { if (paused) video.pause(); else await video.play(); }, paused);
    await page.mouse.move(1000, 650);
    const geometry = await unchangedGeometry(); expect(geometry.present).toEqual(geometry.absent);
  }
  const entry = page.getByRole('button', { name: 'Episodes & seasons', exact: true });
  await expect(entry).toHaveText('');
  await expect(entry).toHaveCSS('position', 'absolute');
  expect(await entry.evaluate(element => element.closest('.buttons'))).toBeNull();
  await page.screenshot({ path: test.info().outputPath('mouse-preview-icon.png') });
  await page.locator('.videoOsdBottom').evaluate(element => element.classList.add('videoOsdBottom-hidden'));
  await expect(entry).toBeHidden();
  await page.keyboard.press('ArrowDown'); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await page.locator('.videoOsdBottom').evaluate(element => element.classList.remove('videoOsdBottom-hidden'));
  await entry.click(); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
});

test('an unfamiliar native OSD keeps Down browsing without injecting a layout-dependent trigger', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page);
  await page.locator('.videoOsdBottom').evaluate(element => element.classList.remove('videoOsdBottom'));
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await expect(page.getByRole('button', { name: 'Native control' })).toBeFocused();
});

test('visible browse action returns to currently playing item and held Back never exits the native player', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page, 'browse-movie');
  await page.locator('#tvl-player-browse').click();
  await expect(browser(page).getByRole('button', { name: 'Return to playback' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(browser(page)).toHaveCount(0);
  await expect(page.locator('#tvl-player-browse')).toBeFocused();
  await remote(page, 'down'); await expect(browser(page)).toBeVisible();
  const received = await page.evaluate(() => {
    const first = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    const held = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', repeat: true, bubbles: true, cancelable: true });
    window.dispatchEvent(first); window.dispatchEvent(held);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    return [first.defaultPrevented, held.defaultPrevented];
  });
  expect(received).toEqual([true, true]);
  await expect(page).toHaveURL(/#\/video$/);
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([]);
});

test('similar films exclude unavailable titles and wait for actual selected local playback before closing', async ({ page }) => {
  await fixture(page); await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page)).toContainText('1 of 2'); await remote(page, 'right');
  await expect(browser(page).getByRole('heading', { name: 'The Other Shore' })).toBeVisible();
  await remote(page, 'ok');
  await expect(browser(page).getByRole('status')).toHaveText('Starting playback…');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([{ id: 'browse-next', ticks: 3000000000 }]);
  // Jellyfin updates the OSD ID before loading; that alone is not success.
  await page.locator('.btnUserRating').evaluate(element => (element as HTMLElement).dataset.id = 'browse-next');
  await page.waitForTimeout(250); await expect(browser(page)).toBeVisible();
  await transition(page, 'browse-next'); await expect(browser(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Native control' })).toBeFocused();
});

test('episode playback preserves resume ticks, reports dispatch failure, and allows retry', async ({ page }) => {
  await fixture(page, `let failed=false; api.play=async(item,ticks,current)=>{ if(!failed){failed=true;throw new Error('The server is unavailable.');} if(current())window.__browserPlays.push({id:item.Id,ticks}); };`);
  await player(page, 'browse-episode-1'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-1'); await remote(page, 'right'); await remote(page, 'select');
  await expect(browser(page).getByRole('status')).toHaveText('The server is unavailable.');
  await expect(browser(page).getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([{ id: 'browse-episode-2', ticks: 6000000000 }]);
  await transition(page, 'browse-episode-2'); await expect(browser(page)).toHaveCount(0);
});

test('Live TV previews the programme, falls back to channel logo and confirms programme-to-channel tuning', async ({ page }) => {
  await fixture(page); await player(page, 'browse-channel'); await remote(page, 'down');
  await expect(browser(page).getByRole('heading', { name: 'Hidden Forests' })).toBeVisible();
  await remote(page, 'right');
  await expect(browser(page).getByRole('heading', { name: 'Coastal Roads' })).toBeVisible();
  await expect(browser(page).locator('img')).toHaveAttribute('src', /browse-channel-2-logo/);
  await remote(page, 'select');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([{ id: 'browse-channel-2', ticks: 0 }]);
  await transition(page, 'browse-program-2');
  await expect(browser(page)).toHaveCount(0);
});

test('cinema intro resolves the exact queued feature and refuses ambiguous queue occurrences', async ({ page }) => {
  await fixture(page, `window.__browserContext={PlayingItemId:'browse-trailer',PlayingItemType:'Trailer',PlaylistItemId:'intro-2',Queue:[{Id:'browse-trailer',PlaylistItemId:'intro-1'},{Id:'browse-movie'},{Id:'browse-trailer',PlaylistItemId:'intro-2'},{Id:'browse-next'}]};`);
  await player(page, 'browse-trailer'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-next');
  await expect(browser(page)).toContainText('Up next after intro');
  await remote(page, 'back');
  await page.evaluate(() => { delete (window as any).__browserContext.PlaylistItemId; });
  await page.waitForTimeout(1200); await remote(page, 'down');
  await expect(browser(page).getByRole('status')).toContainText('Browsing will be available');
  await expect(browser(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('newly queued cinema intro is only confirmed once its local source starts', async ({ page }) => {
  await fixture(page); await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie'); await remote(page, 'right'); await remote(page, 'select');
  await page.evaluate(() => {
    (window as any).__browserContext = { PlayingItemId: 'browse-trailer', PlayingItemType: 'Trailer', PlaylistItemId: 'new-intro', Queue: [{ Id: 'browse-trailer', PlaylistItemId: 'new-intro' }, { Id: 'browse-next' }] };
    document.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = 'browse-trailer';
  });
  await page.waitForTimeout(900); await expect(browser(page)).toBeVisible();
  await transition(page, 'browse-trailer'); await expect(browser(page)).toHaveCount(0);
});

test('local playback context supports an OSD whose rating ID is not populated yet', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');window.__browserContext={PlayingItemId:'browse-movie',PlayingItemType:'Movie',Queue:[]};`);
  await player(page, 'browse-movie', false); await page.locator('#tvl-player-browse').click();
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie');
});

test('slow loading and pending playback are canceled when navigation leaves the native player', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');api.getSimilar=async()=>{ await new Promise(resolve=>window.__releaseBrowser=resolve); return [items.get('browse-next')]; };`);
  await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page).getByRole('status')).toHaveText('Loading…');
  await page.evaluate(() => { location.hash = '/home'; (window as any).__releaseBrowser(); });
  await expect(browser(page)).toHaveCount(0); await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/video'; });
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.getSimilar = async () => [(window as any).__browserItems.get('browse-next')];
    api.play = async (item, ticks, current) => { await new Promise<void>(resolve => (window as any).__releasePlay = resolve); if (current()) (window as any).__browserPlays.push({ id: item.Id, ticks }); };
  });
  await remote(page, 'down'); await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie');
  await remote(page, 'right'); await remote(page, 'select');
  await expect(browser(page).getByRole('status')).toHaveText('Starting playback…');
  await remote(page, 'back'); await page.evaluate(() => (window as any).__releasePlay());
  await expect(browser(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([]);
});

test('native dialogs and available standalone preview controls retain input', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page, 'browse-movie');
  await page.evaluate(() => {
    const dialog = document.createElement('section'); dialog.id = 'native-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = 'position:fixed;inset:10%;z-index:2000;background:black';
    const input = document.createElement('input'); dialog.append(input); document.body.append(dialog); input.focus();
  });
  expect(await remote(page, 'down')).toBe(true); await expect(browser(page)).toHaveCount(0);
  await page.evaluate(() => { document.querySelector('#native-dialog')!.remove(); const button = document.createElement('button'); button.id = 'popupPreviewButton'; button.textContent = 'Standalone preview'; document.querySelector('.buttons')!.append(button); });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  expect(await remote(page, 'down')).toBe(true); await expect(browser(page)).toHaveCount(0);
  await page.locator('#popupPreviewButton').evaluate((element: HTMLButtonElement) => { element.disabled = true; });
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await remote(page, 'down'); await expect(browser(page)).toBeVisible();
  await page.locator('#popupPreviewButton').evaluate((element: HTMLButtonElement) => { element.disabled = false; });
  await expect(browser(page)).toHaveCount(0);
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.locator('#popupPreviewButton').evaluate((element: HTMLElement) => { element.style.display = 'none'; });
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
});

test('a stale standalone script and hidden preview markup do not disable Down', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page);
  await page.route('**/InPlayerPreview/ClientScript', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addScriptTag({ url: '/InPlayerPreview/ClientScript' });
  await page.evaluate(() => {
    const stale = document.createElement('section'); stale.hidden = true;
    stale.innerHTML = '<button id="popupPreviewButton">Preview</button><div id="tvEpisodePreview"></div><div id="previewPopup"></div>';
    document.body.append(stale);
  });
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  await remote(page, 'back');
  await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([]);
});

for (const order of ['before', 'after']) {
  test(`a working standalone TV preview takes Down when its handler loads ${order} the layout`, async ({ page }) => {
    const standalone = () => {
      const handle = (event: Event) => {
        const down = event.type === 'keydown' ? (event as KeyboardEvent).key === 'ArrowDown' : (event as CustomEvent).detail?.command === 'down';
        if (!down || document.querySelector('#tvEpisodePreview')) return;
        const panel = document.createElement('section'); panel.id = 'tvEpisodePreview';
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
        panel.style.cssText = 'position:fixed;inset:20%;z-index:3000;background:black';
        panel.innerHTML = '<button>Standalone TV preview</button>'; document.body.append(panel);
        (window as any).__standaloneOpens = ((window as any).__standaloneOpens || 0) + 1;
        event.preventDefault(); event.stopImmediatePropagation();
      };
      window.addEventListener('keydown', handle, true); window.addEventListener('command', handle, true);
    };
    if (order === 'before') await page.addInitScript(standalone);
    await fixture(page); await player(page);
    await page.route('**/InPlayerPreview/ClientScript', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addScriptTag({ url: '/InPlayerPreview/ClientScript' });
    if (order === 'after') await page.evaluate(standalone);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Standalone TV preview' })).toBeVisible();
    await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
    await expect(browser(page)).toHaveCount(0);
    await page.locator('#tvEpisodePreview').evaluate(element => element.remove());
    await remote(page, 'down');
    await expect(page.getByRole('button', { name: 'Standalone TV preview' })).toBeVisible();
    await expect(browser(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__standaloneOpens)).toBe(2);
  });
}

test('completed films without a new position restart from zero and descriptions render as plain text', async ({ page }) => {
  await fixture(page, `items.get('browse-next').UserData={Played:true,PlaybackPositionTicks:0};items.get('browse-next').Overview='<p>A <strong>new</strong> mystery.</p>';`);
  await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie'); await remote(page, 'right');
  await expect(browser(page).locator('.tvl-player-description')).toHaveText('A new mystery.');
  await expect(browser(page).getByRole('button', { name: 'Play', exact: true })).toBeFocused();
  await remote(page, 'select');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([{ id: 'browse-next', ticks: 0 }]);
  await remote(page, 'back');
});

test('a partly rewatched film resumes at its saved position and shows current progress', async ({ page }) => {
  await fixture(page, `items.get('browse-next').UserData={Played:true,PlaybackPositionTicks:38000000000,PlayedPercentage:100,PlayCount:5};`);
  await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie'); await remote(page, 'right');
  await expect(browser(page).getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  await expect(browser(page).locator('.tvl-player-meta')).not.toContainText('Watched');
  expect(await browser(page).locator('.tvl-player-progress > div').evaluate(node => parseFloat((node as HTMLElement).style.width))).toBeCloseTo(66.6667, 3);
  await remote(page, 'select');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([{ id: 'browse-next', ticks: 38000000000 }]);
  expect(await page.evaluate(() => (window as any).__browserItems.get('browse-next').UserData)).toEqual({Played:true,PlaybackPositionTicks:38000000000,PlayedPercentage:100,PlayCount:5});
  await remote(page, 'back');
});

test('Cinema layout gate, hidden OSD, theme videos, audio-only media and sign-out suppress in-player browsing', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');`); await player(page, 'browse-movie');
  await page.evaluate(() => { document.documentElement.classList.remove('layout-desktop'); document.body.classList.remove('layout-desktop'); });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.classList.add('layout-desktop'); document.body.classList.add('layout-desktop'); });
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await page.locator('#videoOsdPage').evaluate(element => element.setAttribute('hidden', ''));
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.locator('#videoOsdPage').evaluate(element => element.removeAttribute('hidden'));
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await page.locator('.videoPlayerContainer').evaluate(element => element.classList.add('tvl-theme-player'));
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.locator('.videoPlayerContainer').evaluate(element => element.classList.remove('tvl-theme-player'));
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await page.evaluate(async () => {
    const audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
    oscillator.connect(destination); oscillator.start();
    const video = document.querySelector<HTMLVideoElement>('video')!; video.srcObject = destination.stream; await video.play();
  });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await transition(page, 'browse-movie');
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await page.evaluate(() => { delete window.TvItemLayoutDemo; });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
});

test('a deleted cinema intro resolves through confirmed queue metadata and unchanged intro never confirms a new play', async ({ page }) => {
  await fixture(page, `items.delete('browse-trailer'); api.getItem=async id=>{ if(id==='browse-trailer')throw new Error('Intro is not in library'); return items.get(id)||originalGet(id); }; window.__browserContext={PlayingItemId:'browse-trailer',PlayingItemType:'Trailer',PlaylistItemId:'existing-intro',Queue:[{Id:'browse-trailer',PlaylistItemId:'existing-intro'},{Id:'browse-movie'}]};`);
  await player(page, 'browse-trailer'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie');
  await expect(browser(page)).toContainText('Up next after intro');
  await remote(page, 'select');
  await expect(browser(page).getByRole('status')).toHaveText('Starting playback…');
  await transition(page, 'browse-trailer');
  await page.waitForTimeout(950);
  await expect(browser(page)).toBeVisible();
  await remote(page, 'back'); await expect(browser(page)).toHaveCount(0);
});

test('account changes discard cached metadata and late responses from the previous account', async ({ page }) => {
  await fixture(page, `document.body.classList.replace('layout-tv', 'layout-desktop');api.serverId='server-a';api.userId='user-a';const originalBrowserGet=api.getItem;api.getItem=async id=>{if(id==='browse-movie'&&api.userId==='user-a'){const old={...items.get(id),Name:'Previous account movie'};await new Promise(resolve=>{(window.__oldUserResolves||=[]).push(resolve);});return old;}return originalBrowserGet(id);};`);
  await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page).getByRole('status')).toHaveText('Loading…');
  await page.evaluate(() => {
    window.TvItemLayoutDemo!.api.userId = 'user-b';
    (window as any).__browserItems.get('browse-movie').Name = 'New account movie';
    document.querySelector('#videoOsdPage')!.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
  });
  await expect(browser(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).__oldUserResolves.forEach((resolve: () => void) => resolve()));
  await page.locator('#tvl-player-browse').click();
  await expect(browser(page).getByRole('heading', { name: 'New account movie' })).toBeVisible();
  await expect(browser(page)).not.toContainText('Previous account movie');
  await remote(page, 'back');
  await page.locator('#tvl-player-browse').click();
  await expect(browser(page).getByRole('heading', { name: 'New account movie' })).toBeVisible();
});

test('a compact viewport keeps content and primary playback controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await fixture(page); await player(page); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-episode-2');
  const bounds = await browser(page).boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(540);
  const button = await browser(page).getByRole('button', { name: 'Return to playback' }).boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(540);
  await expect.poll(() => browser(page).locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('compact-browser.png') });
});
