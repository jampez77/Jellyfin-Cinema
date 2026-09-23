import { expect, test } from '@playwright/test';

test('guide banner follows the highlighted live or upcoming programme with its own artwork', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/#/details?id=channel-field');
  const root = page.locator('#tv-layout');
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const banner = root.getByRole('region', { name: 'Selected programme' });
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  const liveArt = banner.getByRole('img', { name: 'The Secret Life of Forests', exact: true });
  await expect(liveArt).toBeVisible();
  await expect(liveArt).toHaveAttribute('src', /forest\.jpg$/);
  await expect.poll(() => liveArt.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(banner.getByText('LIVE NOW', { exact: true })).toBeVisible();
  await expect(root.locator('[data-program="channel-drift-program-1"]')).toBeInViewport({ ratio: 0.9 });

  await page.keyboard.press('ArrowRight');
  await expect(root.locator('[data-program="channel-field-program-2"]')).toBeFocused();
  const upcomingArt = banner.getByRole('img', { name: 'Wild Water', exact: true });
  await expect(upcomingArt).toBeVisible();
  await expect(upcomingArt).toHaveAttribute('src', /ocean\.jpg$/);
  await expect.poll(() => upcomingArt.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(banner.getByRole('heading')).toHaveText('Wild Water');
  await expect(banner.getByText('UPCOMING', { exact: true })).toBeVisible();
  await expect(banner.getByText('LIVE NOW', { exact: true })).toHaveCount(0);
  await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toHaveCount(0);

  await page.keyboard.press('ArrowDown');
  await expect(banner.getByRole('img', { name: 'The Long Way North', exact: true })).toHaveAttribute('src', /mountains\.jpg$/);
  await expect(banner.getByText('LIVE NOW', { exact: true })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toBeEnabled();
});

for (const missing of [true, false]) {
  test(`guide remains usable when highlighted programme artwork is ${missing ? 'missing' : 'unavailable'}`, async ({ page }) => {
    await page.goto('/#/details?id=channel-field');
    const root = page.locator('#tv-layout');
    await expect(root.getByRole('button', { name: 'Channels & guide', exact: true })).toBeVisible();
    await page.evaluate(missing => {
      const api = window.TvItemLayoutDemo!.api;
      const original = api.image;
      api.image = (item, kind) => item.Type === 'Program' ? (missing ? null : '/missing-programme-art.jpg') : original(item, kind);
    }, missing);
    await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
    const banner = root.getByRole('region', { name: 'Selected programme' });
    await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
    await expect(banner.getByRole('heading')).toHaveText('The Secret Life of Forests');
    await expect(banner.locator('img')).toHaveCount(0);
    await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toBeEnabled();
    await page.keyboard.press('ArrowRight');
    await expect(banner.getByRole('heading')).toHaveText('Wild Water');
    await expect(banner.locator('img')).toHaveCount(0);
    await expect(banner.getByText('UPCOMING', { exact: true })).toBeVisible();
  });
}
