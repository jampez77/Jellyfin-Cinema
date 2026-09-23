import { expect, test, type Page } from '@playwright/test';

const records = [
  { Id: 'pause-movie', Name: 'Moon Glass', Type: 'Movie', Overview: 'A cartographer follows a vanished coastline.', Taglines: ['Every tide leaves a trace.'], ProductionYear: 2024, OfficialRating: '12', RunTimeTicks: 54_000_000_000, ImageTags: { Logo: 'logo', Disc: 'disc' } },
  { Id: 'pause-episode', Name: 'The Crossing', Type: 'Episode', SeriesId: 'pause-series', SeriesName: 'Long Way North', SeasonId: 'pause-season', ParentIndexNumber: 2, IndexNumber: 3, Overview: 'The team reaches the frozen strait.', ImageTags: { Logo: 'broken', Disc: 'broken' } },
  { Id: 'pause-season', Name: 'Season 2', Type: 'Season', Overview: 'Do not inherit the season plot.', ImageTags: { Logo: 'broken', Disc: 'broken' } },
  { Id: 'pause-series', Name: 'Long Way North', Type: 'Series', Overview: 'Do not inherit the series plot.', ImageTags: { Logo: 'logo', Disc: 'disc' } },
  { Id: 'pause-next', Name: 'The Other Shore', Type: 'Movie', Overview: 'The current movie has its own story.' },
  { Id: 'pause-channel', Name: 'Field Notes', Type: 'TvChannel', Number: '101', ImageTags: { Primary: 'channel' }, CurrentProgram: { Id: 'pause-program', Type: 'Program', Name: 'Hidden Forests', Overview: 'Discover life under the canopy.', StartDate: '2026-09-23T12:00:00Z', EndDate: '2026-09-23T13:00:00Z' } },
  { Id: 'pause-audio', Name: 'Only audio', Type: 'Audio' },
];

async function fixture(page: Page, extra = '') {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    const source = `(() => {
      const api = window.TvItemLayoutDemo.api, originalGet = api.getItem;
      const items = new Map(${JSON.stringify(records)}.map(item => [item.Id, item]));
      api.getItem = async id => items.get(id) || originalGet(id);
      const originalImage = api.image;
      api.image = (item, kind) => item.Id.startsWith('pause-')
        ? (item.ImageTags?.[kind === 'logo' ? 'Logo' : kind === 'disc' ? 'Disc' : 'Primary'] ? '/pause-assets/' + item.Id + '-' + kind + '.svg' : null)
        : originalImage(item, kind);
      api.getPlaybackContext = async () => null;
      ${extra}
    })();`;
    await route.fulfill({ response, body: `${await response.text()}\n${source}` });
  });
  await page.route('**/pause-assets/**', route => {
    if (/pause-(episode|season)-(logo|disc)/.test(route.request().url())) return route.fulfill({ status: 404, body: 'No image' });
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220"><rect width="420" height="220" rx="30" fill="#c7dbc9"/><circle cx="210" cy="110" r="65" fill="#20372b"/></svg>' });
  });
}

async function player(page: Page, itemId = 'pause-movie', audioOnly = false) {
  await page.evaluate(async ({ itemId, audioOnly }) => {
    document.querySelectorAll<HTMLVideoElement>('video.htmlvideoplayer').forEach(video => {
      (video.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop());
      video.closest('.videoPlayerContainer')?.remove();
    });
    document.querySelector('#videoOsdPage')?.remove();
    const container = document.createElement('div');
    container.className = 'videoPlayerContainer';
    container.style.cssText = 'position:fixed;inset:0;background:#101b17;';
    const video = document.createElement('video');
    video.className = 'htmlvideoplayer'; video.muted = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover';
    if (audioOnly) {
      const context = new AudioContext(), source = context.createOscillator(), destination = context.createMediaStreamDestination();
      source.connect(destination); source.start(); video.srcObject = destination.stream;
    } else {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d')!; context.fillStyle = '#355541'; context.fillRect(0, 0, 160, 90);
      video.srcObject = canvas.captureStream(2);
    }
    container.append(video); document.body.prepend(container);
    const osd = document.createElement('main');
    osd.id = 'videoOsdPage'; osd.dataset.type = 'video-osd';
    osd.style.cssText = 'position:fixed;inset:0;';
    osd.innerHTML = '<div class="videoOsdBottom" style="position:fixed;bottom:0;left:0;right:0;padding:30px;display:flex;gap:20px"><button class="btnPause">Resume playback</button><button class="btnUserRating" data-id="' + itemId + '">Favourite</button></div>';
    osd.querySelector('.btnPause')!.addEventListener('click', () => { void video.play(); });
    document.body.append(osd);
    osd.dispatchEvent(new Event('viewshow'));
    await video.play();
  }, { itemId, audioOnly });
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
}

