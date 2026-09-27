import { expect, test, type Page } from '@playwright/test';

const position = 41_574_955_419;
const duration = 62_521_580_000;
const percentage = position / duration * 100;

async function rewatch(page: Page) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api=window.TvItemLayoutDemo.api,get=api.getItem,suggest=api.getMovieSuggestions,episodes=api.getEpisodes,play=api.play;
      const state=window.__rewatch={writes:[],plays:[],fail:false};
      const wrap=item=>['movie-tide','episode-north-1-1'].includes(item.Id)?{...item,RunTimeTicks:${duration},
        UserData:{...item.UserData,Played:true,PlaybackPositionTicks:${position},PlayedPercentage:100,PlayCount:5,LastPlayedDate:'2026-09-26T20:00:00Z'}}:item;
      api.getItem=async id=>wrap(await get(id));
      api.getMovieSuggestions=async (...args)=>(await suggest(...args)).map(section=>({...section,items:section.items.map(wrap)}));
      api.getEpisodes=async (...args)=>(await episodes(...args)).map(wrap);
      api.setPlayed=async (...args)=>{state.writes.push(args);throw new Error('Unexpected watch-history write');};
      api.play=async (item,ticks,current)=>{state.plays.push({id:item.Id,ticks});if(state.fail)throw new Error('Playback could not start in this client.');return play(item,ticks,current);};
    })();` });
  });
}

for (const layout of ['desktop', 'tv']) test(`${layout} rewatch uses its saved position and shows movie-card progress without rewriting history`, async ({ page }, info) => {
  await rewatch(page);
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00Z'));
  await page.goto(`/?layout=${layout}#/movies`);
  const section = page.getByRole('region', { name: 'Continue watching', exact: true });
  const card = section.locator('[data-movie-item="movie-tide"]');
  const bar = card.getByRole('progressbar', { name: 'Playback progress' });
  await expect(bar).toBeVisible(); await expect(bar).toHaveAttribute('aria-valuenow', '66');
  expect(await bar.locator('span').evaluate(node => parseFloat((node as HTMLElement).style.width))).toBeCloseTo(percentage, 4);
  await card.focus(); await expect(card).toBeFocused();
  await page.screenshot({ path: info.outputPath(`rewatch-progress-${layout}.png`) });
  await card.click();
  const root = page.getByRole('dialog', { name: 'After the Tide details', exact: true });
  const resume = root.getByRole('button', { name: 'Resume', exact: true });
  const restart = root.getByRole('button', { name: 'Play from beginning', exact: true });
  await expect(resume).toBeFocused(); await expect(restart).toBeVisible();
  await expect(root.getByRole('button', { name: 'Mark watched', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await root.locator('.tvl-resume .tvl-progress > span').evaluate(node => parseFloat((node as HTMLElement).style.width))).toBeCloseTo(percentage, 4);
  const expectedEnd = new Date(Date.parse('2026-09-27T12:00:00Z') + (duration - position) / 10_000).toISOString();
  await expect(root.locator('.tvl-end-time')).toHaveAttribute('datetime', expectedEnd);
  await resume.click();
  const player = page.getByRole('main', { name: 'Demo playback' });
  await expect(player).toContainText('Playback would resume at 69:17.');
  await player.getByRole('button', { name: 'Back to details', exact: true }).click();
  await expect(resume).toBeVisible();
  await page.evaluate(() => { (window as any).__rewatch.fail = true; });
  await restart.click();
  await expect(root.locator('.tvl-status')).toContainText('Playback could not start in this client.');
  await expect(resume).toBeVisible();
  expect(await page.evaluate(() => (window as any).__rewatch)).toEqual({ writes: [], plays: [{ id: 'movie-tide', ticks: position }, { id: 'movie-tide', ticks: 0 }], fail: true });
  const userData = await page.evaluate(async () => (await window.TvItemLayoutDemo!.api.getItem('movie-tide')).UserData);
  expect(userData).toMatchObject({ Played: true, PlaybackPositionTicks: position, PlayCount: 5, LastPlayedDate: '2026-09-26T20:00:00Z' });
});

test('a watched episode being replayed has Resume and current progress in its episode row', async ({ page }) => {
  await rewatch(page);
  await page.goto('/#/details?id=episode-north-1-1');
  await expect(page.getByRole('button', { name: 'Resume S1 · E1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play from beginning', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
  const episode = page.locator('[data-episode="episode-north-1-1"]');
  await expect(episode.locator('.tvl-continue')).toHaveText('Continue watching');
  await expect(episode.locator('.tvl-watched')).toHaveCount(0);
  await expect(episode).not.toHaveAttribute('aria-label', /, watched$/);
  expect(await episode.locator('.tvl-thumb-progress').evaluate(node => parseFloat((node as HTMLElement).style.width))).toBeCloseTo(percentage, 4);
  await episode.click();
  await expect(page.getByRole('main', { name: 'Demo playback' })).toContainText('Playback would resume at 69:17.');
  expect(await page.evaluate(() => (window as any).__rewatch.writes)).toEqual([]);
});

test('marking an in-progress rewatch complete sends watched=true and updates controls only after confirmation', async ({ page }) => {
  await rewatch(page);
  await page.goto('/#/details?id=movie-tide');
  const watched = page.getByRole('button', { name: 'Mark watched', exact: true });
  await expect(watched).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    const state = (window as any).__rewatch;
    window.TvItemLayoutDemo!.api.setPlayed = async (id, played) => {
      state.writes.push([id, played]);
      await new Promise<void>(resolve => { state.release = resolve; });
      return { ItemId: id, Played: played, PlaybackPositionTicks: 0, PlayedPercentage: 100, PlayCount: 6 };
    };
  });
  await watched.click();
  await expect(watched).toHaveAttribute('aria-busy', 'true');
  await expect(watched).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__rewatch.writes)).toEqual([['movie-tide', true]]);
  await page.evaluate(() => (window as any).__rewatch.release());
  await expect(page.getByRole('button', { name: 'Mark unwatched', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
