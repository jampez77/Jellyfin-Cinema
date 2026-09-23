import { expect, test, type Page } from '@playwright/test';

const baseRoute = '/#/tv?topParentId=library-tv&collectionType=tvshows';
const route = `${baseRoute}&tab=0`;
const shows = (page: Page) => page.getByRole('dialog', { name: 'TV Shows', exact: true });
const cards = (page: Page) => shows(page).locator('[data-show-item]');
const search = (page: Page) => shows(page).getByRole('searchbox', { name: 'Search shows', exact: true });

test('TV Shows opens Suggestions first by default', async ({ page }) => {
  await page.goto(baseRoute);
  const root = shows(page);
  await expect(root.locator('[data-library-tab]').first()).toHaveText('Suggestions');
  await expect(root.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByRole('region', { name: 'Continue watching', exact: true })).toBeVisible();
  await expect(root.getByRole('region', { name: 'Next up', exact: true })).toBeVisible();
});

async function patchDemo(page: Page, source: string) {
  await page.route('**/dist/demo.js', async request => {
    const response = await request.fetch();
    await request.fulfill({ response, body: `${await response.text()}\n(() => { const api = window.TvItemLayoutDemo.api; ${source} })();` });
  });
}

test('TV library browses shows with search, A-Z/# and library-scoped genres', async ({ page }) => {
  await patchDemo(page, `const get = api.getShows; api.getShows = query => { document.body.dataset.showQuery = JSON.stringify(query); return get(query); };`);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).first()).toBeFocused();
  await expect(page.locator('#tvRecommendedPage')).toHaveAttribute('aria-hidden', 'true');
  await shows(page).getByRole('button', { name: '# — numbers and symbols', exact: true }).click();
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-1999');
  await shows(page).getByRole('navigation', { name: 'Browse by title' }).getByRole('button', { name: 'N', exact: true }).click();
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-north');
  await search(page).fill('Signal');
  await search(page).press('Enter');
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-signal');
  expect(JSON.parse((await page.locator('body').getAttribute('data-show-query'))!)).toMatchObject({ parentId: 'library-tv', search: 'Signal', startIndex: 0 });
  await shows(page).getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
  await shows(page).getByRole('button', { name: 'Genres', exact: true }).click();
  await shows(page).getByRole('button', { name: 'Sci-Fi', exact: true }).click();
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-signal');
  await expect(cards(page)).toBeFocused();
  expect(JSON.parse((await page.locator('body').getAttribute('data-show-query'))!)).toMatchObject({ parentId: 'library-tv', genreId: 'genre-sci-fi' });
});