async function pause(page: Page) { await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause()); }
const screen = (page: Page) => page.getByRole('region', { name: 'Paused media details', exact: true });

for (const desktop of [false, true]) test(`paused ${desktop ? 'desktop' : 'TV'} movies show metadata while native controls keep focus and resume playback`, async ({ page }) => {
  await fixture(page, desktop ? `document.body.classList.replace('layout-tv', 'layout-desktop');` : ''); await page.goto('/#/video'); await player(page);
  await expect(screen(page)).toBeHidden();
  await page.locator('.btnPause').focus();
  await pause(page);
  const overlay = screen(page);
  await expect(overlay).toBeVisible();
  await expect(overlay).not.toContainText('Paused');
  await expect(overlay.locator('.tvl-pause-mark, .tvl-pause-eyebrow')).toHaveCount(0);
  await expect(overlay).toContainText('A cartographer follows a vanished coastline.');
  await expect(overlay).toContainText('Every tide leaves a trace.');
  await expect(overlay).toContainText('2024');
  await expect(overlay).toContainText('12');
  await expect(overlay).toContainText('1h 30m');
  await expect(overlay.getByRole('img', { name: 'Moon Glass' })).toBeVisible();
  await expect(overlay.locator('.tvl-pause-disc')).toBeVisible();
  await expect(overlay).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.videoOsdBottom')).toHaveCSS('z-index', '1');
  await expect(page.locator('.btnPause')).toBeFocused();
  await page.locator('.btnPause').click();
  await expect(overlay).toBeHidden();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.locator('video')).toHaveCount(1);
});

test('episode artwork falls back through season and series without inheriting their synopsis', async ({ page }) => {
  await fixture(page); await page.goto('/#/video'); await player(page, 'pause-episode'); await pause(page);
  const overlay = screen(page);
  await expect(overlay).toBeVisible();
  await expect(overlay).not.toContainText('Paused');
  await expect(overlay).toContainText('The Crossing');
  await expect(overlay).toContainText('S2 · E3');
  await expect(overlay).toContainText('The team reaches the frozen strait.');
  await expect(overlay).not.toContainText('Do not inherit');
  await expect(overlay.locator('.tvl-pause-logo')).toHaveAttribute('src', /pause-series-logo/);
  await expect(overlay.locator('.tvl-pause-disc')).toHaveAttribute('src', /pause-series-disc/);
  await expect(overlay.locator('.tvl-pause-disc')).toBeVisible();
});

test('Live TV uses the current programme and channel logo', async ({ page }) => {
  await fixture(page); await page.goto('/#/video'); await player(page, 'pause-channel'); await pause(page);
  const overlay = screen(page);
  await expect(overlay).toBeVisible();
  await expect(overlay).not.toContainText('Paused');
  await expect(overlay.locator('.tvl-pause-channel')).toHaveText('Field Notes');
  await expect(overlay.locator('.tvl-pause-channel')).toHaveCSS('margin-left', '0px');
  await expect(overlay).toContainText('Field Notes');
  await expect(overlay).toContainText('Discover life under the canopy.');
  await expect(overlay.getByRole('heading', { name: 'Hidden Forests' })).toBeVisible();
  await expect(overlay.getByRole('img', { name: 'Field Notes' })).toHaveAttribute('src', /pause-channel-thumb/);
  await expect(overlay.locator('.tvl-pause-disc')).toHaveCount(0);
});

test('native dialogs and the episode browser suppress pause decoration without stealing focus', async ({ page }) => {
  await fixture(page); await page.goto('/#/video'); await player(page); await pause(page);
  await expect(screen(page)).toBeVisible();
  await page.evaluate(() => {
    const dialog = document.createElement('dialog'); dialog.id = 'native-test-dialog';
    dialog.innerHTML = '<input aria-label="Native dialog field">'; document.body.append(dialog); dialog.showModal();
    dialog.querySelector('input')!.focus();
  });
  await expect(screen(page)).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Native dialog field' })).toBeFocused();
  await page.evaluate(() => document.getElementById('native-test-dialog')!.remove());
  await expect(screen(page)).toBeVisible();
  await page.evaluate(() => document.body.setAttribute('data-tvl-player-browser-open', ''));
  await expect(screen(page)).toBeHidden();
  await page.evaluate(() => document.body.removeAttribute('data-tvl-player-browser-open'));
  await expect(screen(page)).toBeVisible();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
});

