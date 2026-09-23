import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read the actual queue template and styles without vendoring GPL source into
// this MIT project. Audited upstream: jellyfin/jellyfin-web v12.0, revision
// 0e83c6a724b31f3e9b5a499244331a288c060a4a (upstream LICENSE: GPL v2).
// Set TVL_JELLYFIN_WEB_SOURCE to that checkout to run these integration checks.
// Dynamic children follow remotecontrol.js, emby-slider.js and listview.js;
// callbacks are fixture-owned, so this does not claim server playback coverage.
const source = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const templatePath = resolve(source, 'src/apps/legacy/controllers/playback/queue/index.html');
const available = existsSync(templatePath);
const template = available ? readFileSync(templatePath, 'utf8').replace(/\$\{([^}]+)\}/g, (_, key) => key) : '';
const nativeCss = available ? [
  'src/components/remotecontrol/remotecontrol.scss',
  'src/elements/emby-button/emby-button.scss',
  'src/elements/emby-slider/emby-slider.scss',
  'src/components/listview/listview.scss',
].map(path => readFileSync(resolve(source, path), 'utf8')
  // The only Sass directives here are remotecontrol's import and mobile-safe-
  // area mixins. Native nesting is supported by the test browser; TV layout
  // never uses those mobile-only declarations.
  .replace(/^\s*@(?:use|include)\s+[^;]+;/gm, '')).join('\n') : '';
test.skip(!available, 'Set TVL_JELLYFIN_WEB_SOURCE to the audited Jellyfin 12 web checkout.');