test('TV suggestions show episode identity and open the selected episode rather than next up', async ({ page }) => {
  await patchDemo(page, `api.serverId = 'active-server';`);
  await page.goto(`${baseRoute}&tab=1`);
  await expect(shows(page).getByRole('region', { name: 'Continue watching', exact: true }).locator('[data-show-item]')).toHaveCount(2);
  await expect(shows(page).getByRole('region', { name: 'Next up', exact: true }).locator('[data-show-item]')).toHaveCount(2);
  const episode = shows(page).getByRole('button', { name: 'North of Nowhere: S3 · E6 · Here, at Last', exact: true });
  await episode.click();
  await expect(page).toHaveURL(/#\/details\?id=episode-north-3-6&serverId=active-server$/);
  const details = page.getByRole('dialog', { name: 'North of Nowhere details', exact: true });
  await expect(details.locator('.tvl-episode-name')).toContainText('S3 · E6');
  await expect(details.locator('.tvl-episode-name')).toContainText('Here, at Last');
  await page.keyboard.press('Escape');
  await expect(episode).toBeFocused();
  await expect(shows(page).getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('show favourites refresh after detail edits and restore browse focus', async ({ page }) => {
  await page.goto(route);
  await shows(page).getByRole('button', { name: 'Favourites', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-harbour');
  await cards(page).click();
  const details = page.getByRole('dialog', { name: 'The Last Harbour details', exact: true });
  await details.getByRole('button', { name: 'Remove from favourites', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Add to favourites', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shows(page).getByRole('heading', { name: 'No favourites found', exact: true })).toBeVisible();
  await shows(page).getByRole('button', { name: 'All shows', exact: true }).click();
  await shows(page).getByRole('button', { name: 'North of Nowhere', exact: true }).click();
  await page.getByRole('button', { name: 'Add to favourites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shows(page).getByRole('button', { name: 'North of Nowhere', exact: true })).toBeFocused();
  await shows(page).getByRole('button', { name: 'Favourites', exact: true }).click();
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-north');
});

test('TV Collections is scoped to its library and Back retains search and entry focus', async ({ page }) => {
  await page.goto(`${route}&serverId=tv-server`);
  await search(page).fill('North');
  await search(page).press('Enter');
  await expect(cards(page)).toHaveCount(1);
  await shows(page).getByRole('button', { name: 'Collections', exact: true }).click();
  await expect(page).toHaveURL(/#\/list\?parentId=library-tv&type=BoxSet&serverId=tv-server$/);
  const collections = page.getByRole('dialog', { name: 'Collections', exact: true });
  await expect(collections.getByRole('list', { name: 'Collections' }).getByRole('button')).toHaveCount(1);
  await expect(collections.getByRole('button', { name: 'Into the Wilderness', exact: true })).toBeVisible();
  await collections.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search(page)).toHaveValue('North');
  await expect(cards(page)).toHaveAttribute('data-show-item', 'series-north');
  await expect(shows(page).getByRole('button', { name: 'Collections', exact: true })).toBeFocused();
});

test('show pagination restores loaded cards through its own API and never queries movie results', async ({ page }) => {
  await patchDemo(page, `
    api.getMovies = () => { document.body.dataset.wrongApi = 'true'; throw new Error('Wrong library'); };
    const original = api.getItem;
    const item = index => ({ Id:'catalog-show-' + index, Type:'Series', Name:'Show ' + index });
    api.getItem = id => id.startsWith('catalog-show-') ? Promise.resolve(item(Number(id.slice(13)))) : original(id);
    const starts = [];
    api.getShows = async query => {
      const start = query.startIndex || 0; starts.push(start); document.body.dataset.showStarts = JSON.stringify(starts);
      return { items:Array.from({length:start ? 2 : 47}, (_, index) => item(start + index)), total:50, nextStartIndex:start ? 50 : 48 };
    };
  `);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(47);
  await shows(page).getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(cards(page)).toHaveCount(49);
  await shows(page).getByRole('button', { name: 'Show 49', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Show 49 details', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cards(page)).toHaveCount(49);
  await expect(shows(page).getByRole('button', { name: 'Show 49', exact: true })).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-show-starts', '[0,48,0,48]');
  await expect(page.locator('body')).not.toHaveAttribute('data-wrong-api');
});

test('TV URL genres and native viewshow activate the library while unsupported native tabs remain available', async ({ page }) => {
  await page.clock.install();
  await page.goto(`${baseRoute}&tab=3`);
  await expect(shows(page).getByRole('heading', { name: 'Browse genres', exact: true })).toBeVisible();
  for (const suffix of ['&tab=2', '&tab=4', '&tab=5', '&genres=Drama']) {
    await page.goto(`${baseRoute}${suffix}`);
    await page.clock.runFor(100);
    await expect(page.locator('#tv-layout')).toHaveCount(0);
    await expect(page.locator('#tvRecommendedPage')).not.toHaveAttribute('aria-hidden', 'true');
  }
  await page.evaluate(() => {
    history.pushState(null, '', '#/tv?topParentId=library-tv&tab=0');
    document.querySelector('#tvRecommendedPage')!.dispatchEvent(new CustomEvent('viewshow', { detail: { params: { topParentId: 'library-tv' } } }));
  });
  await expect(cards(page)).toHaveCount(5);
  await page.evaluate(() => document.body.classList.replace('layout-tv', 'layout-desktop'));
  await expect(shows(page)).toHaveCount(0);
  await expect(page.locator('#tvRecommendedPage')).toHaveCSS('visibility', 'visible');
});

test('show requests can retry, show an empty search, and discard responses after leaving the library', async ({ page }) => {
  await patchDemo(page, `
    const original = api.getShows; let first = true;
    api.getShows = async query => {
      if (first) { first = false; throw new Error('offline'); }
      if (query.search === 'slow') { document.body.dataset.showPending='true'; await new Promise(resolve=>document.addEventListener('release-shows', resolve, {once:true})); }
      const result=await original(query); if (query.search === 'slow') document.dispatchEvent(new Event('shows-settled')); return result;
    };
  `);
  await page.goto(route);
  await expect(shows(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(5);
  await search(page).fill('missing title');
  await search(page).press('Enter');
  await expect(shows(page).getByRole('heading', { name: 'No shows found', exact: true })).toBeVisible();
  await search(page).fill('slow');
  await search(page).press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-show-pending', 'true');
  await page.getByRole('navigation', { name: 'Preview media type' }).getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Movies', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('shows-settled', () => resolve(), { once: true });
    document.dispatchEvent(new Event('release-shows'));
  }));
  await expect(shows(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Movies', exact: true }).getByRole('region', { name: 'Continue watching', exact: true })).toBeVisible();
});
