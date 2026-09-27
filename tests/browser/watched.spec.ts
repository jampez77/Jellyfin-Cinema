import { expect, test, type Page } from '@playwright/test';

const detail = (page: Page) => page.locator('#tv-layout');
const watched = (page: Page, id: string) => detail(page).locator(`button[data-watched-id="${id}"]`);
const episode = (page: Page, id: string) => detail(page).locator(`button[data-episode="${id}"]`);

async function open(page: Page, id = 'movie-tide', layout = 'desktop', query = '') {
  await page.goto(`/?featured=0&layout=${layout}${query}#/details?id=${id}`);
  await expect(detail(page).locator('[data-focus-id="play"]')).toBeVisible();
}

async function holdWatched(page: Page) {
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.setPlayed!;
    const state = { calls: [] as { id: string; played: boolean }[], release: undefined as (() => void) | undefined, settled: 0 };
    (window as typeof window & { __watchedTest: typeof state }).__watchedTest = state;
    api.setPlayed = async (id, played) => {
      state.calls.push({ id, played });
      await new Promise<void>(resolve => { state.release = resolve; });
      try { return await original(id, played); }
      finally { state.settled++; }
    };
  });
}

async function calls(page: Page) {
  return page.evaluate(() => (window as typeof window & { __watchedTest: { calls: { id: string; played: boolean }[] } }).__watchedTest.calls);
}

async function releaseWatched(page: Page) {
  await page.evaluate(() => (window as typeof window & { __watchedTest: { release?: () => void } }).__watchedTest.release?.());
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __watchedTest: { settled: number } }).__watchedTest.settled)).toBe(1);
}

