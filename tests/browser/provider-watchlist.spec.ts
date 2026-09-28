import { expect, test, type Page } from '@playwright/test';
import { defaultProviderHomes } from '../../src/provider-settings';

const editor = (page: Page) => page.locator('.tvl-provider-settings');
const home = (page: Page) => page.locator('.tvl-provider-home');
const rows = (page: Page) => home(page).locator('[data-provider-row="watchlist"]');
const movie = { Id: 'movie-tide', Type: 'Movie', Name: 'After the Tide', ProductionYear: 2025 };
const show = { Id: 'series-north', Type: 'Series', Name: 'North of Nowhere', ProductionYear: 2024 };

async function fixture(page: Page, options: { withRow?: boolean; hold?: boolean } = {}) {
  const settings = defaultProviderHomes();
  settings.providers = [settings.providers[0]]; settings.providers[0].hero = false;
  settings.providers[0].rows = options.withRow ? [{ id: 'watchlist', title: '', source: 'watchlist', collectionId: '', itemSort: 'title', enabled: true, ranked: false }] : [];
  await page.addInitScript(settings => {
    const key = `jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
  }, settings);
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      window.TvItemLayoutDemo.api.serverId=location.origin; window.TvItemLayoutDemo.api.userId='demo';
      const state = window.__providerWatchlist = { items:${JSON.stringify([movie, show])}, calls:[], previews:[], hold:${!!options.hold}, pending:[], release(){this.hold=false;this.pending.splice(0).forEach(resolve=>resolve());} };
      const result=items=>({Items:items,TotalRecordCount:items.length,Pending:0,Total:items.length,UpdatedAt:null,Status:'ready',Region:'GB'});
      window.TvItemLayoutDemo.api.getProviderItems=async(provider,query)=>{
        state.calls.push({provider,query}); const items=structuredClone(state.items);
        if(state.hold) await new Promise(resolve=>state.pending.push(resolve)); return result(items);
      };
      window.TvItemLayoutDemo.api.previewProviderItems=async(provider,query)=>{state.previews.push({provider,query});return result(structuredClone(state.items));};
    })();` });
  });
}

test('a service Watchlist row is optional, previews films and shows together, and saves without a collection', async ({ page }) => {
  await fixture(page);
  await page.goto('/?featured=0&layout=desktop#/mypreferencesmenu?cinemaProviders=1');
  await expect(editor(page).getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await editor(page).locator('.tvl-provider-settings-sidebar').getByRole('button', { name: 'Netflix', exact: true }).click();
  await expect(editor(page).locator('.tvl-provider-row-choice')).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Add Watchlist row', exact: true }).click();
  await expect(editor(page).getByRole('combobox', { name: 'Content', exact: true })).toHaveValue('watchlist');
  await expect(editor(page).getByLabel('Row title', { exact: true })).toHaveValue('Watchlist');
  await expect(editor(page).getByRole('combobox', { name: 'Collection override', exact: true })).toHaveCount(0);
  await expect(editor(page).getByRole('combobox', { name: 'Collection', exact: true })).toHaveCount(0);
  const preview = editor(page).getByRole('complementary', { name: 'Provider Home row preview', exact: true });
  await expect(preview.locator('.tvl-home-row-caption')).toHaveText(['After the Tide', 'North of Nowhere']);
  const query = await page.evaluate(() => (window as any).__providerWatchlist.previews.at(-1).query);
  expect(query).toMatchObject({ type: 'Mixed', watchlist: true, sort: 'title' });
  await editor(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(`jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`)!));
  expect(saved.providers[0].rows).toEqual([expect.objectContaining({ title: 'Watchlist', source: 'watchlist', collectionId: '', enabled: true })]);
  await page.evaluate(() => { location.hash = '/home?cinemaProvider=netflix'; });
  await expect(home(page).getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
  await expect(home(page).locator('.tvl-home-row-caption')).toHaveText(['After the Tide', 'North of Nowhere']);
  await home(page).getByRole('button', { name: 'North of Nowhere', exact: true }).click();
  await expect(page).toHaveURL(/#\/details\?id=series-north/);
});

test('changing a collection row to Watchlist clears its collection and offers service filtering', async ({ page }) => {
  await fixture(page);
  await page.goto('/?featured=0&layout=desktop#/mypreferencesmenu?cinemaProviders=1');
  await expect(editor(page).getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await editor(page).locator('.tvl-provider-settings-sidebar').getByRole('button', { name: 'Netflix', exact: true }).click();
  await editor(page).getByRole('combobox', { name: 'Collection', exact: true }).selectOption('collection-coast');
  await expect(editor(page).getByRole('combobox', { name: 'Content', exact: true })).toHaveValue('collection');
  await editor(page).getByRole('combobox', { name: 'Content', exact: true }).selectOption('watchlist');
  await expect(editor(page).getByRole('combobox', { name: 'Collection', exact: true })).toHaveCount(0);
  await expect(editor(page)).toContainText('Films and TV shows saved to your Watchlist appear together when they are available with this service in the UK.');
  await editor(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(`jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`)!));
  expect(saved.providers[0].rows[0]).toMatchObject({ source: 'watchlist', collectionId: '' });
});

test('service Watchlist changes refresh after an older read, keep focus, and ignore other accounts', async ({ page }) => {
  await fixture(page, { withRow: true, hold: true });
  await page.goto('/?featured=0&layout=tv#/home?cinemaProvider=netflix');
  await expect.poll(() => page.evaluate(() => (window as any).__providerWatchlist.calls.length)).toBe(1);
  await page.evaluate(show => {
    (window as any).__providerWatchlist.items = [show];
    window.dispatchEvent(new CustomEvent('tvl-watchlist-change', { detail: { serverId: location.origin, userId: 'demo' } }));
    (window as any).__providerWatchlist.release();
  }, show);
  await expect(rows(page).locator('.tvl-home-row-caption')).toHaveText(['North of Nowhere']);
  await expect.poll(() => page.evaluate(() => (window as any).__providerWatchlist.calls.length)).toBe(2);
  const selected = rows(page).getByRole('button', { name: 'North of Nowhere', exact: true });
  await selected.focus();
  await page.evaluate(movie => {
    (window as any).__providerWatchlist.items.push(movie);
    window.dispatchEvent(new CustomEvent('tvl-watchlist-change', { detail: { serverId: location.origin, userId: 'another-user' } }));
  }, movie);
  await expect(selected).toBeFocused();
  expect(await page.evaluate(() => (window as any).__providerWatchlist.calls.length)).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('tvl-watchlist-change', { detail: { serverId: location.origin, userId: 'demo' } })));
  await expect(rows(page).locator('.tvl-home-row-caption')).toHaveText(['North of Nowhere', 'After the Tide']);
  await expect(selected).toBeFocused();
  await page.evaluate(() => {
    (window as any).__providerWatchlist.items = [];
    window.dispatchEvent(new CustomEvent('tvl-watchlist-change', { detail: { serverId: location.origin, userId: 'demo' } }));
  });
  await expect(rows(page)).toContainText('No films or TV shows in your Watchlist match this service yet.');
  await expect(rows(page).getByRole('button', { name: 'View all Watchlist', exact: true })).toBeFocused();
});
