import { expect, test } from '@playwright/test';

test.describe('detail finish estimates', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

  test('a resumed movie finishes after midnight and updates at the displayed minute boundary', async ({ page }) => {
    const start = Date.parse('2026-09-23T22:45:00Z');
    await page.clock.install({ time: start });
    await page.goto('/#/details?id=movie-tide');
    const end = page.locator('#tv-layout .tvl-hero .tvl-meta .tvl-end-time');
    await expect(end).toHaveText('Ends at 01:10');
    await expect(end.locator('xpath=preceding-sibling::*[1]')).toHaveClass('tvl-community');
    await page.clock.pauseAt(start + 10_000);
    await page.clock.runFor(4_999);
    await expect(end).toHaveText('Ends at 01:10');
    await page.clock.runFor(1);
    await expect(end).toHaveText('Ends at 01:11');
    await expect(end).toHaveAttribute('datetime', '2026-09-24T00:11:00.000Z');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  });

  test('series and episode details estimate the selected episode, including restart of watched episodes', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-23T12:00:00Z'));
    await page.goto('/#/details?id=series-north');
    const end = page.locator('#tv-layout .tvl-end-time');
    await expect(page.getByRole('button', { name: 'Resume S1 · E2', exact: true })).toBeVisible();
    await expect(end).toHaveText('Ends at 13:28');
    await page.evaluate(() => { location.hash = '#/details?id=episode-north-1-1'; });
    await expect(page.getByRole('button', { name: 'Play S1 · E1', exact: true })).toBeVisible();
    await expect(end).toHaveText('Ends at 13:49');
    await page.evaluate(() => { location.hash = '#/details?id=episode-north-1-2'; });
    await expect(page.getByRole('button', { name: 'Resume S1 · E2', exact: true })).toBeVisible();
    await expect(end).toHaveText('Ends at 13:28');
  });

  test('unknown movie runtime and a series without playable episodes have no estimate', async ({ page }) => {
    await page.goto('/?scenario=empty#/details?id=series-north');
    await expect(page.getByRole('button', { name: 'No episodes available', exact: true })).toBeVisible();
    await expect(page.locator('#tv-layout .tvl-end-time')).toHaveCount(0);
    await page.evaluate(() => {
      const api = window.TvItemLayoutDemo!.api;
      const getItem = api.getItem;
      api.getItem = async id => ({ ...await getItem(id), RunTimeTicks: undefined });
      location.hash = '#/details?id=movie-tide';
    });
    await expect(page.getByRole('heading', { name: 'After the Tide', exact: true })).toBeVisible();
    await expect(page.locator('#tv-layout .tvl-end-time')).toHaveCount(0);
  });

  test('leaving a detail pane or closing its view stops updates to its old clock', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') });
    await page.goto('/#/details?id=series-north');
    await expect(page.locator('#tv-layout .tvl-end-time')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.dataset.oldClockUpdates = '0';
      const observer = new MutationObserver(() => {
        document.documentElement.dataset.oldClockUpdates = String(Number(document.documentElement.dataset.oldClockUpdates) + 1);
      });
      observer.observe(document.querySelector('.tvl-end-time')!, { childList: true, attributes: true });
    });
    await page.getByRole('button', { name: 'Episodes & seasons', exact: true }).click();
    await expect(page.locator('#tv-layout .tvl-end-time')).toHaveCount(0);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.locator('#tv-layout .tvl-end-time')).toBeVisible();
    await page.clock.runFor(120_000);
    await expect(page.locator('html')).toHaveAttribute('data-old-clock-updates', '0');
    await page.evaluate(() => {
      new MutationObserver(() => { document.documentElement.dataset.closedClockUpdated = 'true'; })
        .observe(document.querySelector('.tvl-end-time')!, { childList: true, attributes: true });
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#tv-layout')).toHaveCount(0);
    await page.clock.runFor(120_000);
    await expect(page.locator('html')).not.toHaveAttribute('data-closed-clock-updated', 'true');
  });
});

test.describe('finish estimate locale', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

  test('uses the browser clock format and time zone', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-23T17:00:00Z'));
    await page.goto('/#/details?id=movie-tide');
    await expect(page.locator('#tv-layout .tvl-end-time')).toHaveText('Ends at 02:25 PM');
  });
});