for (const layout of ['desktop', 'tv']) test(`${layout} movie watched toggle saves, clears resume, and survives reopening`, async ({ page }) => {
  await open(page, 'movie-tide', layout);
  const toggle = watched(page, 'movie-tide');
  await expect(toggle).toHaveAccessibleName('Mark watched');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAccessibleName('Mark unwatched');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
  await expect(detail(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);

  await page.evaluate(() => { location.hash = '/details?id=movie-blue'; });
  await expect(detail(page).getByRole('heading', { name: 'A Kind of Blue', exact: true, level: 1 })).toBeVisible();
  await page.goBack();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Mark watched');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
  await detail(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toContainText('Playback would start from the beginning.');
});

test('episode overview changes only the requested episode, even though it displays series metadata', async ({ page }) => {
  await open(page, 'episode-north-1-2', 'tv');
  await holdWatched(page);
  const toggle = watched(page, 'episode-north-1-2');
  await expect(toggle).toHaveAccessibleName('Mark episode watched');
  await expect(watched(page, 'series-north')).toHaveCount(0);
  await toggle.click();
  expect(await calls(page)).toEqual([{ id: 'episode-north-1-2', played: true }]);
  await releaseWatched(page);
  await expect(toggle).toHaveAccessibleName('Mark episode unwatched');
  await expect(detail(page).getByRole('button', { name: 'Play S1 · E2', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('button', { name: 'Play from beginning', exact: true })).toHaveCount(0);
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect(episode(page, 'episode-north-1-2')).toContainText('Watched');
  await expect(episode(page, 'episode-north-1-3')).not.toContainText('Watched');
  const untouched = await page.evaluate(async () => {
    const api = window.TvItemLayoutDemo!.api;
    return { series: (await api.getItem('series-north')).UserData?.Played, next: (await api.getItem('episode-north-1-3')).UserData?.Played };
  });
  expect(untouched.series).not.toBe(true); expect(untouched.next).not.toBe(true);
});

test('episode row check is separately accessible, keeps focus, and survives changing seasons without playing', async ({ page }) => {
  await open(page, 'series-north', 'tv');
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  const toggle = watched(page, 'episode-north-1-2');
  await expect(toggle).toHaveAccessibleName('Mark S1 · E2 A Line in the Snow watched');
  await expect(episode(page, 'episode-north-1-2').locator('button')).toHaveCount(0);
  await episode(page, 'episode-north-1-2').focus();
  await page.keyboard.press('ArrowRight'); await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAccessibleName('Mark S1 · E2 A Line in the Snow unwatched');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await expect(episode(page, 'episode-north-1-2')).toContainText('Watched');
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/details\?id=series-north$/);
  const seasons = detail(page).getByRole('navigation', { name: 'Seasons', exact: true });
  await seasons.getByRole('button', { name: /^Season 2/ }).click();
  await expect(episode(page, 'episode-north-2-1')).toBeVisible();
  await seasons.getByRole('button', { name: /^Season 1/ }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(episode(page, 'episode-north-1-2')).not.toContainText('Watched');
});

test('series and season watched controls apply to their children with explicit scope', async ({ page }) => {
  await open(page, 'series-north');
  const series = watched(page, 'series-north');
  await expect(series).toHaveAccessibleName('Mark series watched');
  await series.click();
  await expect(series).toHaveAccessibleName('Mark series unwatched');
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  const season = detail(page).getByRole('button', { name: 'Mark season unwatched', exact: true });
  await expect(season).toBeVisible();
  await expect(detail(page).locator('[data-episode] .tvl-watched')).toHaveCount(6);
  await season.click();
  await expect(detail(page).getByRole('button', { name: 'Mark season watched', exact: true })).toBeFocused();
  await expect(detail(page).locator('[data-episode] .tvl-watched')).toHaveCount(0);
  await detail(page).getByRole('navigation', { name: 'Seasons', exact: true }).getByRole('button', { name: /^Season 2/ }).click();
  await expect(detail(page).getByRole('button', { name: 'Mark season unwatched', exact: true })).toBeVisible();
  await expect(detail(page).locator('[data-episode] .tvl-watched')).toHaveCount(6);
  await detail(page).getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(series).toHaveAccessibleName('Mark series watched');
  await expect(detail(page).getByRole('button', { name: /^Resume/ })).toHaveCount(0);
});

test('episode checks support remote season boundaries and reach the season-wide control', async ({ page }) => {
  await open(page, 'series-north', 'tv');
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await watched(page, 'episode-north-1-1').focus();
  await page.keyboard.press('ArrowUp');
  await expect(detail(page).getByRole('button', { name: 'Mark season watched', exact: true })).toBeFocused();
  await watched(page, 'episode-north-1-6').focus();
  await page.keyboard.press('ArrowDown');
  await expect(watched(page, 'episode-north-2-1')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(watched(page, 'episode-north-1-6')).toBeFocused();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
});

test('marking a season during episode loading discards stale children and keeps the season toggle focused', async ({ page }) => {
  await open(page, 'series-north', 'tv');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.getEpisodes;
    const state = { captured: false, release: undefined as (() => void) | undefined };
    (window as typeof window & { __watchedEpisodes: typeof state }).__watchedEpisodes = state;
    let holdFirst = true;
    api.getEpisodes = async (...args) => {
      const items = await original(...args);
      if (holdFirst) {
        holdFirst = false; state.captured = true;
        await new Promise<void>(resolve => { state.release = resolve; });
      }
      return items;
    };
  });
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __watchedEpisodes: { captured: boolean } }).__watchedEpisodes.captured)).toBe(true);
  await expect(detail(page).locator('[data-episode]')).toHaveCount(0);
  const season = detail(page).getByRole('button', { name: 'Mark season watched', exact: true });
  await season.click();
  const confirmed = detail(page).getByRole('button', { name: 'Mark season unwatched', exact: true });
  await expect(confirmed).toHaveAttribute('aria-busy', 'false');
  await expect(detail(page).getByRole('status')).toContainText('marked watched');
  await expect(confirmed).toBeFocused();
  await page.evaluate(() => (window as typeof window & { __watchedEpisodes: { release?: () => void } }).__watchedEpisodes.release?.());
  await expect(detail(page).locator('[data-episode] .tvl-watched')).toHaveCount(6);
  await expect(detail(page).locator('[data-episode] .tvl-continue')).toHaveCount(0);
  await expect(confirmed).toBeFocused();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
});

