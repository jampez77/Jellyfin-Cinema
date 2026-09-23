import { expect, test, type Page } from '@playwright/test';

const detail = (page: Page) => page.locator('#tv-layout');
const route = (id: string, scenario = '') => `/${scenario ? `?scenario=${scenario}` : ''}#/details?id=${id}`;
async function open(page: Page, id = 'series-north', scenario = '') {
  await page.goto(route(id, scenario));
  await expect(detail(page)).toBeVisible();
}

test('TV overview opens episodes, marks progress, and switches seasons', async ({ page }) => {
  await open(page);
  const root = detail(page);
  await expect(root.getByRole('heading', { name: 'North of Nowhere', exact: true })).toBeVisible();
  await expect(root.getByText('3 seasons', { exact: true })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Resume S1 · E2', exact: true })).toBeFocused();
  await root.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  const seasons = root.getByRole('navigation', { name: 'Seasons' });
  await expect(seasons.getByRole('button')).toHaveCount(3);
  await expect(root.getByRole('button', { name: /^S1 · E\d/ })).toHaveCount(6);
  await expect(root.getByRole('button', { name: 'S1 · E1 The Long Way Home, watched' })).toContainText('Watched');
  await expect(root.getByRole('button', { name: 'S1 · E2 A Line in the Snow' })).toContainText('Continue watching');
  await seasons.getByRole('button', { name: /^Season 2/ }).click();
  await expect(root.getByRole('heading', { name: 'Season 2', exact: true })).toBeVisible();
  await expect(root.getByRole('button', { name: /^S2 · E\d/ })).toHaveCount(6);
  await expect(root.getByRole('button', { name: 'S2 · E1 First Light' })).toBeVisible();
  await expect(root.getByRole('button', { name: /^S1 · E\d/ })).toHaveCount(0);
  await expect(seasons.getByRole('button', { name: /^Season 2/ })).toHaveAttribute('aria-pressed', 'true');
  await root.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(root.getByRole('button', { name: 'Episodes & seasons', exact: true })).toBeFocused();
});

test('remote arrows, OK and Back navigate seasons and restore the entry focus', async ({ page }) => {
  await open(page);
  const root = detail(page);
  await expect(root.getByRole('button', { name: 'Resume S1 · E2', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(root.getByRole('button', { name: 'Episodes & seasons', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const season1 = root.getByRole('navigation', { name: 'Seasons' }).getByRole('button', { name: /^Season 1/ });
  await expect(season1).toBeFocused();
  await expect(root.getByRole('button', { name: /^S1 · E\d/ })).toHaveCount(6);
  await page.keyboard.press('ArrowDown');
  const season2 = root.getByRole('navigation', { name: 'Seasons' }).getByRole('button', { name: /^Season 2/ });
  await expect(season2).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(root.getByRole('button', { name: 'S2 · E1 First Light' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(root.locator('button[data-episode]:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(root.getByRole('button', { name: 'Episodes & seasons', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
  await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden', 'true');
});

test('episode playback resumes the selected episode and returns to its details', async ({ page }) => {
  await open(page);
  await detail(page).getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await detail(page).getByRole('button', { name: 'S1 · E2 A Line in the Snow', exact: true }).click();
  const player = page.getByRole('main', { name: 'Demo playback' });
  await expect(player).toBeVisible();
  await expect(page).toHaveURL(/#\/video$/);
  await expect(player.getByRole('heading')).toHaveText('North of Nowhere · A Line in the Snow');
  await expect(player).toContainText('No actual stream is playing.');
  await expect(player).toContainText('Playback would resume at 18:30.');
  await expect(detail(page)).toHaveCount(0);
  await player.getByRole('button', { name: 'Back to details' }).click();
  await expect(page).toHaveURL(/#\/details\?id=series-north$/);
  await expect(detail(page).getByRole('button', { name: 'Resume S1 · E2', exact: true })).toBeFocused();
});

test('movie metadata, recommendations and favourite state survive navigation', async ({ page }) => {
  await open(page, 'movie-tide');
  const root = detail(page);
  await expect(root.getByRole('heading', { name: 'After the Tide', exact: true })).toBeVisible();
  await expect(root.getByText('1h 54m', { exact: true })).toBeVisible();
  await expect(root.getByText('Romy Bell, Elias North, Leah Vale', { exact: true })).toBeVisible();
  await expect(root.getByRole('button', { name: /The Shape of Silence/ })).toHaveCount(1);
  await root.getByRole('button', { name: 'Add to favourites', exact: true }).click();
  await expect(root.getByRole('button', { name: 'Remove from favourites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByRole('status')).toHaveText('Added to your favourites');
  await root.getByRole('button', { name: 'More like this', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'More like this', exact: true })).toBeVisible();
  await root.getByRole('button', { name: /Higher Ground/ }).click();
  await expect(page).toHaveURL(/id=movie-higher$/);
  await expect(root.getByRole('heading', { name: 'Higher Ground', exact: true, level: 1 })).toBeVisible();
  await page.goBack();
  await expect(root.getByRole('heading', { name: 'After the Tide', exact: true })).toBeVisible();
  await root.getByRole('button', { name: 'Remove from favourites', exact: true }).click();
  await expect(root.getByRole('button', { name: 'Add to favourites', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('movie trailer has an icon, starts independently, and preserves movie resume progress', async ({ page }) => {
  await open(page, 'movie-tide');
  const root = detail(page);
  const trailer = root.getByRole('button', { name: 'Watch trailer', exact: true });
  await expect(trailer).toBeVisible();
  await expect(trailer.locator('svg')).toBeVisible();
  await expect(root.getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(trailer).toBeFocused();
  await page.keyboard.press('Enter');
  const player = page.getByRole('main', { name: 'Demo playback' });
  await expect(player.getByRole('heading')).toHaveText('After the Tide · Official trailer');
  await expect(player).toContainText('Trailer playback would start from the beginning.');
  await expect(player).not.toContainText('Playback would resume');
  await expect(root).toHaveCount(0);
  await expect(player.getByRole('button', { name: 'Back to details' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/details\?id=movie-tide$/);
  await root.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(player.getByRole('heading')).toHaveText('After the Tide');
  await expect(player).toContainText('Playback would resume at 28:15.');
});

test('an unavailable trailer reports the problem and leaves movie playback available', async ({ page }) => {
  await open(page, 'movie-tide', 'empty');
  const root = detail(page);
  const trailer = root.getByRole('button', { name: 'Watch trailer', exact: true });
  await trailer.click();
  await expect(root.getByRole('status')).toHaveText('No trailer is available for this film.');
  await expect(trailer).not.toHaveAttribute('aria-busy', 'true');
  await expect(trailer).toBeFocused();
  await expect(page).toHaveURL(/#\/details\?id=movie-tide$/);
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await root.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toContainText('Playback would resume at 28:15.');
});

test('leaving movie details cancels a trailer that is still loading', async ({ page }) => {
  await open(page, 'movie-tide');
  // Hold only the public playback boundary until the old detail view is gone.
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.playTrailer;
    api.playTrailer = async (...args) => {
      await new Promise<void>((resolve) => document.addEventListener('release-trailer', () => resolve(), { once: true }));
      await original(...args);
      document.dispatchEvent(new Event('trailer-settled'));
    };
  });
  await detail(page).getByRole('button', { name: 'Watch trailer', exact: true }).click();
  await expect(detail(page).getByRole('status')).toHaveText('Starting trailer for After the Tide…');
  await page.getByRole('navigation', { name: 'Preview media type' }).getByRole('link', { name: 'TV Shows', exact: true }).click();
  await expect(detail(page).getByRole('heading', { name: 'TV Shows', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    document.addEventListener('trailer-settled', () => resolve(), { once: true });
    document.dispatchEvent(new Event('release-trailer'));
  }));
  await expect(page).toHaveURL(/#\/tv\?topParentId=library-tv$/);
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'TV Shows', exact: true }).locator('[data-show-item]').first()).toBeFocused();
});

test('Live TV guide changes programme details on focus and tunes the selected current programme', async ({ page }) => {
  await open(page, 'channel-field');
  const root = detail(page);
  await expect(root.getByRole('heading', { name: 'Field Notes', exact: true })).toBeVisible();
  await expect(root.getByRole('heading', { name: 'The Secret Life of Forests', exact: true })).toBeVisible();
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const channels = root.locator('button[data-channel]');
  await expect(channels).toHaveCount(4);
  await expect(root.locator('[data-program="channel-outside-program-1"]')).toBeAttached();
  await root.locator('button[data-channel="channel-outside"]').focus();
  await expect(root.locator('button[data-channel="channel-outside"]')).toBeFocused();
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await root.locator('[data-program="channel-outside-program-2"]').click();
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/livetv\?collectionType=livetv$/);
  await expect(page.getByRole('main', { name: 'Demo playback' })).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(root.locator('[data-program="channel-outside-program-1"]')).toBeFocused();
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  const player = page.getByRole('main', { name: 'Demo playback' });
  await expect(player.getByRole('heading')).toHaveText('Outside');
  await expect(player).toContainText('The live channel would begin playing.');
  await expect(root).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/livetv\?collectionType=livetv$/);
  await expect(root.getByRole('main', { name: 'Live TV programme guide', exact: true })).toBeVisible();
});

test('item loading failures offer retry and Back', async ({ page }) => {
  await open(page, 'series-north', 'error');
  const root = detail(page);
  await expect(root.getByRole('heading', { name: 'Unable to load this title' })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await root.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(root.getByText('Loading your library…', { exact: true })).toBeVisible();
  await expect(root.getByRole('heading', { name: 'Unable to load this title' })).toBeVisible();
  await root.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(root).toHaveCount(0);
  await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden', 'true');
});

test('an episode request can recover through its local retry button', async ({ page }) => {
  // Stub only the public API boundary; the full real view and navigation code still run.
  await page.route('**/dist/demo.js', async (request) => {
    const response = await request.fetch();
    const script = await response.text();
    await request.fulfill({ response, body: `${script}\n(() => { const api = window.TvItemLayoutDemo.api; const original = api.getEpisodes; let failed = false; api.getEpisodes = (...args) => { if (!failed) { failed = true; return Promise.reject(new Error('Transient connection loss')); } return original(...args); }; })();` });
  });
  await open(page);
  const root = detail(page);
  await root.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'Episodes could not be loaded' })).toBeVisible();
  await root.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(root.getByRole('button', { name: /^S1 · E\d/ })).toHaveCount(6);
  await expect(root.getByRole('heading', { name: 'Episodes could not be loaded' })).toHaveCount(0);
});

test('an empty series keeps episodes discoverable and disables playback', async ({ page }) => {
  await open(page, 'series-north', 'empty');
  const root = detail(page);
  await expect(root.getByRole('button', { name: 'No episodes available', exact: true })).toBeDisabled();
  await root.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'No seasons available', exact: true })).toBeVisible();
  await expect(root.getByRole('navigation', { name: 'Seasons' }).getByRole('button')).toHaveCount(0);
});

test('a movie without recommendations keeps playback available', async ({ page }) => {
  await open(page, 'movie-tide', 'empty');
  const root = detail(page);
  await expect(root.getByRole('heading', { name: 'A little more to discover' })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await root.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toContainText('Playback would resume at 28:15.');
});

test('an empty channel list explains the problem and leaves the current channel available from overview', async ({ page }) => {
  await open(page, 'channel-field', 'empty');
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'No channels available' })).toBeVisible();
  await expect(root.locator('button[data-channel]')).toHaveCount(0);
  await root.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toBeEnabled();
  await root.getByRole('button', { name: 'Watch live', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Demo playback' }).getByRole('heading')).toHaveText('Field Notes');
});

test('channels without programme information remain selectable and playable in the guide', async ({ page }) => {
  await open(page, 'channel-field');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.getChannels;
    api.getChannels = async () => (await original()).map(channel => ({ ...channel, CurrentProgram: undefined }));
    api.getPrograms = async () => [];
  });
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  await expect(root.locator('.tvl-epg-row-message').filter({ hasText: 'No programme information' })).toHaveCount(4);
  await expect(root.locator('[data-program]')).toHaveCount(0);
  await root.locator('button[data-channel="channel-outside"]').focus();
  await expect(root.getByRole('region', { name: 'Selected programme' })).toContainText('Outside');
  await expect(root.getByRole('heading', { name: 'The guide is taking a break' })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await root.locator('[data-channel="channel-outside"]').click();
  await expect(page.getByRole('main', { name: 'Demo playback' }).getByRole('heading')).toHaveText('Outside');
});

test('the selected channel survives programme responses arriving after the user starts browsing', async ({ page }) => {
  await open(page, 'channel-field');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.getPrograms;
    const pending = new Promise<void>(resolve => document.addEventListener('release-programmes', () => resolve(), { once: true }));
    api.getPrograms = async (...args) => { await pending; return original(...args); };
  });
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  await expect(root.locator('.tvl-epg-row-message').filter({ hasText: 'Loading schedule…' })).toHaveCount(4);
  const outside = root.locator('button[data-channel="channel-outside"]');
  await outside.focus();
  await expect(outside).toBeFocused();
  await expect(root.getByRole('region', { name: 'Selected programme' })).toContainText('Outside');
  await page.evaluate(() => document.dispatchEvent(new Event('release-programmes')));
  await expect(root.locator('[data-program]')).toHaveCount(16);
  await expect(root.getByRole('region', { name: 'Selected programme' })).toContainText('Outside');
  await expect(root.locator('[data-epg-row="channel-outside"]:focus')).toHaveCount(1);
  await root.locator('[data-channel="channel-outside"]').click();
  await expect(page.getByRole('main', { name: 'Demo playback' }).getByRole('heading')).toHaveText('Outside');
});

test('a failed channel schedule can be retried entirely with the remote', async ({ page }) => {
  await open(page, 'channel-field');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.getPrograms;
    let failed = false;
    api.getPrograms = async (...args) => {
      if (args[0] === 'channel-field' && !failed) { failed = true; throw new Error('Temporary schedule failure'); }
      return original(...args);
    };
  });
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const row = root.locator('[data-channel-row="channel-field"]');
  const channel = row.locator('button[data-channel]');
  const retry = row.getByRole('button', { name: 'Retry', exact: true });
  await expect(row).toContainText('Schedule unavailable');
  await expect(channel).toBeFocused();
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(retry).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(channel).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(row.locator('[data-program]')).toHaveCount(4);
  await expect(retry).toHaveCount(0);
  await expect(channel).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(row.locator('[data-program="channel-field-program-1"]')).toBeFocused();
});

test('the periodic guide refresh preserves remote focus on More channels', async ({ page }) => {
  await page.clock.install();
  await open(page, 'channel-field');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const originalChannels = api.getChannels;
    const originalPrograms = api.getPrograms;
    api.getChannels = async () => {
      const channel = (await originalChannels())[0]!;
      return Array.from({ length: 20 }, (_, index) => ({ ...channel, Id: index ? `extra-channel-${index}` : channel.Id, Name: index ? `Extra channel ${index}` : channel.Name }));
    };
    let requests = 0;
    api.getPrograms = async channelId => {
      const programmes = await originalPrograms('channel-field');
      document.documentElement.dataset.guideRequests = String(++requests);
      return programmes.map((item, index) => ({ ...item, Id: `${channelId}-programme-${index}`, ChannelId: channelId }));
    };
  });
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const more = root.getByRole('button', { name: 'More channels', exact: true });
  await expect(more).toBeEnabled();
  await expect(root.locator('button[data-channel]')).toHaveCount(16);
  await root.locator('button[data-channel="extra-channel-15"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(more).toBeFocused();
  // The real view's one-minute timer refreshes the guide from its public API.
  await page.clock.fastForward(60_000);
  await expect(page.locator('html')).toHaveAttribute('data-guide-requests', '32');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(root.locator('button[data-channel]')).toHaveCount(20);
  await expect(root.locator('[data-epg-row="extra-channel-16"]:focus')).toHaveCount(1);
  await expect(root.getByRole('button', { name: /More channels/ })).toHaveCount(0);
});

test('the guide refreshes its shared time window when a TV resumes on the next day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-23T20:10:00Z') });
  await open(page, 'channel-field');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.getPrograms;
    let requests = 0;
    api.getPrograms = async (...args) => {
      const programmes = await original(...args);
      const start = Math.floor(Date.now() / 1_800_000) * 1_800_000 - 900_000;
      document.documentElement.dataset.guideRequests = String(++requests);
      return programmes.map((item, index) => ({
        ...item,
        StartDate: new Date(start + index * 3_600_000).toISOString(),
        EndDate: new Date(start + (index + 1) * 3_600_000).toISOString(),
      }));
    };
  });
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  await expect(root.locator('[data-program]')).toHaveCount(16);
  await expect(page.locator('html')).toHaveAttribute('data-guide-requests', '4');
  const initialTime = await root.locator('.tvl-epg-time').first().textContent();
  // Sleep/resume fires the elapsed periodic timer once, as it does on a real TV.
  await page.clock.fastForward(25 * 3_600_000);
  await expect(page.locator('html')).toHaveAttribute('data-guide-requests', '8');
  await expect(root.locator('[data-program]')).toHaveCount(16);
  await expect(root.locator('.tvl-epg-time').first()).not.toHaveText(initialTime!);
  const current = root.locator('[data-program="channel-field-program-1"]');
  await expect(current).toBeFocused();
  await expect(current).toHaveClass(/tvl-epg-program-live/);
  await expect(current).toBeInViewport({ ratio: 0.9 });
  await expect(root.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);
});

test('rapid season changes cannot let a slower response replace the chosen season', async ({ page }) => {
  await open(page, 'series-north', 'slow');
  const root = detail(page);
  await expect(root.getByRole('button', { name: 'Episodes & seasons', exact: true })).toBeVisible();
  await root.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  const seasons = root.getByRole('navigation', { name: 'Seasons' });
  await seasons.getByRole('button', { name: /^Season 2/ }).click();
  await seasons.getByRole('button', { name: /^Season 3/ }).click();
  await expect(root.getByRole('button', { name: 'S3 · E1 Open Country' })).toBeVisible();
  // The fixture resolves Season 2 after 1700ms, versus 800ms for Season 3.
  // Observe beyond that response, which must be discarded rather than changing the view.
  await page.waitForTimeout(1100);
  await expect(root.getByRole('heading', { name: 'Season 3', exact: true })).toBeVisible();
  await expect(root.getByRole('button', { name: /^S3 · E\d/ })).toHaveCount(6);
  await expect(root.getByRole('button', { name: /^S2 · E\d/ })).toHaveCount(0);
});

test('navigating away during loading discards the old item response', async ({ page }) => {
  await open(page, 'series-north', 'slow');
  await expect(detail(page).getByText('Loading your library…', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Preview media type' }).getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(detail(page).getByRole('heading', { name: 'Movies', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('region', { name: 'Continue watching', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('region', { name: 'Recently added', exact: true }).getByRole('button', { name: 'The Shape of Silence', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/movies\?topParentId=library-movies$/);
  await expect(detail(page)).toHaveCount(1);
  await expect(detail(page).getByRole('heading', { name: 'North of Nowhere', exact: true })).toHaveCount(0);
});

test('desktop layout does not activate; TV class changes activate and cleanly deactivate', async ({ page }) => {
  await page.route('http://127.0.0.1:4173/', async (request) => {
    const response = await request.fetch();
    await request.fulfill({ response, body: (await response.text()).replace('class="layout-tv"', 'class="layout-desktop"') });
  });
  await page.goto(route('movie-tide'));
  await expect.poll(() => page.evaluate(() => !!window.TvItemLayout)).toBe(true);
  await page.evaluate(() => window.TvItemLayout!.refresh());
  await expect(detail(page)).toHaveCount(0);
  await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => document.documentElement.classList.add('layout-tv'));
  await expect(detail(page).getByRole('heading', { name: 'After the Tide', exact: true })).toBeVisible();
  await expect(page.locator('.itemDetailPage')).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => document.documentElement.classList.remove('layout-tv'));
  await expect(detail(page)).toHaveCount(0);
  await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('body')).not.toHaveClass(/tvl-open/);
  const redundantClassChanges = await page.evaluate(() => new Promise<number>((resolve) => {
    let changes = 0;
    const observer = new MutationObserver((records) => { changes += records.length; });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { observer.disconnect(); resolve(changes); }, 200);
  }));
  expect(redundantClassChanges, 'desktop mode must not keep rescheduling itself by mutating its body class').toBe(0);
});

