import { expect, test, type Page } from '@playwright/test';
import { parseHomeCollections } from '../../src/home-collection-settings';

const settings = parseHomeCollections({ version: 1, rows: [{ id: 'platform', kind: 'items', title: 'Weekend picks', collectionIds: ['collection-coast'], ranked: true, placement: 'start',
  tabs: [{ id: 'movies', label: 'Movies', collectionId: 'collection-coast' }, { id: 'shows', label: 'Shows', collectionId: 'collection-wilderness' }] }] });
const row = (page: Page) => page.locator('#homeTab [data-home-row="platform"]');
const showsCard = (page: Page) => row(page).locator('.tvl-home-row-card[data-item-id="series-north"]');

async function fixture(page: Page, placement = 'start', overflow = false) {
  const saved = parseHomeCollections({ ...settings, rows: settings.rows.map(row => ({ ...row, placement, tabs: overflow ? undefined : row.tabs })) });
  await page.clock.install();
  await page.addInitScript(saved => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify(saved)), saved);
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api = window.TvItemLayoutDemo.api, list = api.getCollectionList, members = api.getCollectionItems;
      const state = window.__rowRefresh = { settings: ${JSON.stringify(saved)}, loads: 0, lists: 0 };
      api.homeCollections = {isCurrent:()=>true, load:async()=>({Revision:String(++state.loads),Settings:state.settings}), save:async()=>{throw new Error('Unexpected save')}};
      api.getCollectionList = async () => {
        if(state.holdList) await new Promise(resolve => {state.releaseList=()=>{state.holdList=false;resolve();};});
        state.lists++;
        if(state.failList) throw new Error('Collection list temporarily unavailable');
        return [...await list(), {Id:'collection-refresh',Type:'BoxSet',Name:'New picks'}];
      };
      api.getCollectionItems = async id => {
        if(id==='collection-refresh' && state.holdNew) await new Promise(resolve => {state.releaseNew=()=>{state.holdNew=false;resolve();};});
        if(id==='collection-wilderness' && state.holdShows) await new Promise(resolve => {state.releaseShows=()=>{state.holdShows=false;resolve();};});
        if(${overflow} && id==='collection-coast') return Array.from({length:61},(_,index)=>({Id:'overflow-'+index,Type:'Movie',Name:'Film '+(index+1)}));
        return members(id==='collection-refresh'?'collection-coast':id);
      };
    })();` });
  });
  await page.goto('/?featured=0#/home');
  await expect(row(page).locator('.tvl-home-row-card')).toHaveCount(overflow ? 60 : 2);
  await expect.poll(() => page.evaluate(() => (window as any).__rowRefresh.loads)).toBe(1);
}

async function beginRefresh(page: Page, hold: 'list' | 'members', holdShows = false) {
  await row(page).locator('.tvl-home-row-card').first().focus();
  await page.evaluate(({ hold, holdShows }) => {
    const state = (window as any).__rowRefresh;
    state.original = document.querySelector('[data-home-row="platform"]');
    state.holdList = hold === 'list'; state.holdNew = hold === 'members'; state.holdShows = holdShows;
    state.settings = { ...state.settings, rows: [
      { ...state.settings.rows[0], title: 'Updated weekend picks' },
      { id: 'new', kind: 'items', title: 'Newly saved row', collectionIds: ['collection-refresh'], ranked: false, placement: 'end', itemSort: 'collection', itemOrder: [] },
    ] };
  }, { hold, holdShows });
  await page.clock.fastForward(5_100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(hold => typeof (window as any).__rowRefresh[hold === 'list' ? 'releaseList' : 'releaseNew'], hold)).toBe('function');
  await expect(row(page)).toHaveAttribute('aria-label', 'Weekend picks');
  expect(await row(page).evaluate(node => node === (window as any).__rowRefresh.original)).toBe(true);
}

async function chooseShows(page: Page) {
  const tab = row(page).getByRole('tab', { name: 'Shows', exact: true });
  await tab.focus(); await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return tab;
}

async function expectUpdated(page: Page) {
  await expect(row(page)).toHaveAttribute('aria-label', 'Updated weekend picks');
  await expect(page.locator('#homeTab [data-home-row="new"]')).toHaveAttribute('aria-label', 'Newly saved row');
  await expect(row(page).getByRole('tab', { name: 'Shows', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(showsCard(page)).toBeVisible();
}

for (const hold of ['list', 'members'] as const) test(`refresh retains a newly selected Shows card while ${hold === 'list' ? 'the collection list' : 'another replacement row'} is loading`, async ({ page }) => {
  await fixture(page); await beginRefresh(page, hold); await chooseShows(page);
  await expect(showsCard(page)).toBeVisible(); await page.keyboard.press('ArrowDown');
  await expect(showsCard(page)).toBeFocused();
  await page.evaluate(hold => (window as any).__rowRefresh[hold === 'list' ? 'releaseList' : 'releaseNew'](), hold);
  await expectUpdated(page); await expect(showsCard(page)).toBeFocused();
});

test('refresh keeps the selected source tab mounted until its newly requested items are ready and restores tab focus', async ({ page }) => {
  await fixture(page); await beginRefresh(page, 'list', true);
  const tab = await chooseShows(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__rowRefresh.releaseShows)).toBe('function');
  await page.evaluate(() => (window as any).__rowRefresh.releaseList());
  await expect.poll(() => page.evaluate(() => (window as any).__rowRefresh.lists)).toBe(2);
  // Let the replacement finish every already-available source. The pending
  // Shows request must not cause the interactive old row to be detached.
  await page.clock.runFor(200);
  await expect(row(page)).toHaveAttribute('aria-label', 'Weekend picks');
  expect(await row(page).evaluate(node => node === (window as any).__rowRefresh.original)).toBe(true);
  await expect(tab).toBeFocused();
  await page.evaluate(() => (window as any).__rowRefresh.releaseShows());
  await expectUpdated(page); await expect(tab).toBeFocused();
});

test('failed background list refresh preserves the focused retained row at the end of Home', async ({ page }) => {
  await fixture(page, 'end'); await beginRefresh(page, 'list');
  const selected = row(page).locator('.tvl-home-row-card').first();
  await expect(selected).toBeFocused();
  await page.evaluate(() => { const state = (window as any).__rowRefresh; state.failList = true; state.releaseList(); });
  await expect(page.getByRole('button', { name: 'Retry collection rows', exact: true })).toBeVisible();
  await expect(row(page)).toHaveAttribute('aria-label', 'Weekend picks');
  expect(await row(page).evaluate(node => node === (window as any).__rowRefresh.original)).toBe(true);
  await expect(selected).toBeFocused();
});

test('refresh leaves focus on a usable row control when View full collection has no item focus identifier', async ({ page }) => {
  await fixture(page, 'start', true); await beginRefresh(page, 'list');
  const full = row(page).getByRole('button', { name: 'View full collection', exact: true });
  await expect(row(page).getByRole('tablist')).toHaveCount(0);
  expect(await full.getAttribute('data-focus-id')).toBeNull();
  await full.focus(); await expect(full).toBeFocused();
  await page.evaluate(() => (window as any).__rowRefresh.releaseList());
  await expect(row(page)).toHaveAttribute('aria-label', 'Updated weekend picks');
  await expect(row(page).locator('.tvl-home-row-card')).toHaveCount(60);
  await expect(full).toBeVisible();
  await expect.poll(() => row(page).evaluate(node => {
    const active = document.activeElement;
    return !!active && node.contains(active) && active.matches('button:not(:disabled),a[href]');
  })).toBe(true);
});
