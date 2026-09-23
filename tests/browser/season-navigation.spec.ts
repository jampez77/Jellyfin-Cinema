import { expect, test, type Page } from '@playwright/test';

const root = (page: Page) => page.locator('#tv-layout');
const episodes = (page: Page) => root(page).locator('button[data-episode]');
const season = (page: Page, number: number) => root(page).getByRole('navigation', { name: 'Seasons' }).getByRole('button', { name: new RegExp(`^Season ${number}`) });

async function openEpisodes(page: Page) {
  await page.goto('/#/details?id=series-north');
  await root(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect(episodes(page)).toHaveCount(6);
}

async function modifyEpisodeApi(page: Page, body: string) {
  await page.route('**/dist/demo.js', async request => {
    const response = await request.fetch();
    const script = await response.text();
    await request.fulfill({ response, body: `${script}\n(() => { const api = window.TvItemLayoutDemo.api; const original = api.getEpisodes; ${body} })();` });
  });
}

test('episode arrows cross season boundaries and focus the adjoining episode', async ({ page }) => {
  await openEpisodes(page);
  await episodes(page).last().focus();
  await page.keyboard.press('ArrowDown');
  await expect(season(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(episodes(page).first()).toHaveAccessibleName('S2 · E1 First Light');
  await expect(episodes(page).first()).toBeFocused();
  await expect(episodes(page).first()).toBeInViewport();

  await page.keyboard.press('ArrowUp');
  await expect(season(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(episodes(page).last()).toHaveAttribute('data-episode', 'episode-north-1-6');
  await expect(episodes(page).last()).toBeFocused();
  await expect(episodes(page).last()).toBeInViewport();
});

test('the first and final seasons do not wrap at the series boundaries', async ({ page }) => {
  await openEpisodes(page);
  await episodes(page).first().focus();
  await page.keyboard.press('ArrowUp');
  await expect(episodes(page).first()).toBeFocused();
  await expect(season(page, 1)).toHaveAttribute('aria-pressed', 'true');

  await season(page, 3).click();
  await expect(episodes(page).last()).toHaveAttribute('data-episode', 'episode-north-3-6');
  await episodes(page).last().focus();
  await page.keyboard.press('ArrowDown');
  await expect(episodes(page).last()).toBeFocused();
  await expect(season(page, 3)).toHaveAttribute('aria-pressed', 'true');
});

test('loading an adjoining season does not take focus back after another remote move', async ({ page }) => {
  await modifyEpisodeApi(page, `api.getEpisodes = (...args) => args[1] === 'season-north-2'
    ? new Promise(resolve => setTimeout(() => resolve(original(...args)), 700)) : original(...args);`);
  await openEpisodes(page);
  await episodes(page).last().focus();
  await page.keyboard.press('ArrowDown');
  await expect(season(page, 2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(season(page, 3)).toBeFocused();
  await expect(episodes(page).first()).toHaveAccessibleName('S2 · E1 First Light');
  await expect(season(page, 3)).toBeFocused();
});

test('an empty adjoining season leaves focus on its season control', async ({ page }) => {
  await modifyEpisodeApi(page, `api.getEpisodes = (...args) => args[1] === 'season-north-2' ? Promise.resolve([]) : original(...args);`);
  await openEpisodes(page);
  await episodes(page).last().focus();
  await page.keyboard.press('ArrowDown');
  await expect(root(page).getByRole('heading', { name: 'No episodes available', exact: true })).toBeVisible();
  await expect(season(page, 2)).toBeFocused();
  await expect(season(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(episodes(page).first()).toHaveAttribute('data-episode', 'episode-north-3-1');
});

test('a failed adjoining season can retry and restore the intended episode focus', async ({ page }) => {
  await modifyEpisodeApi(page, `let failed = false; api.getEpisodes = (...args) => {
    if (args[1] === 'season-north-2' && !failed) { failed = true; return Promise.reject(new Error('Temporary failure')); }
    return original(...args);
  };`);
  await openEpisodes(page);
  await episodes(page).last().focus();
  await page.keyboard.press('ArrowDown');
  await expect(root(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(episodes(page).first()).toHaveAccessibleName('S2 · E1 First Light');
  await expect(episodes(page).first()).toBeFocused();
});
