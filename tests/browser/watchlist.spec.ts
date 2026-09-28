import { expect, test, type Page } from '@playwright/test';

const toggle = (page: Page) => page.locator('#tv-layout [data-watchlist]');
const storageKey = 'screenharbour-demo:demo:trailer-watchlist';
async function seed(page: Page, ids: string[]) {
  await page.addInitScript(({ key, ids }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(ids)); }, { key: storageKey, ids });
}
async function patchDemo(page: Page, source: string) {
  await page.route('**/dist/demo.js', async request => { const response = await request.fetch(); await request.fulfill({ response, body: `${await response.text()}\n(() => { const api = window.TvItemLayoutDemo.api; ${source} })();` }); });
}
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey);

for (const layout of ['desktop', 'tv']) for (const [id, title] of [['movie-tide', 'After the Tide'], ['series-north', 'North of Nowhere']]) {
  test(`${layout}: ${title} can be saved and removed with remote focus and persistence`, async ({ page }) => {
    await page.goto(`/?featured=0&layout=${layout}#/details?id=${id}`);
    await expect(toggle(page)).toHaveAccessibleName('Add to watchlist');
    const favourite = page.locator('#tv-layout [data-favorite]'); const favouriteBefore = await favourite.getAttribute('aria-pressed');
    await toggle(page).focus(); await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAccessibleName('Remove from watchlist'); await expect(toggle(page)).toBeFocused();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true'); expect(await stored(page)).toContain(id);
    await expect(favourite).toHaveAttribute('aria-pressed', favouriteBefore!);
    await page.reload(); await expect(toggle(page)).toHaveAccessibleName('Remove from watchlist');
    await toggle(page).click(); await expect(toggle(page)).toHaveAccessibleName('Add to watchlist');
    await expect(toggle(page)).toBeFocused(); expect(await stored(page)).not.toContain(id);
    await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  });
}

for (const [route, title, noun, letter, id, itemTitle, search] of [
  ['movies?topParentId=library-movies', 'Movies', 'movies', 'K', 'movie-blue', 'A Kind of Blue', 'Blue'],
  ['tv?topParentId=library-tv', 'TV Shows', 'shows', 'N', 'series-north', 'North of Nowhere', 'North']
]) test(`${title}: Watchlist filters search and letters, keeps selection after Back and refreshes removals`, async ({ page }) => {
  await seed(page, ['movie-tide', 'movie-blue', 'series-north']);
  await page.goto(`/?featured=0#/${route}`);
  const library = page.getByRole('dialog', { name: title, exact: true });
  await library.getByRole('button', { name: 'Watchlist', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Watchlist', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.locator('[data-library-item]')).toHaveCount(noun === 'movies' ? 2 : 1);
  if (noun === 'movies') await page.screenshot({ path: `${process.cwd()}/dist/release-preview/watchlist-library.png`, animations: 'disabled' });
  const input = library.getByRole('searchbox', { name: `Search ${noun}`, exact: true });
  await input.fill(search); await input.press('Enter');
  await expect(input).toBeFocused(); await expect(library.locator('[data-library-item]')).toHaveAttribute('data-library-item', id);
  await library.getByRole('button', { name: 'Clear search', exact: true }).click();
  await library.getByRole('navigation', { name: 'Browse by title' }).getByRole('button', { name: letter, exact: true }).click();
  await expect(library.locator('[data-library-item]')).toHaveAttribute('data-library-item', id);
  await library.getByRole('button', { name: itemTitle, exact: true }).click();
  await expect(toggle(page)).toHaveAccessibleName('Remove from watchlist');
  await page.keyboard.press('Escape');
  await expect(library.getByRole('button', { name: itemTitle, exact: true })).toBeFocused();
  await expect(library.getByRole('button', { name: 'Watchlist', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.getByRole('button', { name: letter, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await library.getByRole('button', { name: itemTitle, exact: true }).click(); await toggle(page).click();
  await expect(toggle(page)).toHaveAccessibleName('Add to watchlist'); await page.keyboard.press('Escape');
  await expect(library).toContainText('No saved titles found');
  await page.goto(`/?featured=0#/${route}&tab=watchlist`);
  await expect(library.getByRole('button', { name: 'Watchlist', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.locator('[data-library-item]')).toHaveCount(noun === 'movies' ? 1 : 0);
});

test('failed writes never claim a save, retry preserves focus, and pending remote presses issue one mutation', async ({ page }) => {
  await page.goto('/?featured=0#/details?id=movie-tide'); await expect(toggle(page)).toHaveAccessibleName('Add to watchlist');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api, original = api.setWatchlist!;
    const state = (window as any).__saveWatchlist = { calls: 0, fail: true, release: undefined as (() => void) | undefined };
    api.setWatchlist = async (id, value) => { state.calls++; if (state.fail) throw new Error('The server is offline.'); await new Promise<void>(resolve => { state.release = resolve; }); return original(id, value); };
  });
  await toggle(page).click(); await expect(toggle(page)).toHaveAccessibleName('Retry watchlist');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false'); await expect(toggle(page)).toBeFocused();
  expect(await stored(page)).not.toContain('movie-tide'); await expect(page.locator('#tv-layout')).toContainText('The server is offline.');
  await toggle(page).click(); await expect(toggle(page)).toHaveAccessibleName('Add to watchlist');
  await expect(toggle(page)).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => { (window as any).__saveWatchlist.fail = false; });
  await page.keyboard.press('Enter'); await expect(toggle(page)).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Enter'); expect(await page.evaluate(() => (window as any).__saveWatchlist.calls)).toBe(2);
  await page.evaluate(() => (window as any).__saveWatchlist.release());
  await expect(toggle(page)).toHaveAccessibleName('Remove from watchlist'); await expect(toggle(page)).toBeFocused();
});

test('failed membership reads offer retry and never dispatch a write until status is known', async ({ page }) => {
  await patchDemo(page, `const read = api.getWatchlistState, write = api.setWatchlist; let first = true; window.__watchlistWrites = 0;
    api.getWatchlistState = async id => { if (first) { first = false; throw new Error('Membership offline'); } return read(id); };
    api.setWatchlist = (...args) => { window.__watchlistWrites++; return write(...args); };`);
  await page.goto('/?featured=0#/details?id=series-north'); await expect(toggle(page)).toHaveAccessibleName('Retry watchlist');
  await toggle(page).click(); await expect(toggle(page)).toHaveAccessibleName('Add to watchlist'); await expect(toggle(page)).toBeFocused();
  expect(await page.evaluate(() => (window as any).__watchlistWrites)).toBe(0);
  await toggle(page).click(); await expect(toggle(page)).toHaveAccessibleName('Remove from watchlist');
  expect(await page.evaluate(() => (window as any).__watchlistWrites)).toBe(1);
});

test('a watchlist change during a pending membership read is reconciled before the button settles', async ({ page }) => {
  await patchDemo(page, `const read = api.getWatchlistState; let first = true;
    api.getWatchlistState = async id => { const value = await read(id); if (first) { first = false; await new Promise(resolve => window.__finishWatchlistRead = resolve); } return value; };`);
  await page.goto('/?featured=0#/details?id=movie-tide');
  await expect(toggle(page)).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishWatchlistRead)).toBe('function');
  await page.evaluate(async () => { await window.TvItemLayoutDemo!.api.setWatchlist!('movie-tide', true); (window as any).__finishWatchlistRead(); });
  await expect(toggle(page)).toHaveAccessibleName('Remove from watchlist'); await expect(toggle(page)).toHaveAttribute('aria-busy', 'false');
});
