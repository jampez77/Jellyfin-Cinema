import { expect, test, type Page } from '@playwright/test';

// Native selectors/structure from Jellyfin 10.11 + 12 nowPlayingBar and
// playback/queue. The fixture owns actions just as Jellyfin does in production.
async function nativeMusicPlayer(page: Page) {
  await page.goto('/#/queue');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `.hide{display:none!important}#nowPlayingPage{position:relative;z-index:100;padding:100px 32px 120px;min-height:600px}.nowPlayingInfoContainer{display:flex}.nowPlayingPageImageContainer{width:16%;margin-right:1em}.nowPlayingPageImage{width:100%}.nowPlayingInfoControls{flex:1;min-width:0}.nowPlayingInfoButtons,.nowPlayingButtonsContainer{display:flex;align-items:center}.nowPlayingButtonsContainer{justify-content:space-between}.sliderContainer{display:flex;align-items:center}.nowPlayingPositionSliderContainer{flex:1;margin:1em}.nowPlayingPlaylist .listItem{display:flex;align-items:center}.listItemBody{flex:1;padding:1em;background:transparent;border:0;color:inherit;text-align:left}.listItemImage{width:3em;height:3em}.nowPlayingBar{position:fixed;bottom:0;left:0;right:0;z-index:1000}.nowPlayingBarTop{display:flex;align-items:center;height:4.2em;position:relative}.nowPlayingBarInfoContainer{display:flex;width:40%;align-items:center}.nowPlayingImage{width:4.2em;height:3em}.nowPlayingBarCenter{display:flex;align-items:center;position:absolute;left:42%}.nowPlayingBarRight{display:flex;margin-left:auto}.nowPlayingBarPositionContainer{position:absolute;top:-.6em;left:0;right:0}.nowPlayingBar-hidden{transform:translateY(100%)}.paper-icon-button-light,.mediaButton{border:0;background:transparent;font-size:18px;padding:.7em;cursor:pointer}.mdl-slider{color:#00a4dc}.nowPlayingPositionSlider,.nowPlayingBarPositionSlider{width:100%}.mdl-slider-background-lower{background:#00a4dc;height:3px;width:35%}`;
    document.head.append(style);
    const queue = document.createElement('main'); queue.id = 'nowPlayingPage'; queue.className = 'page libraryPage nowPlayingPage hideVideoButtons';
    queue.innerHTML = `<div class="remoteControlContent">
      <div class="nowPlayingInfoContainer">
        <div class="nowPlayingPageImageContainer"><img class="nowPlayingPageImage nowPlayingPageImageAudio" alt="Album artwork" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23354e44'/%3E%3Ccircle cx='150' cy='150' r='90' fill='%23b9cabd'/%3E%3C/svg%3E"></div>
        <div class="nowPlayingInfoControls"><div class="nowPlayingInfoContainerMedia"><h2 class="nowPlayingPageTitle hide">Album</h2><h2 class="nowPlayingSongName">Tidelight</h2><div class="nowPlayingAlbum">Quiet Water</div><div class="nowPlayingArtist">Mira Vale</div></div>
          <div class="sliderContainer"><span class="positionTime">1:12</span><div class="nowPlayingPositionSliderContainer"><input aria-label="Seek" class="nowPlayingPositionSlider mdl-slider" type="range" min="0" max="100" value="25"><div class="mdl-slider-background-lower"></div></div><span class="runtime">4:48</span></div>
          <div class="nowPlayingButtonsContainer"><div class="nowPlayingInfoButtons">
            <button class="paper-icon-button-light btnRepeat repeatToggleButton" aria-label="Repeat">↻</button><button class="paper-icon-button-light btnPreviousTrack" aria-label="Previous track">◀</button><button class="paper-icon-button-light btnPlayPause" aria-label="Pause">Ⅱ</button><button class="paper-icon-button-light btnStop" aria-label="Stop">■</button><button class="paper-icon-button-light btnNextTrack" aria-label="Next track">▶</button><button class="paper-icon-button-light btnShuffleQueue" aria-label="Shuffle">⤨</button>
          </div><div class="nowPlayingSecondaryButtons"><button class="paper-icon-button-light btnSubtitles hide" aria-label="Subtitles">CC</button><button class="paper-icon-button-light btnLyrics" aria-label="Lyrics">Lyrics</button></div></div>
        </div>
      </div>
      <div class="playlistSection"><div class="playlistSectionButton"><button class="paper-icon-button-light btnSavePlaylist">Save playlist</button></div><div id="playlist" class="playlist itemsContainer vertical-list nowPlayingPlaylist" data-dragreorder="true"><div class="listItem" data-playlistitemid="track-1"><div class="listItemImage playlistIndexIndicatorImage"></div><button class="listItemBody" data-action="setplaylistindex"><div class="listItemBodyText">Tidelight</div><div class="listItemBodyText">Mira Vale · Quiet Water</div></button><button class="paper-icon-button-light" data-action="remove" aria-label="Remove Tidelight">×</button></div><div class="listItem" data-playlistitemid="track-2"><div class="listItemImage"></div><button class="listItemBody" data-action="setplaylistindex"><div class="listItemBodyText">Night Crossing</div><div class="listItemBodyText">Mira Vale · Quiet Water</div></button><button class="paper-icon-button-light" data-action="remove" aria-label="Remove Night Crossing">×</button></div></div></div>
    </div>`;
    const bar = document.createElement('aside'); bar.className = 'nowPlayingBar';
    bar.innerHTML = `<div class="nowPlayingBarTop"><div class="nowPlayingBarPositionContainer sliderContainer"><input aria-label="Mini player seek" class="mdl-slider nowPlayingBarPositionSlider" type="range" min="0" max="100" value="25"></div><div class="nowPlayingBarInfoContainer"><div class="nowPlayingImage"></div><div class="nowPlayingBarText">Tidelight<div class="nowPlayingBarSecondaryText">Mira Vale</div></div></div><div class="nowPlayingBarCenter"><button class="mediaButton previousTrackButton" aria-label="Mini previous">◀</button><button class="mediaButton playPauseButton" aria-label="Mini pause">Ⅱ</button><button class="mediaButton nextTrackButton" aria-label="Mini next">▶</button></div><div class="nowPlayingBarRight"><button class="mediaButton muteButton" aria-label="Mute">Volume</button><input aria-label="Volume" class="mdl-slider nowPlayingBarVolumeSlider" type="range" min="0" max="100" value="75"><button class="mediaButton openLyricsButton hide">Lyrics</button></div></div>`;
    document.body.append(queue, bar);
    const state = { paused: false, track: 0, repeat: false, shuffle: false, muted: false, seek: 25, volume: 75, saves: 0, lyrics: 0 };
    (window as any).__musicState = state;
    (window as any).__musicNativeNodes = [queue, bar, queue.querySelector('.btnPlayPause'), queue.querySelector('#playlist')];
    queue.querySelector('.btnPlayPause')!.addEventListener('click', () => { state.paused = !state.paused; });
    bar.querySelector('.playPauseButton')!.addEventListener('click', () => { state.paused = !state.paused; });
    for (const host of [queue, bar]) {
      host.querySelector('.btnNextTrack,.nextTrackButton')!.addEventListener('click', () => { state.track++; });
      host.querySelector('.btnPreviousTrack,.previousTrackButton')!.addEventListener('click', () => { state.track--; });
    }
    queue.querySelector('.btnRepeat')!.addEventListener('click', event => { state.repeat = !state.repeat; (event.currentTarget as HTMLElement).classList.toggle('buttonActive', state.repeat); });
    queue.querySelector('.btnShuffleQueue')!.addEventListener('click', event => { state.shuffle = !state.shuffle; (event.currentTarget as HTMLElement).classList.toggle('buttonActive', state.shuffle); });
    queue.querySelector('.btnSavePlaylist')!.addEventListener('click', () => { state.saves++; });
    queue.querySelector('.btnLyrics')!.addEventListener('click', () => { state.lyrics++; });
    bar.querySelector('.muteButton')!.addEventListener('click', () => { state.muted = !state.muted; });
    queue.querySelector('.nowPlayingPositionSlider')!.addEventListener('input', event => { state.seek = +(event.target as HTMLInputElement).value; });
    bar.querySelector('.nowPlayingBarVolumeSlider')!.addEventListener('input', event => { state.volume = +(event.target as HTMLInputElement).value; });
    queue.querySelector('#playlist')!.addEventListener('click', event => {
      const control = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (control?.dataset.action === 'remove') control.closest('.listItem')!.remove();
      else if (control) state.track = control.closest<HTMLElement>('.listItem')!.dataset.playlistitemid === 'track-2' ? 1 : 0;
    });
  });
}

