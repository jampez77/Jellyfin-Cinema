import { expect, test, type Page } from '@playwright/test';

const collection = 'collection-coast';
const plain = (id: string, title: string, placement: string) => ({ id, title, placement, kind: 'items', collectionIds: [collection], ranked: true });
const settings = { version: 1, rows: [
  plain('trending-movies', 'Trending Movies', 'native:latest in movies:1'),
  plain('trending-shows', 'Trending Shows', 'end'),
  ...Array.from({ length: 6 }, (_, index) => ({ ...plain(`platform-${index}`, `Platform ${index + 1}`, 'end'), tabs: [
    { id: 'movies', label: 'Movies', collectionId: collection, itemSort: 'collection', itemOrder: [] },
    { id: 'shows', label: 'Shows', collectionId: 'collection-wilderness', itemSort: 'collection', itemOrder: [] }
  ] }))
] };

async function setupOrderedHome(page: Page, initialSettings = settings) {
  await page.addInitScript(settings => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify(settings)), initialSettings);
  await page.goto('/?featured=0&homeSections=smalllibrarytiles,resume,nextup,livetv,latestmedia#/home');
  await expect(page.locator('[data-home-row="platform-5"] .tvl-home-row-card')).toHaveCount(2);
  await page.evaluate(() => {
    // HomeScreen Sections renders the native rows as ordered flex siblings.
    // Preserve the demo's native nodes/listeners but reproduce that live layout.
    const host = document.querySelector<HTMLElement>('#homeTab .homeSectionsContainer')!;
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.verticalSection'));
    host.style.display = 'flex'; host.style.flexDirection = 'column';
    rows.forEach((row, index) => { row.style.order = String(index); });
    host.replaceChildren(...rows);

    // Jellyfin's native vertical fallback follows screen geometry. The demo's
    // default handler follows DOM order, which would mask the reported loop.
    const navigate = (direction: string) => {
      const active = document.activeElement as HTMLElement;
      const group = active.closest<HTMLElement>('.focuscontainer-x');
      if (!group || !group.closest('#homeTab')) return;
      const top = group.getBoundingClientRect().top;
      const groups = Array.from(document.querySelectorAll<HTMLElement>('#homeTab .focuscontainer-x'))
        .filter(node => node.offsetHeight && !!node.querySelector('button:not([tabindex="-1"]),a[href]'))
        .filter(node => direction === 'up' ? node.getBoundingClientRect().top < top - 1 : node.getBoundingClientRect().top > top + 1)
        .sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top));
      const target = groups[0]?.querySelector<HTMLElement>('button:not([tabindex="-1"]),a[href]');
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation(); navigate(event.key === 'ArrowUp' ? 'up' : 'down');
    }, true);
    document.addEventListener('command', event => {
      const direction = (event as CustomEvent).detail?.command;
      if (!['up', 'down'].includes(direction)) return;
      event.preventDefault(); event.stopImmediatePropagation(); navigate(direction);
    }, true);
    (window as any).__homeActivations = 0;
    document.querySelector('#homeTab')!.addEventListener('click', () => { (window as any).__homeActivations++; });
  });
  await expect(page.locator('.homeSectionsContainer > [data-home-row="trending-movies"]')).toHaveCount(1);
}

for (const input of ['keyboard', 'command']) {
  test(`sequential ${input} Up crosses six ranked platform rows and CSS-ordered native Home without looping`, async ({ page }) => {
    await setupOrderedHome(page);
    const groups = page.locator('#homeTab .focuscontainer-x');
    // DOM insertion is the configured order. Both the visual order and native
    // spatial navigation must agree with it when a plugin supplies CSS order.
    const expected = await groups.evaluateAll(nodes => nodes.map((node, index) => {
      node.setAttribute('data-nav-test', String(index));
      return String(index);
    }).reverse());
    const tops = await groups.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await groups.last().locator('button').first().focus();
    for (const id of expected) {
      await expect(page.locator(`[data-nav-test="${id}"]`).locator('button,a[href]').first()).toBeFocused();
      if (input === 'keyboard') await page.keyboard.press('ArrowUp');
      else await page.evaluate(() => document.activeElement!.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command: 'up' } })));
    }
    await expect(page.locator('#homeTab [aria-label="My Media"] button').first()).toBeFocused();
    expect(await page.evaluate(() => (window as any).__homeActivations)).toBe(0);
    await expect(page.locator('#homeTab .tvl-home-source-tab[aria-selected="true"]')).toHaveText(Array(6).fill('Movies'));
  });
}

test('navigation follows visual native order and moving an anchor keeps its collection row beside it', async ({ page }) => {
  await setupOrderedHome(page);
  const trending = page.locator('[data-home-row="trending-movies"]');
  const nextUp = page.locator('#homeTab [aria-label="Next up"]');
  const latest = page.locator('#homeTab [aria-label="Latest in Movies"]');
  await page.locator('#homeTab .verticalSection[aria-label="Live TV"]').evaluate(node => { (node as HTMLElement).style.order = '20'; });
  await trending.locator('button').first().focus(); await page.keyboard.press('ArrowUp');
  await expect(nextUp.locator('button').first()).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(trending.locator('button').first()).toBeFocused();
  await latest.evaluate(node => { (node as HTMLElement).style.order = '-1'; });
  await expect(trending).toHaveCSS('order', '-1');
  const visibleOrder = await page.locator('.homeSectionsContainer > section').evaluateAll(nodes => [...nodes]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(node => node.getAttribute('aria-label')));
  expect(visibleOrder.slice(0, 3)).toEqual(['Trending Movies', 'Latest in Movies', 'My Media']);
  const anchors = await page.evaluate(() => JSON.parse(localStorage.getItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo:positions`)!));
  expect(anchors[0].key).toBe('native:latest in movies:1');
  await trending.locator('button').first().focus(); await page.keyboard.press('ArrowDown');
  await expect(latest.locator('button').first()).toBeFocused();
});

test('CSS-hidden variants and shared first-row anchors settle without continuous reattachment', async ({ page }) => {
  await setupOrderedHome(page, { ...settings, rows: [
    plain('first', 'First collection', 'start'), plain('same', 'Before media', 'native:my media:1'), ...settings.rows
  ] });
  const firstRows = await page.locator('.homeSectionsContainer > section').evaluateAll(nodes => [...nodes]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).slice(0, 3).map(node => node.getAttribute('aria-label')));
  expect(firstRows).toEqual(['First collection', 'Before media', 'My Media']);
  await page.evaluate(() => {
    const media = document.querySelector('#homeTab [aria-label="My Media"]')!;
    const hidden = media.cloneNode(true) as HTMLElement;
    hidden.style.display = 'none'; hidden.style.order = '2147000000';
    media.after(hidden);
  });
  await expect.poll(() => page.evaluate(() => {
    const anchors = JSON.parse(localStorage.getItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo:positions`)!);
    return anchors.filter((anchor: { key: string }) => anchor.key.startsWith('native:my media:')).map((anchor: { key: string }) => anchor.key);
  })).toEqual(['native:my media:1']);
  expect(await page.evaluate(async () => {
    let changes = 0;
    const observer = new MutationObserver(records => { changes += records.length; });
    observer.observe(document.querySelector('#homeTab')!, { childList: true, attributes: true, subtree: true });
    const marker = document.createElement('span'); document.body.append(marker); marker.remove();
    for (let i = 0; i < 6; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    observer.disconnect(); return changes;
  })).toBe(0);
});