test('returning to a loading season shares its request and subsequent watched toggles use the current item', async ({ page }) => {
  await open(page, 'series-north', 'tv');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const getEpisodes = api.getEpisodes, setPlayed = api.setPlayed!;
    const state = { episodes: [] as string[], changes: [] as boolean[], captured: false, release: undefined as (() => void) | undefined };
    (window as typeof window & { __watchedSeasonSwitch: typeof state }).__watchedSeasonSwitch = state;
    api.getEpisodes = async (...args) => {
      state.episodes.push(args[1]);
      const items = await getEpisodes(...args);
      if (args[1] === 'season-north-1' && !state.captured) {
        state.captured = true;
        await new Promise<void>(resolve => { state.release = resolve; });
      }
      return items;
    };
    api.setPlayed = async (id, played) => {
      state.changes.push(played);
      return setPlayed(id, played);
    };
  });
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __watchedSeasonSwitch: { captured: boolean } }).__watchedSeasonSwitch.captured)).toBe(true);
  const seasons = detail(page).getByRole('navigation', { name: 'Seasons', exact: true });
  await seasons.getByRole('button', { name: /^Season 2/ }).click();
  await expect(episode(page, 'episode-north-2-1')).toBeVisible();
  await seasons.getByRole('button', { name: /^Season 1/ }).click();
  expect(await page.evaluate(() => (window as typeof window & { __watchedSeasonSwitch: { episodes: string[] } }).__watchedSeasonSwitch.episodes)).toEqual(['season-north-1', 'season-north-2']);
  await page.evaluate(() => (window as typeof window & { __watchedSeasonSwitch: { release?: () => void } }).__watchedSeasonSwitch.release?.());
  const toggle = watched(page, 'episode-north-1-2');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('aria-busy', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => (window as typeof window & { __watchedSeasonSwitch: { changes: boolean[] } }).__watchedSeasonSwitch.changes)).toEqual([true, false]);
  await episode(page, 'episode-north-1-2').click();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toContainText('Playback would start from the beginning.');
});

test('a rejected watched change keeps the previous state and allows retry', async ({ page }) => {
  await open(page, 'movie-tide', 'desktop', '&watchedError=once');
  const toggle = watched(page, 'movie-tide');
  await toggle.click();
  await expect(detail(page).getByRole('status')).toContainText(/could not|unable|failed/i);
  await expect(toggle).toHaveAccessibleName('Mark watched');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeEnabled(); await expect(toggle).toBeFocused();
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Mark unwatched');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('pending watched changes stay unconfirmed and cannot submit twice', async ({ page }) => {
  await open(page); await holdWatched(page);
  const toggle = watched(page, 'movie-tide');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-disabled', 'true');
  await expect(toggle).toHaveAttribute('aria-busy', 'true');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(detail(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  // Even a second programmatic/native select cannot create a parallel write.
  await toggle.dispatchEvent('click'); await page.keyboard.press('Enter');
  expect(await calls(page)).toEqual([{ id: 'movie-tide', played: true }]);
  await releaseWatched(page);
  await expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
  await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('a watched request completing after leaving details cannot overwrite the new title or focus', async ({ page }) => {
  await open(page); await holdWatched(page);
  await watched(page, 'movie-tide').click();
  await page.evaluate(() => { location.hash = '/details?id=movie-blue'; });
  await expect(detail(page).getByRole('heading', { name: 'A Kind of Blue', exact: true, level: 1 })).toBeVisible();
  const play = detail(page).getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeFocused();
  await releaseWatched(page);
  await expect(play).toBeFocused();
  await expect(watched(page, 'movie-blue')).toHaveAttribute('aria-pressed', 'false');
  await expect(watched(page, 'movie-tide')).toHaveCount(0);
  await expect(detail(page).getByRole('status', { includeHidden: true })).toBeEmpty();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
});

test('live channels do not offer a watched toggle', async ({ page }) => {
  await open(page, 'channel-field');
  await expect(detail(page).getByRole('button', { name: 'Watch live', exact: true })).toBeVisible();
  await expect(detail(page).locator('[data-watched-id]')).toHaveCount(0);
});
