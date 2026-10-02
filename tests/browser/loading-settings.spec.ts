import { expect, test, type Page } from '@playwright/test';
import { defaultLoadingScreen, type LoadingScreenSettings } from '../../src/loading-settings';

const editor = (page: Page) => page.getByRole('dialog', { name: 'Loading screen settings', exact: true });
const preview = (page: Page) => editor(page).locator('.tvl-loading-settings-preview');
async function setup(page: Page) {
  await page.goto('/?featured=0&layout=desktop#/mypreferencesmenu');
  await page.getByRole('link', { name: 'Loading screen Animation and custom text' }).click();
  await expect(editor(page).getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}
async function saved(page: Page): Promise<LoadingScreenSettings | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem(`jellyfin-cinema.loading-screen.v1:${encodeURIComponent(location.origin)}:demo`) || 'null'));
}
async function transport(page: Page, options: { hold?: boolean; fail?: boolean; conflict?: boolean; homeHold?: boolean } = {}) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api = window.TvItemLayoutDemo.api;
      const state = window.__loadingSettings = { value: ${JSON.stringify({ ...defaultLoadingScreen(), animation: 'jellyfin', brandText: 'Family cinema', message: 'Welcome home' })},
        reads: 0, writes: 0, hold: ${!!options.hold}, fail: ${!!options.fail}, conflict: ${!!options.conflict}, pending: [], homePending: [] };
      api.loadingScreen = { isCurrent: () => true, load: async () => {
        state.reads++; if(state.hold) await new Promise(resolve => state.pending.push(resolve));
        if(state.fail) throw new Error('Loading settings unavailable');
        return { Revision: 'current', Settings: structuredClone(state.value) };
      }, save: async (settings, revision) => {
        state.writes++; if(revision !== 'current') throw new Error('Wrong revision');
        if(state.conflict) throw new Error('Conflict fixture requires native transport');
        state.value = structuredClone(settings); return { Revision: 'saved', Settings: state.value };
      } };
      ${options.homeHold ? "api.getHomeLibraryExclusions = () => new Promise(resolve => state.homePending.push(resolve));" : ''}
    })();` });
  });
}

test('Settings offers six animations with editable safe text and saves across reloads', async ({ page }) => {
  await setup(page);
  await expect(editor(page).locator('.tvl-loading-choice')).toHaveCount(6);
  await editor(page).getByRole('button', { name: 'Jellyfin logo', exact: true }).click();
  await editor(page).getByLabel('Title', { exact: true }).fill('<b>Our cinema</b>');
  await editor(page).getByLabel('Message', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await expect(preview(page).locator('[data-animation="jellyfin"]')).toBeVisible();
  await expect(preview(page).locator('.tvl-home-loading-brand')).toHaveText('<b>Our cinema</b>');
  await expect(preview(page).locator('.tvl-home-loading-label')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(preview(page).locator('b,img[src="x"]')).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page).getByRole('status')).toHaveText('Saved on this device.');
  expect(await saved(page)).toMatchObject({ animation: 'jellyfin', brandText: '<b>Our cinema</b>' });
  await page.reload(); await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('<b>Our cinema</b>');
  await expect(editor(page).getByRole('button', { name: 'Jellyfin logo', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Cancel and Restore defaults leave the saved choice intact until Save, and blank text stays blank', async ({ page }) => {
  await setup(page); await editor(page).getByRole('button', { name: 'Spotlights', exact: true }).click();
  await editor(page).getByLabel('Title', { exact: true }).fill(''); await editor(page).getByLabel('Message', { exact: true }).fill('');
  await expect(preview(page).locator('.tvl-home-loading-brand,.tvl-home-loading-label')).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  await editor(page).getByRole('button', { name: 'Restore defaults', exact: true }).click();
  expect((await saved(page))?.animation).toBe('spotlights');
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Loading screen Animation and custom text' }).click();
  await expect(editor(page).getByRole('button', { name: 'Spotlights', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('');
});

test('another device receives server choices and saves only after the saved settings load', async ({ page }) => {
  await transport(page, { hold: true });
  await page.goto('/?featured=0&layout=desktop#/mypreferencesmenu?cinemaLoading=1');
  await expect(editor(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.evaluate(() => { const state = (window as any).__loadingSettings; state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve()); });
  await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('Family cinema');
  await expect(editor(page).getByRole('button', { name: 'Jellyfin logo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await editor(page).getByRole('button', { name: 'Film reel', exact: true }).click();
  await editor(page).getByLabel('Message', { exact: true }).fill('Please take your seats');
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(page).getByRole('status')).toHaveText('Saved to your Jellyfin account.');
  expect(await page.evaluate(() => (window as any).__loadingSettings.value)).toMatchObject({ animation: 'film-reel', message: 'Please take your seats' });
});

test('failed settings reads cannot overwrite saved choices and can be retried', async ({ page }) => {
  await transport(page, { fail: true });
  await page.goto('/?featured=0&layout=desktop#/mypreferencesmenu?cinemaLoading=1');
  await expect(editor(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(editor(page).getByRole('status')).toHaveText('Loading settings unavailable');
  await page.evaluate(() => { (window as any).__loadingSettings.fail = false; });
  await editor(page).getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('Family cinema');
  expect(await page.evaluate(() => (window as any).__loadingSettings.writes)).toBe(0);
});

for (const layout of ['desktop', 'tv']) test(`${layout} Back can leave while loading preferences are still pending`, async ({ page }) => {
  await transport(page, { hold: true });
  await page.goto(`/?featured=0&layout=${layout}#/mypreferencesmenu`);
  await page.getByRole('link', { name: 'Loading screen Animation and custom text' }).click();
  await expect(editor(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Loading screen Animation and custom text' })).toBeVisible();
  await page.evaluate(() => { const state = (window as any).__loadingSettings; state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve()); });
  // The parent Settings page can finish its independent branding read. Leaving
  // the editor must still perform no save or resurrect the abandoned view.
  await expect.poll(async () => (await saved(page))?.brandText).toBe('Family cinema');
  expect(await page.evaluate(() => (window as any).__loadingSettings.writes)).toBe(0);
  await expect(editor(page)).toHaveCount(0);
});

