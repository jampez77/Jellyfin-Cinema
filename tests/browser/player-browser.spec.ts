import { expect, test, type Page } from '@playwright/test';

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
      api.getPlaybackContext = async () => window.__browserContext || null;
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
    const controls = document.createElement('div'); controls.className = 'buttons';
    controls.style.cssText = 'position:absolute;bottom:20px;left:20px;pointer-events:auto';
    const button = document.createElement('button'); button.className = 'btnUserRating'; button.textContent = 'Native control';
    if (rating) button.dataset.id = id;
    controls.append(button); osd.append(controls); document.body.append(osd);
    await video.play(); button.focus(); osd.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
  }, { id, rating });
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
}
async function remote(page: Page, command: string) {
  return page.evaluate(command => document.activeElement!.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command } })), command);
}
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

test('Down browses the complete show continuously across seasons and wraps without interrupting playback', async ({ page }) => {
  await fixture(page); await player(page);
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

test('visible browse action returns to currently playing item and held Back never exits the native player', async ({ page }) => {
  await fixture(page); await player(page, 'browse-movie');
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
  await fixture(page, `window.__browserContext={PlayingItemId:'browse-movie',PlayingItemType:'Movie',Queue:[]};`);
  await player(page, 'browse-movie', false); await page.locator('#tvl-player-browse').click();
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie');
});

test('slow loading and pending playback are canceled when navigation leaves the native player', async ({ page }) => {
  await fixture(page, `api.getSimilar=async()=>{ await new Promise(resolve=>window.__releaseBrowser=resolve); return [items.get('browse-next')]; };`);
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

test('native dialogs retain input and a standalone preview integration never gets duplicate controls', async ({ page }) => {
  await fixture(page); await player(page, 'browse-movie');
  await page.evaluate(() => {
    const dialog = document.createElement('section'); dialog.id = 'native-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = 'position:fixed;inset:10%;z-index:2000;background:black';
    const input = document.createElement('input'); dialog.append(input); document.body.append(dialog); input.focus();
  });
  expect(await remote(page, 'down')).toBe(true); await expect(browser(page)).toHaveCount(0);
  await page.evaluate(() => { document.querySelector('#native-dialog')!.remove(); const button = document.createElement('button'); button.id = 'popupPreviewButton'; document.querySelector('.buttons')!.append(button); });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  expect(await remote(page, 'down')).toBe(true); await expect(browser(page)).toHaveCount(0);
  await page.locator('#popupPreviewButton').evaluate(element => element.remove());
  await expect(page.locator('#tvl-player-browse')).toBeVisible();
  await page.route('**/InPlayerPreview/ClientScript', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.evaluate(() => { const script = document.createElement('script'); script.src = '/InPlayerPreview/ClientScript'; document.body.append(script); });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  expect(await remote(page, 'down')).toBe(true);
});

test('watched films restart from zero and descriptions render as plain text', async ({ page }) => {
  await fixture(page, `items.get('browse-next').UserData.Played=true;items.get('browse-next').Overview='<p>A <strong>new</strong> mystery.</p>';`);
  await player(page, 'browse-movie'); await remote(page, 'down');
  await expect(browser(page)).toHaveAttribute('data-item-id', 'browse-movie'); await remote(page, 'right');
  await expect(browser(page).locator('.tvl-player-description')).toHaveText('A new mystery.');
  await expect(browser(page).getByRole('button', { name: 'Play', exact: true })).toBeFocused();
  await remote(page, 'select');
  expect(await page.evaluate(() => (window as any).__browserPlays)).toEqual([{ id: 'browse-next', ticks: 0 }]);
  await remote(page, 'back');
});

test('TV gate, hidden OSD, theme videos, audio-only media and sign-out suppress in-player browsing', async ({ page }) => {
  await fixture(page); await player(page, 'browse-movie');
  await page.evaluate(() => { document.documentElement.classList.remove('layout-tv'); document.body.classList.remove('layout-tv'); });
  await expect(page.locator('#tvl-player-browse')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.classList.add('layout-tv'); document.body.classList.add('layout-tv'); });
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
  await fixture(page, `api.serverId='server-a';api.userId='user-a';const originalBrowserGet=api.getItem;api.getItem=async id=>{if(id==='browse-movie'&&api.userId==='user-a'){const old={...items.get(id),Name:'Previous account movie'};await new Promise(resolve=>{(window.__oldUserResolves||=[]).push(resolve);});return old;}return originalBrowserGet(id);};`);
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