test('native music player and queue use Cinema colours while native actions remain functional', async ({ page }) => {
  await nativeMusicPlayer(page);
  const queue = page.locator('#nowPlayingPage'), bar = page.locator('.nowPlayingBar');
  await expect(queue).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(bar).toHaveCSS('color', 'rgb(245, 245, 242)');
  await expect(bar.locator('.playPauseButton')).toHaveCSS('background-color', 'rgb(245, 245, 242)');
  await expect(queue.locator('.nowPlayingArtist')).toHaveCSS('color', 'rgb(185, 196, 189)');
  await expect(queue.getByRole('button', { name: 'Subtitles' })).toBeHidden();
  await expect(bar.locator('.openLyricsButton')).toBeHidden();
  await queue.getByRole('button', { name: 'Pause', exact: true }).focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__musicState.paused)).toBe(true);
  await bar.getByRole('button', { name: 'Mini pause' }).click();
  expect(await page.evaluate(() => (window as any).__musicState.paused)).toBe(false);
  await queue.getByRole('button', { name: 'Repeat', exact: true }).click(); await queue.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await expect(queue.locator('.btnRepeat')).toHaveCSS('background-color', 'rgb(52, 65, 58)');
  await queue.getByRole('slider', { name: 'Seek', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await bar.getByRole('slider', { name: 'Volume', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
  await queue.getByRole('button', { name: 'Night Crossing Mira Vale · Quiet Water' }).click();
  await queue.getByRole('button', { name: 'Remove Tidelight' }).click();
  await queue.getByRole('button', { name: 'Save playlist' }).click(); await queue.getByRole('button', { name: 'Lyrics', exact: true }).click(); await bar.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__musicState)).toEqual({ paused: false, track: 1, repeat: true, shuffle: true, muted: true, seek: 26, volume: 74, saves: 1, lyrics: 1 });
  await expect(queue.locator('.listItem')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__musicNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('cinema-music-player.png') });
});

