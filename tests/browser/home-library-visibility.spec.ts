import { expect, test, type Page } from '@playwright/test';
import { parseHomeCollections } from '../../src/home-collection-settings';

const music = '7e64e319657a9516ec78490da03edccb';
const preroll = '6c63e838853847e4abcad56c2be4f895';
const movies = 'b918990112f341a59a50fc7e8e289d71';
const row = (page: Page, id: string) => page.locator(`#hss-${id}`);

async function fixture(page: Page, options: { layout?: 'tv' | 'desktop'; busy?: boolean; hold?: boolean } = {}) {
  const saved = parseHomeCollections({ version: 1, rows: [{ id: 'explicit', kind: 'items', title: 'Recently added in Music',
    collectionIds: ['collection-coast'], placement: 'end' }] });
  await page.clock.install();
  await page.addInitScript(saved => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify(saved)), saved);
  await page.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const api = window.TvItemLayoutDemo.api;
      const state = window.__libraryVisibility = {
        calls: 0, exclusions: ${JSON.stringify([music, preroll])}, fail: false, hold: ${!!options.hold}, pending: []
      };
      api.getHomeLibraryExclusions = async () => {
        state.calls++;
        const result = [...state.exclusions], fail = state.fail;
        if (state.hold) await new Promise(resolve => state.pending.push(resolve));
        if (fail) throw new Error('Temporary user settings failure');
        return result;
      };
      state.add = (id, libraryId, title, busy = false) => {
        const section = document.createElement('section');
        section.id = 'hss-' + id;
        section.className = 'verticalSection RecentlyAddedInLibrary-' + libraryId;
        section.style.order = '999';
        const heading = document.createElement('h2'); heading.className = 'sectionTitle'; heading.textContent = title;
        const items = document.createElement('div'); items.className = 'itemsContainer focuscontainer-x';
        if (busy) {
          items.setAttribute('aria-busy', 'true');
          items.fetchData = () => new Promise(() => {});
        } else {
          const button = document.createElement('button'); button.textContent = title + ' item'; items.append(button);
        }
        section.append(heading, items);
        document.querySelector('#homeTab .sections').append(section);
        return section;
      };
      // HSS emits Guid.ToString(), while Jellyfin's preference uses compact IDs.
      state.add('music', '7E64E319-657A-9516-EC78-490DA03EDCCB', 'Renamed albums library', ${!!options.busy});
      state.add('preroll', '${preroll}', 'Pre-Roll');
      state.add('movies', '${movies}', 'Recently added in Music');
      state.add('unknown', 'not-a-library-id', 'Recently added in Music');
    })();` });
  });
  await page.goto(`/?featured=0&layout=${options.layout || 'tv'}#/home`);
  if (!options.hold && !options.busy) await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
}

for (const layout of ['tv', 'desktop'] as const) test(`${layout} Home applies saved exclusions to HSS library IDs without changing My Media or selected collections`, async ({ page }) => {
  await fixture(page, { layout });
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(row(page, 'music')).toBeHidden();
  await expect(row(page, 'preroll')).toBeHidden();
  await expect(row(page, 'movies')).toBeVisible();
  await expect(row(page, 'unknown')).toBeVisible();
  await expect(page.locator('#homeTab [aria-label="My Media"]').getByRole('button', { name: 'Music', exact: true })).toBeVisible();
  await expect(page.locator('#homeTab [data-home-row="explicit"] .tvl-home-row-card')).toHaveCount(2);
  await expect(page.locator('#homeTab [data-home-row="explicit"]')).toBeVisible();
  expect(await row(page, 'music').evaluate(element => element.getBoundingClientRect().height)).toBe(0);
});

test('the initial Home reveal waits for saved library preferences instead of flashing excluded rows', async ({ page }) => {
  await fixture(page, { hold: true });
  await expect.poll(() => page.evaluate(() => (window as any).__libraryVisibility.pending.length)).toBeGreaterThan(0);
  await expect(page.locator('#homeTab')).toHaveClass(/tvl-home-initial-loading/);
  await expect(row(page, 'music')).toBeHidden();
  await page.evaluate(() => {
    const state = (window as any).__libraryVisibility;
    state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve());
  });
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(row(page, 'music')).toBeHidden();
  await expect(row(page, 'movies')).toBeVisible();
});

test('late HSS rows follow exclusions, and re-enabling preserves the owner’s hidden state and styling', async ({ page }) => {
  await fixture(page);
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  await page.evaluate(music => {
    const state = (window as any).__libraryVisibility;
    state.add('late-music', music, 'A later translated heading');
    const original = document.querySelector<HTMLElement>('#hss-music')!;
    original.classList.add('hide'); original.hidden = true; original.style.opacity = '0.4';
    // Native item refresh only removes its own .hide class. The exclusion survives.
    document.querySelector('#hss-preroll')!.classList.remove('hide');
  }, music);
  await expect(row(page, 'late-music')).toBeHidden();
  await expect(row(page, 'preroll')).toBeHidden();
  await page.evaluate(() => {
    (window as any).__libraryVisibility.exclusions = [];
    window.dispatchEvent(new Event('focus'));
  });
  await expect(row(page, 'late-music')).toBeVisible();
  await expect(row(page, 'preroll')).toBeVisible();
  await expect(row(page, 'music')).not.toHaveClass(/tvl-home-library-excluded/);
  await expect(row(page, 'music')).toHaveClass(/hide/);
  await expect(row(page, 'music')).toHaveAttribute('hidden', '');
  await expect(row(page, 'music')).toHaveCSS('opacity', '0.4');
  await expect(row(page, 'music')).toBeHidden();
});

