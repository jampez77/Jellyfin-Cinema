import { expect, test, type Page } from '@playwright/test';

async function expectArtworkBoundary(page: Page) {
  await expect.poll(() => page.locator('#tv-layout').evaluate(root => {
    const artwork = root.querySelector('.tvl-epg-detail-art')!.getBoundingClientRect();
    const image = root.querySelector('.tvl-epg-detail-art img')!.getBoundingClientRect();
    const schedule = root.querySelector('.tvl-epg-scroll')!.getBoundingClientRect();
    return Math.max(Math.abs(artwork.top), Math.abs(image.top), Math.abs(artwork.bottom - schedule.top), Math.abs(image.bottom - schedule.top));
  })).toBeLessThan(0.5);
}

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
  const composition = await banner.evaluate(node => {
    const hero = node.getBoundingClientRect();
    const art = node.querySelector('img')!.getBoundingClientRect();
    const title = node.querySelector('h2')!.getBoundingClientRect();
    return {height: hero.height, imageHeight: art.height, imageTop: art.top, imageLeft: art.left, titleLeft: title.left, imageRight: art.right, viewportWidth: innerWidth};
  });
  expect(composition.imageLeft).toBeGreaterThan(composition.titleLeft);
  expect(composition.imageHeight).toBeGreaterThanOrEqual(composition.height - 1);
  expect(composition.imageRight).toBeCloseTo(composition.viewportWidth, 0);
  expect(composition.imageTop).toBe(0);
  await expectArtworkBoundary(page);
  await expect(banner).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(banner).toHaveCSS('border-radius', '0px');
  await expect(root.getByRole('heading', { name: 'Live TV', exact: true })).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Jump to now', exact: true })).toHaveCount(0);
  await expect(root.getByText('Browse programmes', { exact: false })).toHaveCount(0);
  await expect(root.locator('.tvl-epg-date')).toHaveCount(0);
  await expect(banner.getByText('LIVE NOW', { exact: true })).toBeVisible();
  await expect(root.locator('[data-program="channel-drift-program-1"]')).toBeInViewport({ ratio: 0.9 });
  await page.keyboard.press('ArrowUp');
  await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(root.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();

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

test('programme artwork ends at the schedule edge after viewport and content height changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#/livetv?collectionType=livetv');
  await expect(page.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expectArtworkBoundary(page);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    await expectArtworkBoundary(page);
    await page.keyboard.press('ArrowRight');
    await expectArtworkBoundary(page);
  }
  // Header/font or content sizing can change without a viewport resize.
  await page.addStyleTag({ content: '.tvl-epg-detail { height: 245px !important; min-height: 245px !important; }' });
  await expectArtworkBoundary(page);
  await page.addStyleTag({ content: '.tvl-header { height: 95px !important; min-height: 95px !important; }' });
  await expectArtworkBoundary(page);
  await expect(page.locator('#tv-layout .tvl-epg-row').first()).toHaveCSS('height', '74px');
  expect(errors).toEqual([]);
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
    await expect(banner.locator('.tvl-epg-channel-art img')).toHaveAttribute('alt', 'Field Notes logo');
    await expect.poll(() => banner.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toBeEnabled();
    await page.keyboard.press('ArrowRight');
    await expect(banner.getByRole('heading')).toHaveText('Wild Water');
    await expect(banner.locator('.tvl-epg-channel-art img')).toHaveAttribute('alt', 'Field Notes logo');
    await expect(banner.getByText('UPCOMING', { exact: true })).toBeVisible();
  });
}

for (const failed of [false, true]) test(`channel logo ${failed ? 'failure falls back to Primary' : 'is used before Primary'} without losing programme details`, async ({ page }) => {
  await page.route('**/channel-logo.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="white"/></svg>'
  }));
  await page.goto('/#/details?id=channel-field');
  const root = page.locator('#tv-layout');
  await expect(root.getByRole('button', { name: 'Channels & guide', exact: true })).toBeVisible();
  await page.evaluate(failed => {
    const api = window.TvItemLayoutDemo!.api;
    const original = api.image;
    api.image = (item, kind) => item.Type === 'Program' ? null
      : kind === 'logo' ? (failed ? '/missing-channel-logo.png' : '/channel-logo.svg') : original(item, kind);
  }, failed);
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const banner = root.getByRole('region', { name: 'Selected programme' });
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expect(banner.locator('.tvl-epg-channel-art img')).toHaveAttribute('src', failed ? /forest\.jpg$/ : /channel-logo\.svg$/);
  await expect(banner.locator('img')).toHaveCSS('object-fit', 'contain');
  await expect.poll(() => banner.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expectArtworkBoundary(page);
  await expect(banner.getByRole('heading')).toHaveText('The Secret Life of Forests');
});

test('guide remains readable and playable when programme and channel artwork both fail', async ({ page }) => {
  await page.goto('/#/details?id=channel-field');
  const root = page.locator('#tv-layout');
  await expect(root.getByRole('button', { name: 'Channels & guide', exact: true })).toBeVisible();
  await page.evaluate(() => { window.TvItemLayoutDemo!.api.image = () => '/missing-all-art.jpg'; });
  await root.getByRole('button', { name: 'Channels & guide', exact: true }).click();
  const banner = root.getByRole('region', { name: 'Selected programme' });
  await expect(root.locator('[data-program="channel-field-program-1"]')).toBeFocused();
  await expect(banner.locator('.tvl-no-art')).toBeVisible();
  await expect(banner.locator('img')).toHaveCount(0);
  await expect(banner.getByRole('heading')).toHaveText('The Secret Life of Forests');
  await expect(banner.getByRole('button', { name: 'Watch live', exact: true })).toBeEnabled();
});
