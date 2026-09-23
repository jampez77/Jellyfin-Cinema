import { expect, test } from '@playwright/test';

test('native Back lifecycle applies Home styling before the next frame', async ({ page }) => {
  await page.goto('/?featured=0#/details?id=movie-tide');
  await expect(page.locator('#tv-layout')).toBeVisible();
  const result = await page.evaluate(() => {
    history.pushState(null, '', '#/home');
    document.querySelector('.itemDetailPage')!.dispatchEvent(new Event('viewbeforehide'));
    document.querySelector('#indexPage')!.dispatchEvent(new Event('viewshow'));
    return { home: document.body.classList.contains('tvl-home'), overlay: !!document.querySelector('#tv-layout') };
  });
  expect(result).toEqual({ home: true, overlay: false });
});

test('popstate masks a cached incoming detail page without the deferred refresh gap', async ({ page }) => {
  await page.goto('/?featured=0#/home');
  await expect(page.locator('body')).toHaveClass(/tvl-home/);
  const result = await page.evaluate(() => {
    history.pushState(null, '', '#/details?id=movie-tide');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return { masked: document.querySelector('.itemDetailPage')!.classList.contains('tvl-native-hidden'), overlay: !!document.querySelector('#tv-layout') };
  });
  expect(result).toEqual({ masked: true, overlay: true });
});

test('returning to a verified Collections library mounts Cinema before a cached native page can paint', async ({ page }) => {
  await page.goto('/?featured=0#/list?parentId=library-collections');
  await expect(page.getByRole('button', { name: 'Customize collection rows', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '/home'; });
  await expect(page.locator('body')).toHaveClass(/tvl-home/);
  const result = await page.evaluate(() => {
    history.pushState(null, '', '#/list?parentId=library-collections');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return !!document.querySelector('.tvl-root');
  });
  expect(result).toBe(true);
});

test('unsupported native destinations remain visible immediately after leaving Cinema', async ({ page }) => {
  await page.goto('/?featured=0#/details?id=movie-tide');
  await expect(page.locator('#tv-layout')).toBeVisible();
  const result = await page.evaluate(() => {
    history.pushState(null, '', '#/video');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return { masked: document.querySelector('.itemDetailPage')!.classList.contains('tvl-native-hidden'), overlay: !!document.querySelector('.tvl-root'), home: document.body.classList.contains('tvl-home') };
  });
  expect(result).toEqual({ masked: false, overlay: false, home: false });
});
