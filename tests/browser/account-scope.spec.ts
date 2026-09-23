import { expect, test, type Page } from '@playwright/test';

async function patchDemo(page: Page, source: string) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => { const api = window.TvItemLayoutDemo.api; api.userId = 'account-one'; api.serverId = 'server-one'; ${source} })();` });
  });
}

const movies = (page: Page) => page.getByRole('dialog', { name: 'Movies', exact: true });

test('same-route account refresh replaces metadata and clears the previous account search state', async ({ page }) => {
  await patchDemo(page, '');
  await page.goto('/#/movies?tab=0');
  const search = movies(page).getByRole('searchbox', { name: 'Search movies', exact: true });
  await search.fill('Tide'); await search.press('Enter');
  await expect(movies(page).locator('[data-movie-item]')).toHaveCount(1);
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.userId = 'account-two';
    api.getMovies = async query => {
      document.body.dataset.accountQuery = JSON.stringify(query);
      return { items: [{ Id: 'account-two-movie', Type: 'Movie', Name: 'Second account film' }], total: 1, nextStartIndex: 1 };
    };
    window.TvItemLayout!.refresh();
  });
  await expect(movies(page).getByRole('button', { name: 'Second account film', exact: true })).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(movies(page)).not.toContainText('After the Tide');
  const query = JSON.parse((await page.locator('body').getAttribute('data-account-query'))!);
  expect(query.startIndex).toBe(0);
  expect(query.search || '').toBe('');
});

test('server switches at a stable URL are detected without an active player or navigation event', async ({ page }) => {
  await patchDemo(page, '');
  await page.goto('/#/movies?tab=0');
  await expect(movies(page).locator('[data-movie-item]')).toHaveCount(5);
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.serverId = 'server-two';
    api.getMovies = async () => ({ items: [{ Id: 'server-two-movie', Type: 'Movie', Name: 'Second server film' }], total: 1, nextStartIndex: 1 });
  });
  await expect(movies(page).getByRole('button', { name: 'Second server film', exact: true })).toBeVisible();
  await expect(movies(page)).not.toContainText('After the Tide');
  await expect(page).toHaveURL(/#\/movies\?tab=0$/);
  await expect(page.locator('video')).toHaveCount(0);
});

test('same-route sign-out restores native pages and a later sign-in mounts a fresh view', async ({ page }) => {
  await patchDemo(page, 'window.__savedDemo = window.TvItemLayoutDemo;');
  await page.goto('/#/movies?tab=0');
  await expect(movies(page)).toBeVisible();
  await expect(page.locator('.demo-native-page')).toHaveClass(/tvl-native-hidden/);
  await page.evaluate(() => { delete window.TvItemLayoutDemo; });
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.demo-native-page')).not.toHaveClass(/tvl-native-hidden/);
  await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => {
    window.TvItemLayoutDemo = (window as any).__savedDemo;
    window.TvItemLayoutDemo!.api.userId = 'signed-back-in';
  });
  await expect(movies(page)).toBeVisible();
  await expect(movies(page).locator('[data-movie-item]')).toHaveCount(5);
});

test('a pending collection probe cannot mount or dismiss content for the next account', async ({ page }) => {
  await patchDemo(page, `
    api.getItem = id => { document.body.dataset.accountProbe = 'old'; return new Promise(resolve => window.__releaseOldProbe = () => resolve({ Id: id, Name: 'Old collections', CollectionType: 'boxsets' })); };
  `);
  await page.goto('/#/list?parentId=shared-library');
  await expect(page.locator('body')).toHaveAttribute('data-account-probe', 'old');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.userId = 'account-two';
    api.getItem = async id => { document.body.dataset.accountProbe = 'new'; return { Id: id, Name: 'Ordinary library', CollectionType: 'movies' }; };
    window.TvItemLayout!.refresh();
  });
  await expect(page.locator('body')).toHaveAttribute('data-account-probe', 'new');
  await page.evaluate(() => (window as any).__releaseOldProbe());
  await page.waitForTimeout(80);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  // A dismissal is account-specific too: this same URL may be a collections
  // library for the next account even when the prior account left it native.
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    api.userId = 'account-three';
    api.getItem = async id => ({ Id: id, Name: 'Collections', CollectionType: 'boxsets' });
    window.TvItemLayout!.refresh();
  });
  await expect(page.getByRole('dialog', { name: 'Collections', exact: true })).toBeVisible();
});

test('destroy cancels identity polling and makes an old refresh callback inert', async ({ page }) => {
  await patchDemo(page, '');
  await page.goto('/#/movies?tab=0');
  await expect(movies(page)).toBeVisible();
  await page.evaluate(() => {
    window.TvItemLayout!.destroy();
    window.TvItemLayoutDemo!.api.userId = 'another-account';
    window.TvItemLayout!.refresh();
  });
  await page.waitForTimeout(1200);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('.demo-native-page')).not.toHaveClass(/tvl-native-hidden/);
});