test('a cached animation is immediate and slow loading preferences never block Home', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem(`jellyfin-cinema.loading-screen.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify(settings)),
    { ...defaultLoadingScreen(), animation: 'clapperboard', brandText: 'Cached cinema' });
  await transport(page, { hold: true, homeHold: true }); await page.clock.install();
  await page.goto('/?featured=0&layout=tv#/home');
  const loader = page.getByRole('status', { name: 'Loading Home', exact: true });
  await expect(loader).toHaveAttribute('data-animation', 'clapperboard');
  await expect(loader.locator('.tvl-home-loading-brand')).toHaveText('Cached cinema');
  await page.evaluate(() => (window as any).__loadingSettings.homePending.splice(0).forEach((resolve: (ids: string[]) => void) => resolve([])));
  await page.clock.runFor(800);
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(loader).toHaveCount(0);
  await page.evaluate(() => { const state = (window as any).__loadingSettings; state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve()); });
  await expect.poll(async () => (await saved(page))?.animation).toBe('jellyfin');
  await expect(loader).toHaveCount(0);
});

test('fresh account animation updates a visible loader without moving it inside the scrolling Home', async ({ page }) => {
  await transport(page, { homeHold: true }); await page.clock.install();
  await page.goto('/?featured=0&layout=tv#/home');
  const loader = page.getByRole('status', { name: 'Loading Home', exact: true });
  await expect(loader).toHaveAttribute('data-animation', 'jellyfin');
  await expect(loader.locator('.tvl-home-loading-brand')).toHaveText('Family cinema');
  expect(await loader.evaluate(node => node.parentElement === document.body)).toBe(true);
  await expect(loader).toHaveCSS('position', 'fixed');
  await page.evaluate(() => { location.hash = '/mypreferencesmenu'; });
  await expect(loader).toHaveCount(0);
});
