import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Produce decoded frames locally so the visibility checks exercise a real
// playing <video>, without external media or a duplicate plugin-owned player.
async function addNativeTheme(page: Page, background = true) {
  await page.evaluate(async enabled => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3f8f75'; context.fillRect(0, 0, 160, 90);
    const container = document.createElement('div');
    container.className = 'videoPlayerContainer';
    container.style.cssText = 'position:fixed;inset:0;display:flex;background:black;';
    const video = document.createElement('video');
    video.className = 'htmlvideoplayer'; video.muted = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    video.srcObject = canvas.captureStream(1);
    container.append(video); document.body.prepend(container);
    if (enabled) document.documentElement.classList.add('transparentDocument');
    await video.play();
    // Count subsequent control calls: the layout must only expose this player.
    const play = video.play.bind(video), pause = video.pause.bind(video);
    video.play = () => { video.dataset.layoutPlayCalls = String(Number(video.dataset.layoutPlayCalls || 0) + 1); return play(); };
    video.pause = () => { video.dataset.layoutPauseCalls = String(Number(video.dataset.layoutPauseCalls || 0) + 1); pause(); };
  }, background);
}

test('a native movie theme is visible beneath the detail gradients without another player', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  const root = page.getByRole('dialog', { name: 'After the Tide details', exact: true });
  await expect(root).toBeVisible();
  await addNativeTheme(page);
  await expect(root).toHaveClass(/tvl-theme-video/);
  await expect(root).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(root.locator('.tvl-backdrop > img')).toHaveCSS('opacity', '0');
  await expect(page.locator('.videoPlayerContainer')).toHaveCSS('z-index', '9997');
  await expect(page.locator('video')).toHaveCount(1);
  expect(await root.locator('.tvl-backdrop').evaluate(node => getComputedStyle(node, '::after').backgroundImage)).toContain('linear-gradient');
  await expect(page.locator('video')).not.toHaveAttribute('data-layout-play-calls');
  await expect(page.locator('video')).not.toHaveAttribute('data-layout-pause-calls');
});

test('theme pause, playback failure and fullscreen handoff restore the static artwork', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  const root = page.locator('#tv-layout');
  await addNativeTheme(page);
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(root.locator('.tvl-backdrop > img')).toHaveCSS('opacity', '0.88');
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).play());
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.locator('.videoPlayerContainer').evaluate(node => node.classList.add('videoPlayerContainer-onTop'));
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(page.locator('.videoPlayerContainer')).not.toHaveClass(/tvl-theme-player/);
  await page.locator('.videoPlayerContainer').evaluate(node => node.classList.remove('videoPlayerContainer-onTop'));
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.locator('video').evaluate(video => {
    const element = video as HTMLVideoElement;
    (element.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    element.srcObject = null;
    element.load();
  });
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(root.locator('.tvl-backdrop > img')).toHaveCSS('opacity', '0.88');
});

test('series themes stay readable in episodes and release native layers when leaving details', async ({ page }) => {
  await page.goto('/#/details?id=series-north');
  const root = page.locator('#tv-layout');
  await addNativeTheme(page);
  await expect(root).toHaveClass(/tvl-theme-video/);
  await root.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect(root).toHaveAttribute('data-pane', 'episodes');
  await expect(root).toHaveCSS('background-color', 'rgba(16, 17, 18, 0.85)');
  await page.evaluate(() => { location.hash = '/livetv?collectionType=livetv'; });
  await expect(page.getByRole('dialog', { name: 'Live TV guide', exact: true })).toBeVisible();
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(page.locator('.videoPlayerContainer')).not.toHaveClass(/tvl-theme-player/);
  await expect(page.locator('video')).not.toHaveAttribute('data-layout-pause-calls');
});

test('ordinary video and unavailable native themes leave the backdrop intact', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  const root = page.locator('#tv-layout');
  await addNativeTheme(page, false);
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(root.locator('.tvl-backdrop > img')).toHaveCSS('opacity', '0.88');
  await page.evaluate(() => document.documentElement.classList.add('transparentDocument'));
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.locator('.videoPlayerContainer').evaluate(node => node.remove());
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(root.locator('.tvl-backdrop > img')).toHaveCSS('opacity', '0.88');
});

