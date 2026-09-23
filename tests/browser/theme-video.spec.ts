import { expect, test, type Page } from '@playwright/test';

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
