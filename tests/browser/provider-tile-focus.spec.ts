import { expect, test, type Page } from '@playwright/test';
import { defaultCustomProvider, defaultProviderHomes } from '../../src/provider-settings';

async function home(page: Page, layout: 'tv' | 'desktop') {
  const settings = defaultProviderHomes();
  settings.providers = [settings.providers[0]!, { ...defaultCustomProvider('custom-film-club'), name: 'Film club', accent: '#48c9b0' }];
  await page.addInitScript(settings => localStorage.setItem(`jellyfin-cinema.provider-homes.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify(settings)), settings);
  await page.goto(`/?featured=0&layout=${layout}#/home`);
  const row = page.locator('#homeTab .tvl-home-provider-row');
  await expect(row.locator('.tvl-provider-tile')).toHaveCount(2);
  return row;
}

test('TV remote focus uses a single service-accent ring for branded and custom streaming tiles', async ({ page }, info) => {
  const row = await home(page, 'tv');
  const netflix = row.getByRole('button', { name: 'Netflix', exact: true });
  const custom = row.getByRole('button', { name: 'Film club', exact: true });
  await netflix.focus();
  for (const [tile, accent] of [[netflix, 'rgb(229, 9, 20)'], [custom, 'rgb(72, 201, 176)']] as const) {
    if (tile === custom) await page.keyboard.press('ArrowRight');
    await expect(tile).toBeFocused();
    const art = tile.locator('.tvl-provider-tile-mark');
    await expect(art).toHaveCSS('outline-color', accent);
    await expect(art).toHaveCSS('outline-style', 'solid');
    await expect(art).toHaveCSS('outline-width', '2px');
    await expect(art).toHaveCSS('outline-offset', '3px');
    await expect(art).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(tile).toHaveCSS('outline-style', 'none');
    await expect(tile).toHaveCSS('box-shadow', 'none');
    await expect(art).toHaveCSS('box-shadow', 'none');
    await expect(tile.locator('.tvl-provider-tile-name')).toHaveCSS('outline-style', 'none');
    // Mouse hover on a focused TV tile must not add its inner accent border back.
    await tile.hover();
    await expect(art).toHaveCSS('outline-color', accent);
    await expect(art).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  }
  await page.screenshot({ path: info.outputPath('tv-service-accent-focus.png') });
});

test('desktop streaming tiles retain their accent hover border without a focus ring', async ({ page }) => {
  const row = await home(page, 'desktop');
  const tile = row.getByRole('button', { name: 'Film club', exact: true });
  const art = tile.locator('.tvl-provider-tile-mark');
  await page.locator('.skinHeader').getByRole('link', { name: 'Settings', exact: true }).focus();
  const background = await art.evaluate(node => getComputedStyle(node).backgroundImage);
  await tile.hover();
  await expect(tile).not.toBeFocused();
  await expect(art).toHaveCSS('border-top-color', 'rgb(72, 201, 176)');
  await expect(art).toHaveCSS('outline-width', '0px');
  await expect(art).not.toHaveCSS('background-image', background);
});
