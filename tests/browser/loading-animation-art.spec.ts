import { expect, test } from '@playwright/test';
import { loadingAnimations } from '../../src/loading-settings';

const route = '/?featured=0&layout=desktop#/mypreferencesmenu?cinemaLoading=1';

test('all six loading illustrations animate, remain inside their previews and fit desktop and mobile settings', async ({ page }) => {
  await page.goto(route);
  const settings = page.getByRole('dialog', { name: 'Loading screen settings', exact: true });
  await expect(settings.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  const preview = settings.locator('.tvl-loading-settings-preview');
  for (const animation of loadingAnimations) {
    await settings.getByRole('button', { name: animation.name, exact: true }).click();
    await expect(preview.locator('.tvl-loading-animation')).toHaveAttribute('data-animation', animation.id);
    expect(await preview.locator('.tvl-loading-art *').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).animationName !== 'none'))).toBe(true);
    if (animation.id === 'jellyfin') await expect.poll(() => preview.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(72);
  }
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    for (const box of await settings.locator('.tvl-loading-preview').evaluateAll(nodes => nodes.map(node => {
      const outer = node.getBoundingClientRect(), art = node.querySelector('.tvl-loading-art')!.getBoundingClientRect();
      return { left: art.left - outer.left, right: outer.right - art.right, top: art.top - outer.top, bottom: outer.bottom - art.bottom };
    }))) {
      expect(box.left).toBeGreaterThanOrEqual(-1); expect(box.right).toBeGreaterThanOrEqual(-1);
      expect(box.top).toBeGreaterThanOrEqual(-1); expect(box.bottom).toBeGreaterThanOrEqual(-1);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await settings.getByRole('button', { name: 'Clapperboard', exact: true }).click();
  await page.mouse.move(20, 20);
  await page.screenshot({ path: '/tmp/screenharbour-loading-choices-desktop.png' });
  await settings.getByRole('button', { name: 'Jellyfin logo', exact: true }).click();
  await page.mouse.move(20, 20);
  await page.screenshot({ path: '/tmp/screenharbour-loading-jellyfin-preview.png' });
});

test('reduced motion leaves every loading choice static and a single film-leader numeral visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(route);
  const settings = page.getByRole('dialog', { name: 'Loading screen settings', exact: true });
  await expect(settings.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  for (const animation of loadingAnimations) {
    await settings.getByRole('button', { name: animation.name, exact: true }).click();
    expect(await settings.locator('.tvl-loading-animation *').evaluateAll(nodes => nodes.every(node =>
      ['', '::before', '::after'].every(pseudo => getComputedStyle(node, pseudo || null).animationName === 'none')))).toBe(true);
  }
  await settings.getByRole('button', { name: 'Cinema countdown', exact: true }).click();
  const numerals = settings.locator('.tvl-loading-settings-preview .tvl-loading-countdown-number');
  expect(await numerals.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).opacity))).toEqual(['1', '0', '0']);
});