test('a failed preference refresh keeps exclusions until a successful saved-preference read', async ({ page }) => {
  await fixture(page);
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  const previous = await page.evaluate(() => (window as any).__libraryVisibility.calls);
  await page.evaluate(() => {
    const state = (window as any).__libraryVisibility;
    state.exclusions = []; state.fail = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__libraryVisibility.calls)).toBeGreaterThan(previous);
  await expect(row(page, 'music')).toBeHidden();
  await page.evaluate(() => {
    (window as any).__libraryVisibility.fail = false;
    document.querySelector('#indexPage')!.dispatchEvent(new Event('viewshow', { bubbles: true }));
  });
  await expect(row(page, 'music')).toBeVisible();
});

test('excluding the focused library moves focus to the following visible row', async ({ page }) => {
  await fixture(page);
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  await page.evaluate(() => {
    (window as any).__libraryVisibility.exclusions = [];
    window.dispatchEvent(new Event('focus'));
  });
  await expect(row(page, 'music')).toBeVisible();
  await row(page, 'music').getByRole('button').focus();
  await page.evaluate(exclusions => {
    (window as any).__libraryVisibility.exclusions = exclusions;
    window.dispatchEvent(new Event('focus'));
  }, [music, preroll]);
  await expect(row(page, 'music')).toBeHidden();
  await expect(row(page, 'preroll')).toBeHidden();
  await expect(row(page, 'movies').getByRole('button')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'unknown').getByRole('button')).toBeFocused();
});

test('a preference change during an older read queues a fresh read instead of waiting for polling', async ({ page }) => {
  await fixture(page);
  const previous = await page.evaluate(() => (window as any).__libraryVisibility.calls);
  await page.evaluate(() => {
    const state = (window as any).__libraryVisibility;
    state.exclusions = []; state.hold = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__libraryVisibility.pending.length)).toBe(1);
  await page.evaluate(preroll => {
    const state = (window as any).__libraryVisibility;
    state.exclusions = [preroll];
    window.dispatchEvent(new Event('focus'));
    state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve());
  }, preroll);
  await expect.poll(() => page.evaluate(() => (window as any).__libraryVisibility.calls)).toBe(previous + 2);
  await expect(row(page, 'music')).toBeVisible();
  await expect(row(page, 'preroll')).toBeHidden();
});

test('a warm return uses the account’s saved exclusions while a fresh read is pending', async ({ page }) => {
  await fixture(page);
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  await page.locator('#homeTab [aria-label="Continue watching"]').getByRole('button', { name: 'After the Tide', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'After the Tide details' })).toBeVisible();
  await page.evaluate(() => { (window as any).__libraryVisibility.hold = true; });
  await page.keyboard.press('Escape');
  await expect(page.locator('#homeTab')).toBeVisible();
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  await expect(row(page, 'movies')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__libraryVisibility.pending.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = (window as any).__libraryVisibility;
    state.hold = false; state.pending.splice(0).forEach((resolve: () => void) => resolve());
  });
  await expect(row(page, 'music')).toBeHidden();
});

test('an outgoing account’s delayed preference response cannot hide the new account’s library', async ({ page }) => {
  await fixture(page);
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  await page.evaluate(() => {
    const state = (window as any).__libraryVisibility;
    state.hold = true; window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__libraryVisibility.pending.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = (window as any).__libraryVisibility;
    state.hold = false; state.exclusions = [];
    window.TvItemLayoutDemo!.api.userId = 'another-profile';
    window.TvItemLayout!.refresh();
  });
  await expect(row(page, 'music')).toBeVisible();
  await page.evaluate(() => (window as any).__libraryVisibility.pending.splice(0).forEach((resolve: () => void) => resolve()));
  await expect(row(page, 'music')).toBeVisible();
  await expect(row(page, 'music')).not.toHaveClass(/tvl-home-library-excluded/);
});

test('an excluded HSS row still fetching items does not delay the Home reveal', async ({ page }) => {
  await fixture(page, { busy: true });
  // The hidden library deliberately never finishes. Normal Home should reveal
  // before the 3.5-second failure deadline without drawing an empty row.
  await expect(row(page, 'music')).toHaveClass(/tvl-home-library-excluded/);
  await page.clock.runFor(800);
  await expect(page.locator('#homeTab')).not.toHaveClass(/tvl-home-initial-loading/);
  await expect(row(page, 'music')).toBeHidden();
  await expect(row(page, 'movies')).toBeVisible();
});