test('detail rendering remains functional without post-Chromium-79 replaceChildren', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.deleteProperty(Element.prototype, 'replaceChildren');
    Reflect.deleteProperty(Document.prototype, 'replaceChildren');
    Reflect.deleteProperty(DocumentFragment.prototype, 'replaceChildren');
  });
  await open(page);
  const root = detail(page);
  await root.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  await expect(root.getByRole('button', { name: 'S1 · E1 The Long Way Home, watched' })).toBeVisible();
  await root.getByRole('navigation', { name: 'Seasons' }).getByRole('button', { name: /^Season 3/ }).click();
  await expect(root.getByRole('button', { name: 'S3 · E1 Open Country' })).toBeVisible();
  await root.getByRole('button', { name: 'Overview', exact: true }).click();
  await root.getByRole('button', { name: 'More like this', exact: true }).click();
  await root.getByRole('button', { name: /After the Tide/ }).click();
  await expect(root.getByRole('heading', { name: 'After the Tide', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('navigation', { name: 'Preview media type' }).getByRole('link', { name: 'Live TV', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'The Secret Life of Forests', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('D-pad navigation scrolls horizontally through programmes and vertically between channels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, 'channel-field');
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const programme = (channel: string, number: number) => root.locator(`[data-program="channel-${channel}-program-${number}"]`);
  await expect(programme('field', 1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(programme('field', 2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(programme('horizon', 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(programme('drift', 2)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(programme('horizon', 1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(programme('field', 2)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(programme('field', 3)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(programme('field', 4)).toBeFocused();
  await expect(programme('field', 4)).toBeInViewport({ ratio: 0.9 });
  await expect.poll(() => root.locator('.tvl-epg-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect(root.locator('button[data-channel="channel-field"]')).toBeInViewport({ ratio: 0.9 });
  await page.keyboard.press('Escape');
  await expect(root.getByRole('button', { name: 'Channels & guide', exact: true })).toBeFocused();
});

test('landscape guide shares a horizontal time axis and sizes programmes by duration', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, 'channel-field');
  await page.evaluate(() => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.getPrograms;
    const start = Date.now() - 15 * 60_000;
    api.getPrograms = async (...args) => {
      let cursor = start;
      return (await original(...args)).map((item, index) => {
        const duration = [30, 90, 60, 60][index]! * 60_000;
        const programme = { ...item, StartDate: new Date(cursor).toISOString(), EndDate: new Date(cursor + duration).toISOString() };
        cursor += duration;
        return programme;
      });
    };
  });
  const root = detail(page);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const programme = (channel: string, number: number) => root.locator(`[data-program="channel-${channel}-program-${number}"]`);
  await expect(programme('outside', 3)).toBeAttached();
  const long = await programme('field', 2).boundingBox();
  const short = await programme('field', 3).boundingBox();
  const nextChannel = await programme('horizon', 2).boundingBox();
  expect(long).not.toBeNull();
  expect(short).not.toBeNull();
  expect(nextChannel).not.toBeNull();
  expect(Math.abs(long!.y - short!.y), 'programmes run across the same channel row').toBeLessThan(2);
  expect(short!.x, 'later programmes appear to the right').toBeGreaterThanOrEqual(long!.x + long!.width - 2);
  expect(Math.abs(long!.x - nextChannel!.x), 'equal start times align between channels').toBeLessThan(2);
  expect(nextChannel!.y, 'channels occupy separate rows').toBeGreaterThanOrEqual(long!.y + long!.height - 2);
  expect(long!.width / short!.width, '90-minute programmes use 1.5 times a 60-minute slot').toBeCloseTo(1.5, 1);
  const scroll = await root.locator('.tvl-epg-scroll').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight, timelineWidth: element.scrollWidth }));
  expect(scroll.width, 'the guide uses the landscape viewport').toBeGreaterThan(scroll.height);
  expect(scroll.timelineWidth, 'the shared timeline continues beyond the viewport').toBeGreaterThan(scroll.width);
});
