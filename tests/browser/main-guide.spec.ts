import { expect, test, type Page } from '@playwright/test';

const guideRoute = '/#/livetv?collectionType=livetv';
const guide = (page: Page) => page.getByRole('dialog', { name: 'Live TV guide', exact: true });

async function patchDemo(page: Page, source: string) {
  await page.route('**/dist/demo.js', async request => {
    const response = await request.fetch();
    await request.fulfill({ response, body: `${await response.text()}\n(() => { const api = window.TvItemLayoutDemo.api; ${source} })();` });
  });
}

test('the main Live TV route loads channels directly and focuses the first current programme', async ({ page }) => {
  await patchDemo(page, `api.getItem = async () => { document.body.dataset.unexpectedItemRequest = 'true'; throw new Error('The main guide must not request an item.'); };`);
  await page.goto(guideRoute);
  const root = guide(page);
  await expect(root).toBeVisible();
  await expect(root.locator('button[data-channel]')).toHaveText(['101Field Notes', '102Horizon', '103Drift', '104Outside']);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expect(page.locator('body')).not.toHaveAttribute('data-unexpected-item-request');
  await expect(root.getByRole('button', { name: 'Jellyfin layout', exact: true })).toHaveCount(0);
  await expect(root.getByRole('region', { name: 'Selected programme' }).getByRole('img')).toHaveAttribute('alt', 'The Secret Life of Forests');
});

test('the main guide keeps upcoming selection separate from explicit live playback and returns from the player', async ({ page }) => {
  await page.goto(guideRoute);
  const root = guide(page);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(root.locator('[data-program="channel-field-program-2"]')).toBeFocused();
  await expect(root.getByRole('region', { name: 'Selected programme' })).toContainText('UPCOMING');
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/livetv\?collectionType=livetv$/);
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const player = page.getByRole('main', { name: 'Demo playback' });
  await expect(player.getByRole('heading')).toHaveText('Field Notes');
  await expect(root).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/livetv\?collectionType=livetv$/);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
});

test('an empty main guide keeps Back available without inventing a channel', async ({ page }) => {
  await page.goto('/?scenario=empty#/livetv?collectionType=livetv');
  const root = guide(page);
  await expect(root.getByRole('heading', { name: 'No channels available', exact: true })).toBeVisible();
  await expect(root.locator('button[data-channel]')).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
});

test('channel-list errors can be retried from the remote on the main guide', async ({ page }) => {
  await patchDemo(page, `const getChannels = api.getChannels; let first = true; api.getChannels = async () => { if (first) { first = false; throw new Error('Temporary failure'); } return getChannels(); };`);
  await page.goto(guideRoute);
  const root = guide(page);
  await expect(root.getByRole('heading', { name: 'Channels unavailable', exact: true })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expect(root.getByRole('heading', { name: 'Channels unavailable', exact: true })).toHaveCount(0);
});

test('the main guide respects TV display mode and reactivates on a view change', async ({ page }) => {
  await patchDemo(page, `document.body.classList.remove('layout-tv');`);
  await page.goto(guideRoute);
  await expect(guide(page)).toHaveCount(0);
  await page.evaluate(() => {
    document.body.classList.add('layout-tv');
    document.dispatchEvent(new Event('viewshow'));
  });
  await expect(guide(page).locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await page.evaluate(() => document.body.classList.remove('layout-tv'));
  await expect(guide(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/tvl-open/);
});

test('native view events activate a history-pushed guide and restore its host after navigation', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#/details?id=movie-tide');
  await expect(page.getByRole('dialog', { name: 'After the Tide details', exact: true })).toBeVisible();
  // Let the initial body-class observer settle before changing history silently.
  await page.clock.runFor(100);
  await page.evaluate(() => {
    const host = document.createElement('main');
    host.id = 'liveTvSuggestedPage';
    host.setAttribute('aria-hidden', 'false');
    document.body.append(host);
    history.pushState(null, '', '#/livetv?collectionType=livetv');
    host.dispatchEvent(new Event('viewshow'));
  });
  const root = guide(page);
  const nativeGuide = page.locator('#liveTvSuggestedPage');
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expect(nativeGuide).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => document.querySelector('.itemDetailPage')!.dispatchEvent(new Event('viewbeforehide')));
  await page.clock.runFor(100);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await page.evaluate(() => {
    history.pushState(null, '', '#/home');
    document.querySelector('#liveTvSuggestedPage')!.dispatchEvent(new Event('viewshow'));
  });
  await expect(root).toHaveCount(0);
  await expect(nativeGuide).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('body')).not.toHaveClass(/tvl-open/);
});