test('opening the actual player browser hides pause details and returning keeps native playback paused', async ({ page }) => {
  await fixture(page, 'api.getSimilar = async () => [];');
  await page.goto('/#/video'); await player(page); await page.locator('.btnPause').focus(); await pause(page);
  await expect(screen(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const browser = page.locator('#tvl-player-browser');
  await expect(browser).toBeVisible();
  await expect(browser.getByRole('button', { name: 'Return to playback', exact: true })).toBeFocused();
  await expect(screen(page)).toBeHidden();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.keyboard.press('Enter');
  await expect(browser).toHaveCount(0);
  await expect(screen(page)).toBeVisible();
  await expect(page.locator('.btnPause')).toBeFocused();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
});

test('switching accounts refreshes pause details even when the native item and video stay the same', async ({ page }) => {
  await fixture(page); await page.goto('/#/video'); await player(page); await pause(page);
  await expect(screen(page)).toContainText('A cartographer follows a vanished coastline.');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.userId = 'another-account';
    const getItem = api.getItem;
    api.getItem = async id => id === 'pause-movie'
      ? { Id: id, Type: 'Movie', Name: 'Moon Glass', Overview: 'The new account has updated item metadata.' }
      : getItem(id);
    document.querySelector('video')!.dispatchEvent(new Event('pause'));
  });
  await expect(screen(page)).toContainText('The new account has updated item metadata.');
  await expect(screen(page)).not.toContainText('A cartographer follows a vanished coastline.');
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
});

test('the standalone PauseScreen marker suppresses ours and destruction cleans up native OSD styling', async ({ page }) => {
  await fixture(page, `const upstream = document.createElement('div'); upstream.id = 'video-overlay'; upstream.style.display = 'none'; document.body.append(upstream);`);
  await page.goto('/#/video'); await player(page); await pause(page);
  await expect(screen(page)).toBeHidden();
  await page.evaluate(() => document.getElementById('video-overlay')!.remove());
  await expect(screen(page)).toBeVisible();
  await page.evaluate(() => window.TvItemLayout!.destroy());
  await expect(page.locator('#tvl-pause-screen')).toHaveCount(0);
  await expect(page.locator('#videoOsdPage')).not.toHaveClass(/tvl-pause-host/);
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
});

test('theme routes, unsupported layouts and audio-only playback never show a pause treatment', async ({ page }) => {
  await fixture(page); await page.goto('/#/details?id=movie-tide'); await player(page); await pause(page);
  await expect(screen(page)).toBeHidden();
  await page.goto('/#/video'); await player(page, 'pause-audio', true); await pause(page);
  await expect(page.locator('video')).toHaveJSProperty('videoWidth', 0);
  await expect(screen(page)).toBeHidden();
  await page.goto('/#/video'); await player(page);
  await page.evaluate(() => document.body.classList.remove('layout-tv')); await pause(page);
  await expect(screen(page)).toBeHidden();
});

test('late metadata cannot redraw an old item after a switch, resume or native player exit', async ({ page }) => {
  await fixture(page, `const get = api.getItem; api.getItem = id => id === 'pause-movie' ? new Promise(resolve => setTimeout(() => resolve(get(id)), 450)) : get(id);`);
  await page.goto('/#/video'); await player(page); await pause(page);
  await page.locator('.btnUserRating').evaluate(node => node.setAttribute('data-id', 'pause-next'));
  await expect(screen(page).getByRole('heading', { name: 'The Other Shore' })).toBeVisible();
  await page.waitForTimeout(550);
  await expect(screen(page)).not.toContainText('Moon Glass');
  await expect(screen(page)).toContainText('The current movie has its own story.');
  await page.locator('.btnPause').click();
  await expect(screen(page)).toBeHidden();
  await pause(page);
  await expect(screen(page)).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, '', '#/home');
    document.querySelector('#videoOsdPage')!.dispatchEvent(new Event('viewbeforehide'));
  });
  await expect(screen(page)).toBeHidden();
  await expect(page.locator('#videoOsdPage')).not.toHaveClass(/tvl-pause-host/);
});