test('native playback navigation releases a reused theme container without controlling its video', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  const root = page.locator('#tv-layout');
  await addNativeTheme(page);
  await expect(root).toHaveClass(/tvl-theme-video/);
  await expect(page.locator('.itemDetailPage')).toHaveAttribute('aria-hidden', 'true');
  // Jellyfin can reuse the theme player for normal playback without adding the
  // temporary onTop class. Its native view lifecycle must still release it.
  const state = await page.evaluate(() => {
    const detail = document.querySelector<HTMLElement>('.itemDetailPage')!;
    const overlay = document.querySelector<HTMLElement>('#tv-layout')!;
    const player = document.querySelector<HTMLElement>('.videoPlayerContainer')!;
    const video = player.querySelector<HTMLVideoElement>('video')!;
    history.pushState(null, '', '#/video');
    detail.dispatchEvent(new Event('viewbeforehide', { bubbles: false }));
    return {
      overlayConnected: overlay.isConnected,
      overlayTheme: overlay.classList.contains('tvl-theme-video'),
      nativeTheme: player.classList.contains('tvl-theme-player'),
      onTop: player.classList.contains('videoPlayerContainer-onTop'),
      layoutOpen: document.body.classList.contains('tvl-open'),
      nativeAriaHidden: detail.getAttribute('aria-hidden'),
      videoPaused: video.paused,
      playCalls: video.dataset.layoutPlayCalls || '0',
      pauseCalls: video.dataset.layoutPauseCalls || '0'
    };
  });
  expect(state).toEqual({
    overlayConnected: false, overlayTheme: false, nativeTheme: false, onTop: false,
    layoutOpen: false, nativeAriaHidden: null, videoPaused: false,
    playCalls: '0', pauseCalls: '0'
  });
  await expect(page).toHaveURL(/#\/video$/);
  await expect(root).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.locator('.videoPlayerContainer')).toHaveCSS('z-index', 'auto');
});

test('theme transparency hides native movie controls while their playback bridge remains usable', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.itemDetailPage')!;
    // Place obvious native content above the theme player's stacking level. An
    // aria-hidden-only implementation still paints this through the overlay.
    host.style.cssText = 'position:fixed;inset:0;z-index:9997;background:transparent;';
    host.innerHTML = '<button class="btnUserRating" data-id="movie-tide">Rating</button><button class="btnPlay">Native Play</button><button class="btnPlayTrailer">Native Trailer</button><p class="native-description">Native Jellyfin description</p>';
    host.querySelector<HTMLElement>('.native-description')!.style.cssText = 'position:absolute;right:40px;top:160px;color:magenta;font-size:48px;visibility:visible;';
    host.querySelector('.btnPlay')!.addEventListener('click', () => { host.dataset.playCount = String(Number(host.dataset.playCount || 0) + 1); });
    host.querySelector('.btnPlayTrailer')!.addEventListener('click', () => { host.dataset.trailerCount = String(Number(host.dataset.trailerCount || 0) + 1); });
  });
  await addNativeTheme(page);
  const root = page.locator('#tv-layout');
  const host = page.locator('.itemDetailPage');
  await expect(root).toHaveClass(/tvl-theme-video/);
  await expect(host).toHaveClass(/tvl-native-hidden/);
  await expect(host.locator('.btnPlay')).toHaveCSS('visibility', 'hidden');
  await expect(host.locator('.native-description')).toHaveCSS('visibility', 'hidden');
  await expect(host.locator('.btnPlay')).toHaveCSS('pointer-events', 'none');
  expect(await host.locator('.btnPlay').evaluate(node => node.getClientRects().length)).toBeGreaterThan(0);
  const bridge = await transform(await readFile('src/local-playback.ts', 'utf8'), { loader: 'ts', format: 'iife', globalName: 'NativePlaybackTest', target: 'chrome79' });
  await page.addScriptTag({ content: bridge.code });
  await page.evaluate(async () => {
    const bridge = (window as unknown as { NativePlaybackTest: {
      dispatchPlayback: (...args: unknown[]) => Promise<void>;
      dispatchTrailerPlayback: (...args: unknown[]) => Promise<void>;
    } }).NativePlaybackTest;
    const client = { serverId: () => 'demo' };
    const item = { Id: 'movie-tide', Name: 'After the Tide', Type: 'Movie' };
    await bridge.dispatchPlayback(client, item, 0, () => true);
    await bridge.dispatchTrailerPlayback(client, 'viewer', item, () => true);
  });
  await expect(host).toHaveAttribute('data-play-count', '1');
  await expect(host).toHaveAttribute('data-trailer-count', '1');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause());
  await expect(root).not.toHaveClass(/tvl-theme-video/);
  await expect(host.locator('.native-description')).toHaveCSS('visibility', 'hidden');
  await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
  await expect(host).not.toHaveClass(/tvl-native-hidden/);
  await expect(host).not.toHaveAttribute('aria-hidden');
  await expect(host.locator('.btnPlay')).toHaveCSS('visibility', 'visible');
});

