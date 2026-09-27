import { expect, test, type Page } from '@playwright/test';
import { defaultProviderConfig, defaultProviderHomes, type ProviderHomesSettings } from '../../src/provider-settings';

const editor = (page: Page) => page.locator('.tvl-provider-settings');
const sidebar = (page: Page) => editor(page).locator('.tvl-provider-settings-sidebar');
const homePreview = (page: Page) => editor(page).getByRole('complementary', { name: 'Home services row preview', exact: true });
const servicePreview = (page: Page) => editor(page).getByRole('complementary', { name: 'Service tile preview', exact: true });
async function setup(page: Page, layout = 'desktop') {
  await page.addInitScript(settings => {
    const key = `jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
  }, defaultProviderHomes());
  await page.goto(`/?featured=0&layout=${layout}#/mypreferencesmenu?cinemaProviders=1`);
  await expect(editor(page).getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
}
async function saved(page: Page): Promise<ProviderHomesSettings> {
  return page.evaluate(() => JSON.parse(localStorage.getItem(`jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`)!));
}
async function save(page: Page) {
  await editor(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
}
async function sourceOptions(page: Page) {
  const details = editor(page).locator('.tvl-provider-advanced');
  if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator('summary').click();
}

test('custom services save collection rows, artwork and ranking and open their own Home after reload', async ({ page }, info) => {
  await setup(page); await sidebar(page).getByRole('button', { name: 'Add service', exact: true }).click();
  await expect(editor(page).getByLabel('Service name', { exact: true })).toHaveValue('New service');
  await expect(editor(page)).toContainText('This provider page has no rows.');
  await editor(page).getByLabel('Service name', { exact: true }).fill('Family cinema');
  const image = new URL('/demo/assets/forest.jpg', page.url()).href;
  await editor(page).getByLabel('Logo URL', { exact: true }).fill(image);
  await editor(page).getByLabel('Accent colour', { exact: true }).fill('#aabbcc');
  await expect(sidebar(page).getByRole('button', { name: 'Family cinema', exact: true })).toBeVisible();
  await expect(servicePreview(page).getByRole('button', { name: 'Family cinema', exact: true })).toBeVisible();
  await editor(page).getByRole('button', { name: 'Add row', exact: true }).click();
  await expect(editor(page).getByRole('combobox', { name: 'Content', exact: true })).toHaveValue('collection');
  await editor(page).getByRole('combobox', { name: 'Collection', exact: true }).selectOption('collection-coast');
  await editor(page).getByLabel('Row title', { exact: true }).fill('Family films');
  await editor(page).getByRole('combobox', { name: 'Item order', exact: true }).selectOption('title');
  await editor(page).getByLabel('Show rank artwork', { exact: true }).check();
  await save(page); const stored = (await saved(page)).providers.find(provider => provider.name === 'Family cinema')!;
  expect(stored).toMatchObject({ logoUrl: image, accent: '#aabbcc', movieProviderIds: [], showProviderIds: [], rows: [{ title: 'Family films', source: 'collection', collectionId: 'collection-coast', ranked: true, itemSort: 'title' }] });
  await page.reload(); await sidebar(page).getByRole('button', { name: 'Family cinema', exact: true }).click();
  await expect(editor(page).getByLabel('Logo URL', { exact: true })).toHaveValue(image);
  await page.screenshot({ path: info.outputPath('custom-service-editor.png') });
  await page.evaluate(() => { location.hash = '/home'; });
  await page.locator('#homeTab .tvl-home-provider-row').getByRole('button', { name: 'Family cinema', exact: true }).click();
  const home = page.getByRole('dialog', { name: 'Family cinema home', exact: true });
  await expect(home).toBeVisible(); await expect(home.getByRole('heading', { name: 'Family films', exact: true })).toBeVisible();
  await expect(home.locator('.tvl-home-row-card').first()).toHaveAttribute('aria-label', 'Rank 1: A Kind of Blue');
  expect(new URLSearchParams((await page.evaluate(() => location.hash)).split('?')[1]).get('cinemaProvider')).toBe(stored.id);
});

test('tile size and hidden name labels preview the actual Home tiles and persist with accessible names', async ({ page }) => {
  await setup(page); const size = editor(page).getByRole('slider', { name: 'Tile size', exact: true });
  const tile = homePreview(page).getByRole('button', { name: 'Netflix', exact: true });
  const initial = (await tile.boundingBox())!.width;
  await size.focus(); await page.keyboard.press('End'); await expect(size).toHaveValue('150');
  expect((await tile.boundingBox())!.width).toBeGreaterThan(initial * 1.35);
  await page.keyboard.press('Home'); await expect(size).toHaveValue('70');
  expect((await tile.boundingBox())!.width).toBeLessThan(initial * .8);
  await page.keyboard.press('ArrowRight'); await expect(size).toHaveValue('71');
  await editor(page).getByLabel('Show service names', { exact: true }).uncheck();
  await expect(tile.locator('.tvl-provider-tile-name')).toBeHidden(); await expect(tile).toHaveAccessibleName('Netflix');
  await save(page); expect(await saved(page)).toMatchObject({ tileScale: 71, showNames: false });
  await page.evaluate(() => { location.hash = '/home'; });
  const actual = page.locator('#homeTab .tvl-home-provider-row').getByRole('button', { name: 'Netflix', exact: true });
  await expect(actual).toBeVisible(); await expect(actual.locator('.tvl-provider-tile-name')).toBeHidden();
  await page.reload(); await expect(actual.locator('.tvl-provider-tile-name')).toBeHidden();
});

for (const synced of [false, true]) test(`saved tile sizes update an already-open ${synced ? 'account-synced' : 'preview'} Home tab without reload or focus`, async ({ page, context }) => {
  if (synced) {
    let snapshot = { Revision: 'initial', Settings: defaultProviderHomes() };
    await context.route('**/tile-settings-fixture', async route => {
      if (route.request().method() === 'PUT') snapshot = { Revision: 'saved', Settings: route.request().postDataJSON().Settings };
      await route.fulfill({ json: snapshot });
    });
    await context.route('**/dist/demo.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\n(() => {
        const request=async(options)=>{const response=await fetch('/tile-settings-fixture',options);return response.json();};
        window.TvItemLayoutDemo.api.providerHomes={isCurrent:()=>true,load:()=>request(),save:(Settings,Revision)=>request({method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({Settings,Revision})})};
      })();` });
    });
  }
  await page.goto('/?featured=0&layout=desktop#/home');
  const actual = page.locator('#homeTab .tvl-home-provider-row').getByRole('button', { name: 'Netflix', exact: true });
  await expect(actual).toBeVisible();
  const width = () => actual.evaluate(node => node.getBoundingClientRect().width);
  const initial = await width();
  const settingsPage = await context.newPage();
  try {
    await setup(settingsPage);
    await page.evaluate(() => {
      const received = (event: StorageEvent) => {
        if (!event.key?.endsWith(':another-user')) return;
        document.body.dataset.foreignSettingsSeen = 'true'; window.removeEventListener('storage', received);
      };
      window.addEventListener('storage', received);
    });
    await settingsPage.evaluate(settings => {
      localStorage.setItem(`jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:another-user`, JSON.stringify({ ...settings, tileScale: 70 }));
    }, defaultProviderHomes());
    await expect(page.locator('body')).toHaveAttribute('data-foreign-settings-seen', 'true');
    expect(await width()).toBeCloseTo(initial, 0);
    const slider = editor(settingsPage).getByRole('slider', { name: 'Tile size', exact: true });
    await slider.focus(); await settingsPage.keyboard.press('End'); await expect(slider).toHaveValue('150');
    expect((await homePreview(settingsPage).getByRole('button', { name: 'Netflix', exact: true }).boundingBox())!.width).toBeCloseTo(initial * 1.5, 0);
    expect(await width()).toBeCloseTo(initial, 0);
    await save(settingsPage);
    // Do not focus/reload Home or advance its 60-second refresh timer: saving
    // in a sibling tab must resize the mounted row while it remains open.
    await expect.poll(width, { timeout: 2_000 }).toBeCloseTo(initial * 1.5, 0);
    await slider.focus(); await settingsPage.keyboard.press('Home'); await expect(slider).toHaveValue('70');
    expect(await width()).toBeCloseTo(initial * 1.5, 0);
    await save(settingsPage);
    await expect.poll(width, { timeout: 2_000 }).toBeCloseTo(initial * .7, 0);
  } finally { await settingsPage.close(); }
});

test('saved tile sizes reach the real Home row after Back and survive reload', async ({ page }) => {
  await page.goto('/?featured=0&layout=desktop#/home');
  const actual = page.locator('#homeTab .tvl-home-provider-row').getByRole('button', { name: 'Netflix', exact: true });
  await expect(actual).toBeVisible();
  const width = () => actual.evaluate(node => node.getBoundingClientRect().width);
  const initial = await width();
  await page.evaluate(() => { location.hash = '/mypreferencesmenu?cinemaProviders=1'; });
  await expect(editor(page).getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await editor(page).getByRole('slider', { name: 'Tile size', exact: true }).focus();
  await page.keyboard.press('Home'); await save(page);
  await page.goBack(); await expect(actual).toBeVisible();
  await expect.poll(width).toBeCloseTo(initial * .7, 0);
  await page.reload(); await expect(actual).toBeVisible();
  await expect.poll(width).toBeCloseTo(initial * .7, 0);
});

test('a save during an older Home settings read queues a fresh read instead of keeping stale tile sizes', async ({ page, context }) => {
  let snapshot = { Revision: 'initial', Settings: defaultProviderHomes() }, reads = 0;
  let releaseOld!: () => void, readingOld!: () => void;
  const oldRead = new Promise<void>(resolve => { readingOld = resolve; });
  const release = new Promise<void>(resolve => { releaseOld = resolve; });
  await context.route('**/tile-settings-fixture', async route => {
    if (route.request().method() === 'PUT') snapshot = { Revision: 'saved', Settings: route.request().postDataJSON().Settings };
    else if (++reads === 1) {
      const oldSnapshot = structuredClone(snapshot); readingOld(); await release;
      return route.fulfill({ json: oldSnapshot });
    }
    await route.fulfill({ json: snapshot });
  });
  await context.route('**/dist/demo.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n(() => {
      const request=async(options)=>{const response=await fetch('/tile-settings-fixture',options);return response.json();};
      window.TvItemLayoutDemo.api.providerHomes={isCurrent:()=>true,load:()=>request(),save:(Settings,Revision)=>request({method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({Settings,Revision})})};
    })();` });
  });
  await page.goto('/?featured=0&layout=desktop#/home'); await oldRead;
  const settingsPage = await context.newPage();
  try {
    await setup(settingsPage);
    await editor(settingsPage).getByRole('slider', { name: 'Tile size', exact: true }).focus();
    await settingsPage.keyboard.press('End'); await save(settingsPage);
    releaseOld();
    const actual = page.locator('#homeTab .tvl-home-provider-row').getByRole('button', { name: 'Netflix', exact: true });
    await expect.poll(() => reads, { timeout: 2_000 }).toBeGreaterThanOrEqual(3);
    await expect(actual).toBeVisible();
    await expect.poll(() => actual.evaluate(node => node.getBoundingClientRect().width), { timeout: 2_000 }).toBeCloseTo(360, 0);
  } finally { releaseOld(); await settingsPage.close(); }
});

