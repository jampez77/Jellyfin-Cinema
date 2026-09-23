import { expect, test, type Page } from '@playwright/test';

const collections = (page: Page) => page.getByRole('dialog', { name: 'Collections', exact: true });
const collection = (page: Page, name = 'Coastal Stories') => page.getByRole('dialog', { name: `${name} collection`, exact: true });

async function patchDemo(page: Page, source: string) {
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => { const api = window.TvItemLayoutDemo.api; ${source} })();` });
  });
}

test('legacy collections list opens a collection and member, restoring both chosen cards on Back', async ({ page }) => {
  const originalHash = '#/list?parentId=library-collections&serverId=test-server%2Fone';
  await page.goto(`/${originalHash}`);
  const list = collections(page);
  await expect(list.getByRole('button', { name: 'Coastal Stories', exact: true })).toBeFocused();
  await expect(page.locator('.mainAnimatedPage')).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(list.getByRole('button', { name: 'Into the Wilderness', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/details\?id=collection-wilderness&serverId=test-server%2Fone$/);
  const members = collection(page, 'Into the Wilderness');
  await expect(members.getByRole('heading', { name: 'Into the Wilderness', exact: true })).toBeVisible();
  await expect(members.getByRole('list', { name: 'Collection items' }).getByRole('button')).toHaveCount(3);
  await members.getByRole('button', { name: 'Where the Wild Things Wait', exact: true }).click();
  await expect(page).toHaveURL(/#\/details\?id=movie-wild&serverId=test-server%2Fone$/);
  await expect(page.getByRole('dialog', { name: 'Where the Wild Things Wait details', exact: true })).toBeVisible();
  await page.goBack();
  await expect(members.getByRole('button', { name: 'Where the Wild Things Wait', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(originalHash);
  await expect(list.getByRole('button', { name: 'Into the Wilderness', exact: true })).toBeFocused();
});

test('explicit BoxSet list routes load collections directly without probing a parent item', async ({ page }) => {
  await patchDemo(page, `
    api.getItem = async () => { document.body.dataset.unexpectedProbe = 'true'; throw new Error('No probe expected'); };
    const original = api.getCollectionList;
    api.getCollectionList = async parent => { document.body.dataset.collectionParent = parent || 'none'; return original(parent); };
  `);
  for (const [hash, parent] of [['#/boxsets?topParentId=library-collections', 'library-collections'], ['#/list?type=BoxSet', 'none']]) {
    await page.goto(`/${hash}`);
    await expect(collections(page).getByRole('list', { name: 'Collections' }).getByRole('button')).toHaveCount(2);
    await expect(page.locator('body')).toHaveAttribute('data-collection-parent', parent);
    await expect(page.locator('body')).not.toHaveAttribute('data-unexpected-probe');
  }
});

test('ordinary and filtered library lists retain Jellyfin native pages', async ({ page }) => {
  await page.clock.install();
  await patchDemo(page, `
    const original = api.getItem;
    api.getItem = async id => { document.body.dataset.metadataProbe = id; return original(id); };
    api.getCollectionList = async () => { document.body.dataset.unexpectedCollections = 'true'; return []; };
  `);
  await page.goto('/#/list?parentId=library-movies');
  await expect(page.locator('body')).toHaveAttribute('data-metadata-probe', 'library-movies');
  await page.clock.runFor(500);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-unexpected-collections');
  for (const hash of [
    '#/list?parentId=library-collections&genres=Drama', '#/list?parentId=library-collections&type=Movie',
    '#/boxsets?topParentId=library-collections&tab=1', '#/boxsets?topParentId=library-collections&genres=Drama'
  ]) {
    await page.goto(`/${hash}`);
    await page.clock.runFor(500);
    await expect(page.locator('#tv-layout')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-metadata-probe', 'library-movies');
    await expect(page.locator('body')).not.toHaveAttribute('data-unexpected-collections');
    await expect(page.locator('.demo-native-page')).not.toHaveAttribute('aria-hidden', 'true');
  }
});

test('empty collection lists and collections keep Back available without inventing items', async ({ page }) => {
  await page.goto('/?scenario=empty#/list?parentId=library-collections');
  await expect(collections(page).getByRole('heading', { name: 'No collections yet', exact: true })).toBeVisible();
  await expect(collections(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await expect(collections(page).locator('[data-collection-item]')).toHaveCount(0);
  await page.goto('/?scenario=empty#/details?id=collection-coast');
  await expect(collection(page).getByRole('heading', { name: 'This collection is empty', exact: true })).toBeVisible();
  await expect(collection(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await expect(collection(page).locator('[data-collection-item]')).toHaveCount(0);
});

test('collection list and member errors offer remote retry and focus the loaded results', async ({ page }) => {
  await patchDemo(page, `
    const list = api.getCollectionList, items = api.getCollectionItems;
    let failList = true, failItems = true;
    api.getCollectionList = async (...args) => { if (failList) { failList = false; throw new Error('offline'); } return list(...args); };
    api.getCollectionItems = async (...args) => { if (failItems) { failItems = false; throw new Error('offline'); } return items(...args); };
  `);
  await page.goto('/#/boxsets?topParentId=library-collections');
  await expect(collections(page).getByRole('heading', { name: 'Collections unavailable', exact: true })).toBeVisible();
  await expect(collections(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(collections(page).getByRole('button', { name: 'Coastal Stories', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(collection(page).getByRole('heading', { name: 'Collection unavailable', exact: true })).toBeVisible();
  await expect(collection(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(collection(page).getByRole('button', { name: 'After the Tide', exact: true })).toBeFocused();
  await expect(collection(page).getByRole('list', { name: 'Collection items' }).getByRole('button')).toHaveCount(2);
});

test('a delayed parent-type probe cannot replace the page navigated to meanwhile', async ({ page }) => {
  await patchDemo(page, `
    const original = api.getItem;
    api.getItem = async id => {
      if (id === 'library-collections') {
        document.body.dataset.probePending = 'true';
        await new Promise(resolve => document.addEventListener('release-collection-probe', resolve, { once: true }));
        const item = await original(id);
        document.dispatchEvent(new Event('collection-probe-settled'));
        return item;
      }
      return original(id);
    };
  `);
  await page.goto('/#/list?parentId=library-collections');
  await expect(page.locator('body')).toHaveAttribute('data-probe-pending', 'true');
  await page.evaluate(() => { location.hash = '/details?id=movie-tide'; });
  const movie = page.getByRole('dialog', { name: 'After the Tide details', exact: true });
  await expect(movie).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('collection-probe-settled', () => resolve(), { once: true });
    document.dispatchEvent(new Event('release-collection-probe'));
  }));
  await expect(movie).toBeVisible();
  await expect(collections(page)).toHaveCount(0);
  await expect(page.locator('#tv-layout')).toHaveCount(1);
});

test('leaving a collection while its members load discards the late results', async ({ page }) => {
  await patchDemo(page, `
    const original = api.getCollectionItems;
    api.getCollectionItems = async (...args) => {
      document.body.dataset.membersPending = 'true';
      await new Promise(resolve => document.addEventListener('release-collection-members', resolve, { once: true }));
      const items = await original(...args);
      document.dispatchEvent(new Event('collection-members-settled'));
      return items;
    };
  `);
  await page.goto('/#/details?id=collection-coast');
  await expect(page.locator('body')).toHaveAttribute('data-members-pending', 'true');
  await expect(collection(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await page.evaluate(() => { location.hash = '/home'; });
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('collection-members-settled', () => resolve(), { once: true });
    document.dispatchEvent(new Event('release-collection-members'));
  }));
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/tvl-open/);
  await expect(page.locator('.itemDetailPage')).not.toHaveAttribute('aria-hidden', 'true');
});

test('native viewshow opens a generic collections page and Movies tabchange returns to the native first tab on Back', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#/home');
  await page.clock.runFor(100);
  await page.evaluate(() => {
    const host = document.createElement('main');
    host.id = 'nativeCollections'; host.className = 'mainAnimatedPage';
    host.setAttribute('aria-hidden', 'false');
    const items = document.createElement('div'); items.className = 'itemsContainer'; items.dataset.parentid = 'library-collections';
    host.append(items); document.body.append(host);
    history.pushState(null, '', '#/list?parentId=library-collections');
    host.dispatchEvent(new Event('viewshow'));
  });
  await expect(collections(page).getByRole('button', { name: 'Coastal Stories', exact: true })).toBeFocused();
  await expect(page.locator('#nativeCollections')).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => {
    const host = document.createElement('main'); host.id = 'moviesPage'; host.setAttribute('aria-hidden', 'false');
    const movies = document.createElement('div'); movies.id = 'moviesTab'; movies.className = 'pageTabContent is-active';
    const sets = document.createElement('div'); sets.id = 'collectionsTab'; sets.className = 'pageTabContent';
    const tabs = document.createElement('div') as HTMLElement & { selectedIndex: (index: number) => void };
    tabs.className = 'tabs-viewmenubar';
    const firstTab = document.createElement('button'); firstTab.type = 'button'; firstTab.className = 'emby-tab-button';
    firstTab.dataset.index = '0'; firstTab.textContent = 'Native movies'; tabs.append(firstTab);
    tabs.selectedIndex = index => {
      tabs.dataset.selectedIndex = String(index);
      movies.classList.toggle('is-active', index === 0); sets.classList.toggle('is-active', index === 3);
      tabs.dispatchEvent(new Event('tabchange', { bubbles: true }));
    };
    host.append(tabs, movies, sets); document.body.append(host);
    history.pushState(null, '', '#/movies?topParentId=library-movies');
    host.dispatchEvent(new CustomEvent('viewshow', { detail: { params: { topParentId: 'library-movies' } } }));
  });
  await expect(collections(page)).toHaveCount(0);
  await expect(page.locator('#nativeCollections')).toHaveAttribute('aria-hidden', 'false');
  await page.evaluate(() => {
    const tabs = document.querySelector('.tabs-viewmenubar') as HTMLElement & { selectedIndex: (index: number) => void };
    tabs.selectedIndex(3);
  });
  await expect(collections(page).getByRole('button', { name: 'Coastal Stories', exact: true })).toBeFocused();
  await expect(page.locator('#moviesPage')).toHaveAttribute('aria-hidden', 'true');
  await collections(page).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(collections(page)).toHaveCount(0);
  await expect(page.locator('.tabs-viewmenubar')).toHaveAttribute('data-selected-index', '0');
  await expect(page.locator('#moviesTab')).toHaveClass(/is-active/);
  await expect(page.locator('#moviesPage')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('button', { name: 'Native movies', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/#\/movies\?topParentId=library-movies$/);
});