test('late and reused native detail hosts stay hidden and an older transition cannot close the overlay', async ({ page }) => {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\ndocument.querySelector('.itemDetailPage')?.remove();` });
  });
  await page.goto('/#/details?id=movie-tide');
  const root = page.locator('#tv-layout');
  await addNativeTheme(page);
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.evaluate(() => {
    const host = document.createElement('main');
    host.id = 'late-native'; host.className = 'itemDetailPage';
    host.setAttribute('aria-hidden', 'false');
    host.innerHTML = '<button class="btnPlay">Native Play</button><p>Native description</p>';
    document.body.append(host);
  });
  const late = page.locator('#late-native');
  await expect(late).toHaveClass(/tvl-native-hidden/);
  await expect(late).toHaveAttribute('aria-hidden', 'true');
  await expect(late.locator('.btnPlay')).toHaveCSS('visibility', 'hidden');
  await page.evaluate(() => {
    const host = document.querySelector('#late-native')!;
    host.className = 'itemDetailPage'; host.setAttribute('aria-hidden', 'false');
    host.innerHTML = '<button class="btnPlay">Reused native Play</button>';
    const next = document.createElement('main');
    next.id = 'next-native'; next.className = 'itemDetailPage';
    next.innerHTML = '<button class="btnPlay">New native Play</button>';
    document.body.append(next);
  });
  await expect(late).toHaveClass(/tvl-native-hidden/);
  await expect(late).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#next-native .btnPlay')).toHaveCSS('visibility', 'hidden');
  await late.evaluate(node => node.dispatchEvent(new Event('viewbeforehide')));
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.evaluate(() => {
    history.pushState(null, '', '#/video');
    document.querySelector('#next-native')!.dispatchEvent(new Event('viewbeforehide'));
  });
  await expect(root).toHaveCount(0);
  await expect(late).not.toHaveClass(/tvl-native-hidden/);
  await expect(late).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#next-native')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('.videoPlayerContainer')).not.toHaveClass(/tvl-theme-player/);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.locator('video')).not.toHaveAttribute('data-layout-pause-calls');
});

test('a theme player nested by a client remains visible while its native page chrome is masked', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  await addNativeTheme(page);
  await page.evaluate(() => document.querySelector('.itemDetailPage')!.append(document.querySelector('.videoPlayerContainer')!));
  await expect(page.locator('#tv-layout')).toHaveClass(/tvl-theme-video/);
  await expect(page.locator('.itemDetailPage')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.itemDetailPage .videoPlayerContainer')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.itemDetailPage video')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
});

test('an outgoing host after the incoming host in DOM order cannot replace the current overlay or its focus', async ({ page }) => {
  await page.goto('/#/details?id=movie-tide');
  await addNativeTheme(page);
  const root = page.locator('#tv-layout');
  await expect(root).toHaveClass(/tvl-theme-video/);
  await page.evaluate(() => {
    const outgoing = document.querySelector<HTMLElement>('.itemDetailPage')!;
    outgoing.id = 'outgoing-native';
    const incoming = document.createElement('main');
    incoming.id = 'incoming-native'; incoming.className = 'itemDetailPage';
    incoming.setAttribute('aria-hidden', 'false');
    incoming.innerHTML = '<button class="btnPlay">Incoming native Play</button>';
    // Native cached views can replace an earlier slot rather than append last.
    outgoing.before(incoming);
    document.querySelector<HTMLElement>('#tv-layout')!.dataset.originalOverlay = 'retained';
  });
  await expect(page.locator('#incoming-native')).toHaveClass(/tvl-native-hidden/);
  const play = root.locator('[data-focus-id="play"]');
  await play.focus();
  await page.locator('#outgoing-native').evaluate(node => node.dispatchEvent(new Event('viewbeforehide')));
  await expect(root).toHaveAttribute('data-original-overlay', 'retained');
  await expect(root).toHaveClass(/tvl-theme-video/);
  await expect(play).toBeFocused();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.evaluate(() => {
    history.pushState(null, '', '#/video');
    document.querySelector('#incoming-native')!.dispatchEvent(new Event('viewbeforehide'));
  });
  await expect(root).toHaveCount(0);
  await expect(page.locator('#incoming-native')).not.toHaveClass(/tvl-native-hidden/);
  await expect(page.locator('#incoming-native')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#outgoing-native')).not.toHaveClass(/tvl-native-hidden/);
  await expect(page.locator('#outgoing-native')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.locator('video')).not.toHaveAttribute('data-layout-pause-calls');
});