test('music skin follows TV mode and teardown without leaking into video controls or changing hidden bar state', async ({ page }) => {
  await nativeMusicPlayer(page);
  await page.evaluate(() => {
    const video = document.createElement('div'); video.id = 'videoOsdPage'; video.innerHTML = '<button class="btnPlayPause" style="color:rgb(250, 100, 50);background:rgb(25, 30, 35)">Video pause</button>'; document.body.append(video);
    document.querySelector('.nowPlayingBar')!.classList.add('nowPlayingBar-hidden');
  });
  await expect(page.locator('#videoOsdPage button')).toHaveCSS('color', 'rgb(250, 100, 50)');
  await expect(page.locator('#videoOsdPage button')).toHaveCSS('background-color', 'rgb(25, 30, 35)');
  await expect(page.locator('.nowPlayingBar')).toHaveClass(/nowPlayingBar-hidden/);
  const transform = await page.locator('.nowPlayingBar').evaluate(element => getComputedStyle(element).transform);
  expect(transform).not.toBe('none');
  await page.evaluate(() => { document.documentElement.classList.remove('layout-tv'); document.body.classList.remove('layout-tv'); });
  await expect(page.locator('#nowPlayingPage')).not.toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await page.evaluate(() => { document.documentElement.classList.add('layout-tv'); });
  await expect(page.locator('#nowPlayingPage')).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await page.evaluate(() => window.TvItemLayout?.destroy());
  await expect(page.locator('#nowPlayingPage')).not.toHaveCSS('background-color', 'rgb(16, 17, 18)');
  expect(await page.evaluate(() => (window as any).__musicNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
});
