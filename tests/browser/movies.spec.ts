import { expect, test, type Page } from '@playwright/test';

const baseRoute = '/#/movies?topParentId=library-movies';
const route = `${baseRoute}&tab=0`;
const movies = (page: Page) => page.getByRole('dialog', { name: 'Movies', exact: true });
const cards = (page: Page) => movies(page).locator('[data-movie-item]');
const search = (page: Page) => movies(page).getByRole('searchbox', { name: 'Search movies', exact: true });

test('Movies opens Suggestions first by default and preserves an explicit All movies choice', async ({ page }) => {
  await page.goto(baseRoute);
  const root = movies(page);
  await expect(root.locator('[data-library-tab]').first()).toHaveText('Suggestions');
  await expect(root.locator('.tvl-library-tabs > button')).toHaveText(['Suggestions','Favourites','Genres','Collections','All movies']);
  await expect(root.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByRole('region', { name: 'Continue watching', exact: true })).toBeVisible();
  await root.getByRole('button', { name: 'Collections', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(root.getByRole('button', { name: 'All movies', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await root.getByRole('button', { name: 'After the Tide', exact: true }).click();
  await page.getByRole('dialog', { name: 'After the Tide details', exact: true }).getByRole('button', {name:'Back', exact:true}).click();
  await expect(root.getByRole('button', { name: 'All movies', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(5);
});

async function patchDemo(page: Page, source: string) {
  await page.route('**/dist/demo.js', async request => {
    const response = await request.fetch();
    await request.fulfill({ response, body: `${await response.text()}\n(() => { const api = window.TvItemLayoutDemo.api; ${source} })();` });
  });
}

test('movie search keeps native caret and Backspace keys, submits with Enter or Search, and clears', async ({ page }) => {
  await page.goto(route);
  await expect(cards(page)).toHaveCount(5);
  await search(page).fill('TideX');
  await search(page).press('End');
  await search(page).press('Backspace');
  await expect(search(page)).toHaveValue('Tide');
  await search(page).press('ArrowLeft');
  await expect.poll(() => search(page).evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(3);
  await search(page).press('ArrowRight');
  await expect.poll(() => search(page).evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(4);
  await expect(page).toHaveURL(/#\/movies\?topParentId=library-movies&tab=0$/);
  await search(page).press('Enter');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-tide');
  await expect(search(page)).toBeFocused();
  await search(page).fill('Blue');
  await movies(page).getByRole('button', { name: 'Search', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-blue');
  await movies(page).getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search(page)).toHaveValue('');
  await expect(cards(page)).toHaveCount(5);
  await expect(search(page)).toBeFocused();
  await search(page).press('ArrowDown');
  await expect(search(page)).not.toBeFocused();
});

test('remote search commands edit the caret, submit once and leave the field on Down', async ({ page }) => {
  await patchDemo(page, `const original = api.getMovies; let searches = 0; api.getMovies = query => { if (query.search) document.body.dataset.searches = String(++searches); return original(query); };`);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(5);
  await search(page).fill('Tide');
  await search(page).press('End');
  const command = async (name: string) => search(page).evaluate((input, command) => input.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command } })), name);
  await command('left');
  await expect(search(page)).toBeFocused();
  await expect.poll(() => search(page).evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(3);
  await command('right');
  await expect.poll(() => search(page).evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(4);
  await command('select');
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-searches', '1');
  await search(page).fill('Blue');
  await command('enter');
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-blue');
  await expect(page.locator('body')).toHaveAttribute('data-searches', '2');
  await command('down');
  await expect(search(page)).not.toBeFocused();
});

test('movie navigation uses the active server unless its route already selects a server', async ({ page }) => {
  await patchDemo(page, `api.serverId = 'active-server';`);
  await page.goto(route);
  await movies(page).getByRole('button', { name: 'After the Tide', exact: true }).click();
  await expect(page).toHaveURL(/#\/details\?id=movie-tide&serverId=active-server$/);
  await page.goto(`${route}&serverId=explicit-server`);
  await movies(page).getByRole('button', { name: 'After the Tide', exact: true }).click();
  await expect(page).toHaveURL(/#\/details\?id=movie-tide&serverId=explicit-server$/);
});

test('A-Z and numbers filters send the selected letter within the current movie library', async ({ page }) => {
  await patchDemo(page, `
    const original = api.getMovies;
    api.getMovies = async query => {
      document.body.dataset.movieQuery = JSON.stringify(query);
      if (query.letter === '#') return { items: [{Id:'numeric', Type:'Movie', Name:'1917'}], total:1, nextStartIndex:1 };
      return original(query);
    };
  `);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(5);
  await movies(page).getByRole('navigation', { name: 'Browse by title' }).getByRole('button', { name: 'H', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-higher');
  await movies(page).getByRole('button', { name: '# — numbers and symbols', exact: true }).click();
  await expect(cards(page)).toHaveAttribute('aria-label', '1917');
  const query = await page.locator('body').getAttribute('data-movie-query');
  expect(JSON.parse(query!)).toMatchObject({ parentId: 'library-movies', letter: '#', startIndex: 0 });
  await movies(page).getByRole('navigation', { name: 'Browse by title' }).getByRole('button', { name: 'All', exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
});

test('Genres URL opens genre browsing and a selected genre filters the movie grid', async ({ page }) => {
  await page.goto(`${baseRoute}&tab=4`);
  const root = movies(page);
  await expect(root.getByRole('button', { name: 'Genres', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await root.getByRole('button', { name: 'Mystery', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'Mystery', exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-silence');
  await expect(cards(page)).toBeFocused();
  await root.getByRole('button', { name: 'All genres', exact: true }).click();
  await expect(root.getByRole('heading', { name: 'Browse genres', exact: true })).toBeVisible();
  await expect(root.getByRole('button', { name: 'Mystery', exact: true })).toBeVisible();
});

test('Suggestions URL shows recommendation sections and returns to the originating card from details', async ({ page }) => {
  await page.goto(`${baseRoute}&tab=1`);
  const root = movies(page);
  await expect(root.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const resume = root.getByRole('region', { name: 'Continue watching', exact: true }).getByRole('button', { name: 'After the Tide', exact: true });
  await expect(root.getByRole('region', { name: 'Recently added', exact: true }).locator('[data-movie-item]')).toHaveCount(5);
  await resume.click();
  await expect(page.getByRole('dialog', { name: 'After the Tide details', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(resume).toBeFocused();
  await expect(root.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Favourites refresh after a detail change and detail Back restores the chosen card', async ({ page }) => {
  await page.goto(`${baseRoute}&tab=2`);
  const root = movies(page);
  await expect(root.getByRole('button', { name: 'Favourites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(1);
  await cards(page).click();
  await page.getByRole('button', { name: 'Remove from favourites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add to favourites', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(root.getByRole('heading', { name: 'No favourites found', exact: true })).toBeVisible();
  await root.getByRole('button', { name: 'All movies', exact: true }).click();
  await root.getByRole('button', { name: 'After the Tide', exact: true }).click();
  await page.getByRole('button', { name: 'Add to favourites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(root.getByRole('button', { name: 'After the Tide', exact: true })).toBeFocused();
  await root.getByRole('button', { name: 'Favourites', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-tide');
});

test('Collections opens the styled list and Back preserves the movie search and entry focus', async ({ page }) => {
  await page.goto(`${route}&serverId=test-server%2Fone`);
  await search(page).fill('Tide');
  await search(page).press('Enter');
  await expect(cards(page)).toHaveCount(1);
  await movies(page).getByRole('button', { name: 'Collections', exact: true }).click();
  await expect(page).toHaveURL(/#\/movies\?.*tab=3/);
  const collections = page.getByRole('dialog', { name: 'Collections', exact: true });
  await expect(collections.getByRole('button', { name: 'Coastal Stories', exact: true })).toBeVisible();
  await collections.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search(page)).toHaveValue('Tide');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-tide');
  await expect(movies(page).getByRole('button', { name: 'Collections', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/serverId=test-server%2Fone$/);
});

test('a direct Movies Collections URL returns to All movies on Back', async ({ page }) => {
  await page.goto(`${baseRoute}&tab=3`);
  const collections = page.getByRole('dialog', { name: 'Collections', exact: true });
  await expect(collections.getByRole('button', { name: 'Coastal Stories', exact: true })).toBeFocused();
  await collections.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
  await expect(movies(page).getByRole('button', { name: 'All movies', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/#\/movies\?.*tab=0/);
});

test('pagination uses the raw cursor, retries without losing cards, and restores loaded depth and focus', async ({ page }) => {
  await patchDemo(page, `
    const originalItem = api.getItem;
    const item = index => ({ Id:'catalog-' + index, Type:'Movie', Name:'Catalog movie ' + index, ProductionYear:2025 });
    api.getItem = id => id.startsWith('catalog-') ? Promise.resolve(item(Number(id.slice(8)))) : originalItem(id);
    const starts = []; let failMore = true;
    api.getMovies = async query => {
      const start = query.startIndex || 0; starts.push(start); document.body.dataset.movieStarts = JSON.stringify(starts);
      if (start === 48 && failMore) { failMore = false; throw new Error('offline'); }
      const count = start === 0 ? 47 : start === 48 ? 48 : 1;
      return { items:Array.from({length:count}, (_, index) => item(start + index)), total:97, nextStartIndex:Math.min(97, start + 48) };
    };
  `);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(47);
  await movies(page).getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(cards(page)).toHaveCount(47);
  await expect(movies(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(95);
  await expect(movies(page).getByRole('button', { name: 'Catalog movie 48', exact: true })).toBeFocused();
  const lastCard = movies(page).getByRole('button', { name: 'Catalog movie 95', exact: true });
  await lastCard.scrollIntoViewIfNeeded(); await lastCard.focus();
  const previousScroll = await movies(page).locator('.tvl-content').evaluate(content => content.scrollTop);
  expect(previousScroll).toBeGreaterThan(0);
  await lastCard.click();
  await expect(page.getByRole('dialog', { name: 'Catalog movie 95 details', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cards(page)).toHaveCount(95);
  await expect(movies(page).getByRole('button', { name: 'Catalog movie 95', exact: true })).toBeFocused();
  await expect.poll(() => movies(page).locator('.tvl-content').evaluate(content => content.scrollTop)).toBeCloseTo(previousScroll, 0);
  await expect(page.locator('body')).toHaveAttribute('data-movie-starts', '[0,48,48,0,48]');
  await movies(page).getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(cards(page)).toHaveCount(96);
  await expect(page.locator('body')).toHaveAttribute('data-movie-starts', '[0,48,48,0,48,96]');
  await expect(movies(page).getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0);
});

test('movie load errors retry from the remote and an empty search can be cleared', async ({ page }) => {
  await patchDemo(page, `const original = api.getMovies; let first = true; api.getMovies = async query => { if (first) { first = false; throw new Error('offline'); } return original(query); };`);
  await page.goto(route);
  await expect(movies(page).getByRole('heading', { name: 'Movies unavailable', exact: true })).toBeVisible();
  await expect(movies(page).getByRole('button', { name: 'Try again', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(5);
  await search(page).fill('No matching movie');
  await search(page).press('Enter');
  await expect(movies(page).getByRole('heading', { name: 'No movies found', exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await movies(page).getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
});

test('late movie results cannot replace a newer search or a different page', async ({ page }) => {
  await patchDemo(page, `
    const original = api.getMovies;
    api.getMovies = async query => {
      if (['slow','depart'].includes(query.search)) {
        document.body.dataset.pendingSearch = query.search;
        await new Promise(resolve => document.addEventListener('release-' + query.search, resolve, { once:true }));
        const result = await original({ ...query, search:undefined });
        document.dispatchEvent(new Event('settled-' + query.search)); return result;
      }
      return original(query);
    };
  `);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(5);
  await search(page).fill('slow'); await search(page).press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-pending-search', 'slow');
  await search(page).fill('Tide'); await search(page).press('Enter');
  await expect(cards(page)).toHaveCount(1);
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('settled-slow', () => resolve(), { once:true }); document.dispatchEvent(new Event('release-slow'));
  }));
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-tide');
  await search(page).fill('depart'); await search(page).press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-pending-search', 'depart');
  await page.getByRole('navigation', { name: 'Preview media type' }).getByRole('link', { name: 'Live TV', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Live TV guide', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('settled-depart', () => resolve(), { once:true }); document.dispatchEvent(new Event('release-depart'));
  }));
  await expect(movies(page)).toHaveCount(0);
  await expect(page.locator('#tv-layout')).toHaveCount(1);
});

test('a completed filter request does not steal focus from a search field edited while it loads', async ({ page }) => {
  await patchDemo(page, `
    const original = api.getMovies;
    api.getMovies = async query => {
      if (query.letter === 'H') {
        document.body.dataset.pendingLetter = 'H';
        await new Promise(resolve => document.addEventListener('release-letter', resolve, { once:true }));
      }
      return original(query);
    };
  `);
  await page.goto(route);
  await expect(cards(page)).toHaveCount(5);
  await movies(page).getByRole('navigation', { name: 'Browse by title' }).getByRole('button', { name: 'H', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-pending-letter', 'H');
  await search(page).fill('still typing');
  await page.evaluate(() => { document.dispatchEvent(new Event('release-letter')); });
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toHaveAttribute('data-movie-item', 'movie-higher');
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('still typing');
});

test('movie libraries respect TV mode and activate from native pushState view events', async ({ page }) => {
  await page.clock.install();
  await patchDemo(page, `document.body.classList.remove('layout-tv');`);
  await page.goto(route);
  await page.clock.runFor(100);
  await expect(movies(page)).toHaveCount(0);
  await page.evaluate(() => { document.body.classList.add('layout-tv'); });
  await expect(cards(page)).toHaveCount(5);
  await page.evaluate(() => { location.hash = '/home'; });
  await expect(movies(page)).toHaveCount(0);
  await page.evaluate(() => {
    const host = document.createElement('main'); host.id = 'moviesPage'; host.setAttribute('aria-hidden', 'false'); document.body.append(host);
    history.pushState(null, '', '#/movies?topParentId=library-movies&tab=0');
    host.dispatchEvent(new CustomEvent('viewshow', { detail: { params: { topParentId: 'library-movies' } } }));
  });
  await expect(cards(page)).toHaveCount(5);
  await expect(page.locator('#moviesPage')).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => { document.body.classList.remove('layout-tv'); });
  await expect(movies(page)).toHaveCount(0);
  await expect(page.locator('#moviesPage')).toHaveAttribute('aria-hidden', 'false');
});