test('a channel guide link uses the main route, preserves the server, and restores its entry focus on Back', async ({ page }) => {
  const originalHash = '#/details?id=channel-outside&serverId=test-server%2Fone&from=search';
  await page.goto(`/${originalHash}`);
  const channel = page.getByRole('dialog', { name: 'Outside details', exact: true });
  const entry = channel.getByRole('button', { name: 'Channels & guide', exact: true });
  await entry.click();
  await expect(page).toHaveURL(/#\/livetv\?collectionType=livetv&serverId=test-server%2Fone$/);
  const root = guide(page);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expect(root.locator('button[data-channel]').first()).toHaveAttribute('data-channel', 'channel-field');
  await root.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(originalHash);
  await expect(entry).toBeFocused();
  await expect(root).toHaveCount(0);
});

test('playback failures keep their useful message and allow another launch', async ({ page }) => {
  await page.clock.install();
  await patchDemo(page, `const play = api.play; let first = true; api.play = async (...args) => { if (first) { first = false; throw new Error('No tuner is currently available.'); } return play(...args); };`);
  await page.goto(guideRoute);
  const root = guide(page);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  const watch = root.getByRole('button', { name: 'Watch live', exact: true });
  await watch.click();
  await expect(root.getByRole('status')).toHaveText('No tuner is currently available.');
  await expect(watch).not.toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(16_000);
  await expect(root.getByRole('status')).toHaveText('No tuner is currently available.');
  await watch.click();
  await expect(page.getByRole('main', { name: 'Demo playback' }).getByRole('heading')).toHaveText('Field Notes');
});

test('a stalled live launch times out and cannot start later after cancellation', async ({ page }) => {
  await page.clock.install();
  await patchDemo(page, `const play = api.play; api.play = async (...args) => { await new Promise(resolve => document.addEventListener('release-live-playback', resolve, { once: true })); await play(...args); document.dispatchEvent(new Event('live-playback-settled')); };`);
  await page.goto(guideRoute);
  const root = guide(page);
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  const watch = root.getByRole('button', { name: 'Watch live', exact: true });
  await watch.click();
  await expect(root.getByRole('status')).toHaveText('Tuning channel…');
  await page.clock.fastForward(16_000);
  await expect(root.getByRole('status')).toHaveText('Playback has not started. Please try again.');
  await expect(watch).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('live-playback-settled', () => resolve(), { once: true });
    document.dispatchEvent(new Event('release-live-playback'));
  }));
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/livetv\?collectionType=livetv$/);
});

test('leaving the main guide discards a pending channel response', async ({ page }) => {
  await patchDemo(page, `const getChannels = api.getChannels; api.getChannels = async () => { await new Promise(resolve => document.addEventListener('release-main-guide', resolve, { once: true })); const channels = await getChannels(); document.dispatchEvent(new Event('main-guide-settled')); return channels; };`);
  await page.goto(guideRoute);
  await expect(guide(page).getByText('Loading your channels and programme guide…', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Preview media type' }).getByRole('link', { name: 'Movies', exact: true }).click();
  const movie = page.getByRole('dialog', { name: 'Movies', exact: true });
  const firstMovie = movie.locator('[data-movie-item]').first();
  await expect(firstMovie).toBeFocused();
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('main-guide-settled', () => resolve(), { once: true });
    document.dispatchEvent(new Event('release-main-guide'));
  }));
  await expect(guide(page)).toHaveCount(0);
  await expect(firstMovie).toBeFocused();
});