test('TV range keys and remote commands adjust tile size while preserving control focus', async ({ page }) => {
  await setup(page, 'tv'); const size = editor(page).getByRole('slider', { name: 'Tile size', exact: true });
  await size.focus(); await page.keyboard.press('ArrowRight'); await expect(size).toHaveValue('101');
  await page.evaluate(() => document.activeElement!.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command: 'right' } })));
  await expect(size).toHaveValue('102'); await expect(size).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(size).not.toBeFocused();
  await editor(page).getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await expect(size).toHaveValue('100'); expect((await saved(page)).tileScale).toBe(100);
});

test('built-in services are fully editable and Restore defaults resets only that service draft', async ({ page }) => {
  await setup(page); await sidebar(page).getByRole('button', { name: 'Netflix', exact: true }).click();
  await editor(page).getByLabel('Service name', { exact: true }).fill('My Netflix');
  await editor(page).getByLabel('Accent colour', { exact: true }).fill('#112233');
  await editor(page).getByLabel('Show featured artwork', { exact: true }).uncheck();
  await sourceOptions(page); await editor(page).getByLabel('Film provider IDs', { exact: true }).fill('8, 9');
  await editor(page).getByLabel('TV provider IDs', { exact: true }).fill('337');
  await editor(page).getByLabel('Include free titles', { exact: true }).check();
  await save(page); expect((await saved(page)).providers[0]).toMatchObject({ name: 'My Netflix', accent: '#112233', hero: false, movieProviderIds: [8, 9], showProviderIds: [337], offerTypes: ['flatrate', 'free'] });
  await editor(page).getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await expect(editor(page).getByLabel('Service name', { exact: true })).toHaveValue('Netflix');
  expect((await saved(page)).providers[0].name).toBe('My Netflix');
  await save(page); expect((await saved(page)).providers[0]).toEqual(defaultProviderConfig('netflix'));
});