async function setup(page: Page, artwork: 'image' | 'missing' | 'empty' = 'image') {
  await page.goto('/?featured=0#/queue');
  await page.locator('style[data-tv-item-layout]').waitFor({ state: 'attached' });
  await page.evaluate(({ template, nativeCss, artwork }) => {
    document.documentElement.classList.add('layout-tv'); document.documentElement.dir = 'ltr';
    const style = document.createElement('style');
    // Load native styles after Cinema, as happens on a first visit to #/queue.
    style.textContent = nativeCss + `
      .hide{display:none!important}.flex{display:flex}.align-items-center{align-items:center}.flex-wrap-wrap{flex-wrap:wrap}.justify-content-center{justify-content:center}.justify-content-space-between{justify-content:space-between}
      body{margin:0}body>:not(#nowPlayingPage):not(script):not(style){display:none!important}#nowPlayingPage{position:relative;z-index:100;min-height:100vh;box-sizing:border-box}.remoteControlContent{background:#006e98}
      .material-icons{font-family:Arial,sans-serif;font-style:normal;font-size:1.7rem;line-height:1;width:1em;height:1em;display:inline-block;text-align:center}
      .nowPlayingPageImageContainerNoAlbum .cardImageContainer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:0}
      .listItemImage{background:#314b3c}.listItem-button{width:100%}`;
    document.head.append(style);
    document.querySelector('#nowPlayingPage')?.remove();
    document.body.insertAdjacentHTML('beforeend', template);
    const queue = document.querySelector<HTMLElement>('#nowPlayingPage')!;
    const content = queue.querySelector('.remoteControlContent')!;
    content.classList.add('hideVideoButtons');
    queue.querySelector('.remoteControlSection')!.classList.add('hide');
    queue.querySelector('.nowPlayingPageTitle')!.classList.add('hide');
    queue.querySelector('.nowPlayingSongName')!.textContent = artwork === 'empty' ? '' : 'Tidelight';
    queue.querySelector('.nowPlayingAlbum')!.innerHTML = artwork === 'empty' ? '' : '<a class="button-link" is="emby-linkbutton" href="#/album">Quiet Water</a>';
    queue.querySelector('.nowPlayingArtist')!.innerHTML = artwork === 'empty' ? '' : '<a class="button-link" is="emby-linkbutton" href="#/artist">Mira Vale</a>';
    queue.querySelector('.positionTime')!.textContent = artwork === 'empty' ? '0:00' : '1:12';
    queue.querySelector('.runtime')!.textContent = artwork === 'empty' ? '0:00' : '4:48';
    const art = queue.querySelector('.nowPlayingPageImageContainer')!;
    if (artwork === 'image') art.innerHTML = `<img class="nowPlayingPageImage nowPlayingPageImageAudio" alt="Album artwork" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%23354e44'/%3E%3Ccircle cx='250' cy='250' r='160' fill='%23b9cabd'/%3E%3Ccircle cx='250' cy='250' r='55' fill='%23354e44'/%3E%3C/svg%3E">`;
    if (artwork === 'missing') art.innerHTML = '<div class="nowPlayingPageImageContainerNoAlbum"><button class="cardImageContainer coveredImage defaultCardBackground cardContent cardContent-shadow itemAction" tabindex="-1"><span class="cardImageIcon material-icons album" aria-hidden="true">♫</span></button></div>';
    queue.querySelector('.nowPlayingSecondaryButtons')!.insertAdjacentHTML('beforeend', '<div class="volumecontrol flex align-items-center flex-wrap-wrap justify-content-center"><button is="paper-icon-button-light" class="buttonMute autoSize" title="Mute"><span class="xlargePaperIconButton material-icons volume_up" aria-hidden="true">♪</span></button><div class="sliderContainer nowPlayingVolumeSliderContainer"><input is="emby-slider" type="range" min="0" max="100" step="1" value="75" class="nowPlayingVolumeSlider" aria-label="Volume"></div></div>');
    queue.querySelectorAll<HTMLButtonElement>('button[is="paper-icon-button-light"]').forEach(button => button.classList.add('paper-icon-button-light', 'show-focus'));
    const glyphs: Record<string, string> = { repeat: '↻', replay_10: '↶', skip_previous: '◂', pause_circle_filled: 'Ⅱ', stop: '■', skip_next: '▸', forward_30: '↷', shuffle: '⤨', lyrics: '≡', save: '↓', more_vert: '⋮' };
    queue.querySelectorAll<HTMLElement>('.material-icons').forEach(icon => { for (const [name, glyph] of Object.entries(glyphs)) if (icon.classList.contains(name)) icon.textContent = glyph; });
    const sliders = queue.querySelectorAll<HTMLInputElement>('input[type="range"]');
    sliders.forEach(input => {
      input.classList.add('mdl-slider');
      const wrapper = document.createElement('div'); wrapper.className = 'mdl-slider-container';
      input.before(wrapper); wrapper.append(input);
      wrapper.insertAdjacentHTML('beforeend', '<div class="mdl-slider-background-flex-container"><div class="mdl-slider-background-flex"><div class="mdl-slider-background-flex-inner"><div class="mdl-slider-background-upper"></div><div class="mdl-slider-background-lower"></div></div></div></div><div class="sliderBubbleTrack"><div class="sliderBubble hide"></div></div>');
    });
    const seek = queue.querySelector<HTMLInputElement>('.nowPlayingPositionSlider')!; seek.classList.add('focusable'); seek.setAttribute('aria-label', 'Seek'); seek.value = '25';
    const playlist = queue.querySelector('#playlist')!;
    if (artwork !== 'empty') {
      playlist.classList.remove('hide'); queue.querySelector('.btnSavePlaylist')!.classList.remove('hide');
      // TV listview uses one button per row; row actions live in its native menu.
      playlist.innerHTML = ['Tidelight', 'Night Crossing', 'The Long Way Home'].map((name, i) => `<button class="listItem itemAction listItem-button listItem-focusscale" data-action="setplaylistindex" data-playlistitemid="track-${i}"><div class="listItemImage"></div><div class="listItemBody"><div class="listItemBodyText">${name}</div><div class="secondary listItemBodyText">Mira Vale · Quiet Water</div></div><div class="listViewUserDataButtons"></div></button>`).join('');
    } else queue.querySelectorAll<HTMLButtonElement>('.btnPlayStateCommand,.btnSavePlaylist').forEach(button => { button.disabled = true; });
    const state = { paused: false, track: 0, repeat: false, shuffle: false, muted: false, seek: 25, volume: 75, saves: 0 };
    (window as any).__musicNativeState = state;
    (window as any).__musicNativeNodes = [queue, queue.querySelector('.btnPlayPause'), playlist, seek];
    queue.querySelector('.btnPlayPause')!.addEventListener('click', () => { state.paused = !state.paused; });
    queue.querySelector('.nowPlayingSecondaryButtons .btnRepeat')!.addEventListener('click', event => { state.repeat = !state.repeat; (event.currentTarget as HTMLElement).classList.toggle('buttonActive', state.repeat); });
    queue.querySelector('.nowPlayingSecondaryButtons .btnShuffleQueue')!.addEventListener('click', () => { state.shuffle = !state.shuffle; });
    queue.querySelector('.buttonMute')!.addEventListener('click', () => { state.muted = !state.muted; });
    queue.querySelector('.btnSavePlaylist')!.addEventListener('click', () => { state.saves++; });
    seek.addEventListener('input', () => { state.seek = +seek.value; });
    queue.querySelector('.nowPlayingVolumeSlider')!.addEventListener('input', event => { state.volume = +(event.target as HTMLInputElement).value; });
    playlist.addEventListener('click', event => { const row = (event.target as HTMLElement).closest<HTMLElement>('[data-playlistitemid]'); if (row) state.track = +row.dataset.playlistitemid!.slice(-1); });
  }, { template, nativeCss, artwork });
  // Cinema applies its owned layout marker on the scheduled initial refresh.
  // Wait for the rendered queue layout before measuring artwork geometry.
  await expect(page.locator('#nowPlayingPage .nowPlayingInfoContainer')).toHaveCSS('display', 'grid');
}

