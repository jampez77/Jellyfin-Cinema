import { expect, test, type Page } from '@playwright/test';
import { useDesktopLayout } from './layout-fixture';

const collections = (page: Page) => page.getByRole('dialog', { name: 'Collections', exact: true });
const launcher = (page: Page) => page.getByRole('button', { name: 'Customize Home rows', exact: true });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Customize Home rows', exact: true });
const saved = (page: Page) => page.evaluate(() => localStorage.getItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`));

test('TV Collections remains browsable without the customization launcher; desktop exposes it only on Collections', async ({ page }) => {
  await page.goto('/?featured=0#/list?parentId=library-collections');
  await expect(collections(page)).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);
  await expect(collections(page).getByRole('button', { name: 'Coastal Stories', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('tv-collections-without-editor-launcher.png') });
  await collections(page).getByRole('button', { name: 'Coastal Stories', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Coastal Stories collection', exact: true })).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(collections(page).getByRole('button', { name: 'Coastal Stories', exact: true })).toBeFocused();

  await useDesktopLayout(page);
  await expect(launcher(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('desktop-collections-editor-launcher.png') });
  await launcher(page).click();
  await expect(editor(page).getByRole('button', { name: 'Add collection items row', exact: true })).toBeEnabled();
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(launcher(page)).toBeFocused();
  await page.evaluate(() => { location.hash = '/home'; });
  await expect(page.locator('#homeTab')).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);
});

test('switching an open desktop editor to TV removes it and discards the draft, including conflicting layout roots', async ({ page }) => {
  await page.goto('/?featured=0#/list?parentId=library-collections');
  await expect(collections(page)).toBeVisible();
  await useDesktopLayout(page);
  await launcher(page).click();
  await editor(page).getByRole('button', { name: 'Add collection items row', exact: true }).click();
  await editor(page).getByLabel('Row title', { exact: true }).fill('Unsaved desktop draft');
  expect(await saved(page)).toBeNull();

  // Native display-mode changes can briefly leave different classes on each root.
  await page.evaluate(() => document.documentElement.classList.add('layout-tv'));
  await expect(editor(page)).toHaveCount(0);
  await expect(launcher(page)).toHaveCount(0);
  await expect(collections(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  expect(await saved(page)).toBeNull();
  await page.evaluate(() => document.documentElement.classList.remove('layout-tv'));
  await expect(launcher(page)).toHaveCount(1);
  await launcher(page).click();
  await expect(editor(page).getByRole('button', { name: 'Save rows', exact: true })).toBeEnabled();
  await expect(editor(page).locator('.tvl-home-row-choice')).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => document.documentElement.classList.add('layout-mobile'));
  await expect(launcher(page)).toHaveCount(0);
  await page.evaluate(() => document.documentElement.classList.remove('layout-mobile'));
  await expect(launcher(page)).toHaveCount(1);
});