test('Cancel reverses unsaved edits and removal; saved removal can restore a built-in service', async ({ page }) => {
  await setup(page); const baseline = await saved(page);
  await sidebar(page).getByRole('button', { name: 'Netflix', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Remove service', exact: true }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Netflix', exact: true })).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Netflix', exact: true })).toBeVisible(); expect(await saved(page)).toEqual(baseline);
  await sidebar(page).getByRole('button', { name: 'Add service', exact: true }).click();
  await editor(page).getByLabel('Service name', { exact: true }).fill('Unsaved service');
  await editor(page).getByRole('button', { name: 'Cancel changes', exact: true }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Unsaved service', exact: true })).toHaveCount(0); expect(await saved(page)).toEqual(baseline);
  await sidebar(page).getByRole('button', { name: 'Netflix', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Remove service', exact: true }).click(); await save(page);
  expect((await saved(page)).providers.some(provider => provider.id === 'netflix')).toBe(false);
  await editor(page).getByRole('button', { name: 'Add Netflix', exact: true }).click(); await save(page);
  expect((await saved(page)).providers.find(provider => provider.id === 'netflix')).toEqual(defaultProviderConfig('netflix'));
});

test('invalid service fields block Save with useful focus and preserve persisted settings', async ({ page }) => {
  const unsafeArtworkRequests: string[] = []; page.on('request', request => { if (request.url().includes('example.com')) unsafeArtworkRequests.push(request.url()); });
  await setup(page); const baseline = await saved(page); await sidebar(page).getByRole('button', { name: 'Netflix', exact: true }).click();
  const cases = [
    ['Service name', '   ', 'Netflix', 'Enter a service name.'],
    ['Logo URL', 'javascript:alert(1)', '', 'Use an HTTP or HTTPS image URL without a username or password.'],
    ['Logo URL', 'https://user:secret@example.com/logo.png', '', 'Use an HTTP or HTTPS image URL without a username or password.'],
    ['Accent colour', '#123', '#e50914', 'Use a six-digit colour such as #9fb8a8.'],
    ['Film provider IDs', '8,8', '8,175,1796', 'Use each provider ID only once.'],
    ['TV provider IDs', '1,garbage', '8,175,1796', 'Use comma-separated whole numbers from 1 to 1000000.']
  ];
  for (const [label, invalid, valid, message] of cases) {
    if (label.includes('IDs')) await sourceOptions(page);
    const input = editor(page).getByLabel(label, { exact: true }); await input.fill(invalid);
    await editor(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(input).toBeFocused(); await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(editor(page).getByRole('status')).toHaveText(message); expect(await saved(page)).toEqual(baseline);
    await input.fill(valid);
  }
  await sourceOptions(page); await editor(page).getByLabel('Include subscription titles', { exact: true }).uncheck();
  await editor(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor(page).getByRole('status')).toHaveText('Choose at least one availability type.');
  await expect(editor(page).getByLabel('Include subscription titles', { exact: true })).toBeFocused(); expect(await saved(page)).toEqual(baseline);
  expect(unsafeArtworkRequests).toEqual([]);
});

test('custom artwork falls back to initials and the editor remains usable at TV and narrow widths', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await setup(page, 'tv');
  await sidebar(page).getByRole('button', { name: 'Add service', exact: true }).click();
  await editor(page).getByLabel('Service name', { exact: true }).fill('Local stories');
  const preview = servicePreview(page); await expect(preview.locator('.tvl-provider-monogram')).toHaveText('LS');
  await editor(page).getByLabel('Logo URL', { exact: true }).fill(new URL('/missing-service-logo.png', page.url()).href);
  await expect(preview.locator('.tvl-provider-monogram')).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('service-customization-tv.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await editor(page).getByLabel('Service name', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => {
    const pane = document.querySelector('.tvl-provider-settings')!;
    return pane.scrollWidth <= pane.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
  })).toBe(true);
  await expect(editor(page).getByLabel('Service name', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('service-customization-narrow.png') });
});