test('Jellyfin 12 queue has a full Cinema hero and usable native playback controls', async ({ page }) => {
  await setup(page);
  const queue = page.locator('#nowPlayingPage');
  await expect(queue.locator('.remoteControlContent')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(queue.locator('.nowPlayingInfoContainer')).toHaveCSS('display', 'grid');
  const art = await queue.locator('.nowPlayingPageImage').boundingBox();
  const title = await queue.locator('.nowPlayingSongName').boundingBox();
  expect(art!.width).toBeGreaterThan(300); expect(title!.x).toBeGreaterThan(art!.x + art!.width);
  await expect(queue.locator('.nowPlayingInfoButtons .btnRepeat')).toBeHidden();
  await expect(queue.locator('.nowPlayingInfoButtons .btnShuffleQueue')).toBeHidden();
  await expect(queue.locator('.videoButton').first()).toBeHidden();
  await expect(queue.locator('.btnLyrics')).toBeHidden();
  await queue.locator('.btnPlayPause').focus();
  await expect(queue.locator('.btnPlayPause')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await queue.locator('.nowPlayingSecondaryButtons .btnRepeat').click();
  await queue.locator('.nowPlayingSecondaryButtons .btnShuffleQueue').click();
  await queue.locator('.buttonMute').click();
  await queue.getByRole('slider', { name: 'Seek', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await queue.getByRole('slider', { name: 'Volume', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
  await queue.locator('[data-playlistitemid="track-1"]').focus(); await page.keyboard.press('Enter');
  await queue.locator('.btnSavePlaylist').click();
  expect(await page.evaluate(() => (window as any).__musicNativeState)).toEqual({ paused: true, track: 1, repeat: true, shuffle: true, muted: true, seek: 26, volume: 74, saves: 1 });
  expect(await page.evaluate(() => (window as any).__musicNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('jellyfin12-music-player.png'), fullPage: true });
});

for (const width of [800, 390]) test(`native queue controls and artwork fit a ${width}px TV viewport`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const queue = page.locator('#nowPlayingPage');
  await expect(queue.locator('.btnPlayPause')).toHaveCSS('background-color', 'rgb(245, 245, 242)');
  for (const selector of ['.nowPlayingPageImage', '.nowPlayingInfoControls', '.nowPlayingPositionSlider', '.volumecontrol', '.nowPlayingPlaylist']) {
    const box = await queue.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull(); expect(box!.x, selector).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width, selector).toBeLessThanOrEqual(width + 1);
  }
  const art = await queue.locator('.nowPlayingPageImage').boundingBox(), title = await queue.locator('.nowPlayingSongName').boundingBox();
  if (width < 680) expect(title!.y).toBeGreaterThanOrEqual(art!.y + art!.height);
  await queue.locator('.nowPlayingSecondaryButtons .btnShuffleQueue').click();
  expect(await page.evaluate(() => (window as any).__musicNativeState.shuffle)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`jellyfin12-music-${width}.png`), fullPage: true });
});

test('missing artwork and idle player preserve bounded artwork and native disabled/hidden states', async ({ page }) => {
  await setup(page, 'missing');
  const art = page.locator('#nowPlayingPage .nowPlayingPageImageContainer');
  const artBox = await art.boundingBox(), iconBox = await art.locator('.cardImageIcon').boundingBox();
  expect(artBox!.height).toBeGreaterThan(250);
  expect(iconBox!.x).toBeGreaterThanOrEqual(artBox!.x); expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(artBox!.x + artBox!.width);
  await setup(page, 'empty');
  await expect(page.locator('#nowPlayingPage .btnPlayPause')).toBeDisabled();
  await expect(page.locator('#nowPlayingPage #playlist')).toBeHidden();
  const empty = await page.locator('#nowPlayingPage .nowPlayingPageImageContainer').boundingBox();
  expect(Math.abs(empty!.width - empty!.height)).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath('jellyfin12-music-idle.png') });
});

test('real queue remains themed on desktop, releases on mobile and preserves native nodes on teardown', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { document.documentElement.classList.remove('layout-tv'); document.body.classList.remove('layout-tv'); document.documentElement.classList.add('layout-desktop'); });
  await expect(page.locator('#nowPlayingPage .nowPlayingInfoContainer')).toHaveCSS('display', 'grid');
  await page.locator('#nowPlayingPage .btnPlayPause').click();
  await page.getByRole('slider', { name: 'Seek', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => (window as any).__musicNativeState.paused)).toBe(true);
  expect(await page.evaluate(() => (window as any).__musicNativeState.seek)).toBe(26);
  await expect(page.locator('html')).toHaveClass(/layout-desktop/);
  await expect(page.locator('html')).not.toHaveClass(/layout-tv/);
  await page.evaluate(() => document.body.classList.add('layout-mobile'));
  await expect(page.locator('#nowPlayingPage .nowPlayingInfoContainer')).toHaveCSS('display', 'flex');
  await expect(page.locator('#nowPlayingPage .remoteControlContent')).toHaveCSS('background-color', 'rgb(0, 110, 152)');
  await page.evaluate(() => { document.body.classList.remove('layout-mobile'); });
  await expect(page.locator('#nowPlayingPage .nowPlayingInfoContainer')).toHaveCSS('display', 'grid');
  await page.evaluate(() => window.TvItemLayout?.destroy());
  await expect(page.locator('#nowPlayingPage .nowPlayingInfoContainer')).toHaveCSS('display', 'flex');
  expect(await page.evaluate(() => (window as any).__musicNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
});