test('new enabled collection rows require a collection while empty disabled draft rows can be saved', async ({ page }) => {
  await setup(page); await sidebar(page).getByRole('button', { name: 'Add service', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Add row', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor(page).getByRole('combobox', { name: 'Collection', exact: true })).toBeFocused();
  await expect(editor(page).getByRole('status')).toHaveText('Choose a collection for “Collection” before saving.');
  await editor(page).getByLabel('Show this row', { exact: true }).uncheck(); await save(page);
  expect((await saved(page)).providers.find(provider => provider.id.startsWith('custom-'))!.rows[0]).toMatchObject({ source: 'collection', collectionId: '', enabled: false });
});

test('an eighty-character service name wraps without overflowing its tile or obscuring provider Back', async ({ page }, info) => {
  await setup(page); await sidebar(page).getByRole('button', { name: 'Add service', exact: true }).click();
  const name = 'W'.repeat(80); await editor(page).getByLabel('Service name', { exact: true }).fill(name); await save(page);
  await page.evaluate(() => { location.hash = '/home'; });
  for (const width of [1080, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const tile = page.locator('#homeTab .tvl-home-provider-row').getByRole('button', { name, exact: true });
    await tile.scrollIntoViewIfNeeded(); await expect(tile).toBeVisible(); await expect(tile).toHaveAccessibleName(name);
    expect(await tile.locator('.tvl-provider-tile-name').evaluate(node => {
      const title = node.getBoundingClientRect(), card = node.parentElement!.getBoundingClientRect();
      return node.scrollWidth <= node.clientWidth + 1 && title.left >= card.left - 1 && title.right <= card.right + 1;
    })).toBe(true);
    await tile.click(); const home = page.getByRole('dialog', { name: `${name} home`, exact: true });
    const back = home.getByRole('button', { name: 'Back', exact: true }), title = home.getByRole('heading', { name, exact: true });
    await expect(back).toBeVisible(); await expect(title).toBeVisible();
    const heading = (await title.boundingBox())!, button = (await back.boundingBox())!;
    expect(heading.x >= button.x + button.width || heading.y >= button.y + button.height || heading.y + heading.height <= button.y).toBe(true);
    expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await home.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`long-service-name-${width}.png`) });
    await back.click(); await expect(tile).toBeFocused();
  }
});
