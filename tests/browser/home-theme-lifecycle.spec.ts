import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// External upstream styles are read without vendoring or running upstream build
// scripts. Jellyfin v12.0: 0e83c6a724b31f3e9b5a499244331a288c060a4a;
// Featured: 2cb03c5360cc39836bc0f7c283752c9398eb50b9; ElegantFin v26.09.05.
const native = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const featured = process.env.TVL_FEATURED_SOURCE || '/tmp/tvl-featured-audit';
const elegant = process.env.TVL_ELEGANTFIN_CSS || '/tmp/cinema-elegantfin-theme.css';
const addon = process.env.TVL_ELEGANTFIN_FEATURED_CSS || '/tmp/cinema-elegantfin-featured.css';
const paths = [resolve(native, 'src/styles/site.scss'), resolve(native, 'src/components/cardbuilder/card.scss'),
  resolve(featured, 'src/styles/featured.css'), elegant, addon];
const available = paths.every(existsSync);
// A separately fetched stylesheet consumes its UTF-8 BOM during decoding.
// Strip it before concatenating sources into an inline style element too.
const readCss = (path:string) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/@import[^;]+;/g, '').replace(/(^|\n)[ \t]*\/\/[^\n]*/g, '$1');
const nativeBody = available ? readCss(paths[0]).match(/\nbody \{[\s\S]*?\n\}/)![0].replace(/@include[^;]+;/g, '') : '';
const lateCss = available ? nativeBody + '\n' + paths.slice(1).map(readCss).join('\n') : '';

async function layout(page:Page, mode:'tv'|'desktop'|'mobile') {
  await page.route('http://127.0.0.1:4173/**', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body:(await response.text()).replace('class="layout-tv"', `class="layout-${mode}"`) });
  });
}

async function nativeHomeMarkup(page:Page) {
  await page.evaluate(() => {
    document.querySelector('.skinHeader')!.classList.add('skinHeader-blurred', 'skinHeader-withBackground', 'focuscontainer-x', 'headroom', 'noHomeButtonHeader');
    const background = document.createElement('div'); background.className = 'backgroundContainer'; background.id = 'theme-test-background';
    document.body.prepend(background);
    const card = document.querySelector('#homeTab [aria-label="Continue watching"] .card')!;
    const box = card.querySelector('.cardBox')!; box.classList.add('visualCardBox');
    const footer = document.createElement('div'); footer.className = 'cardFooter'; footer.append(...box.querySelectorAll('.cardText')); box.append(footer);
    footer.querySelectorAll('.cardText').forEach(node => node.classList.add('cardTextCentered'));
    const action = document.createElement('span'); action.className = 'textActionButton'; action.textContent = footer.firstElementChild!.textContent;
    footer.firstElementChild!.replaceChildren(action);
    const overlay = document.createElement('div'); overlay.className = 'innerCardFooter'; overlay.textContent = 'Progress'; box.querySelector('.cardScalable')!.append(overlay);
    // Recreate only the exact upstream Featured surface needed for the cascade.
    // Real client lifecycle, controls and personalisation are covered separately
    // by featured-home.spec.ts using that checkout's bundled client.
    const banner = document.createElement('section'); banner.id = 'theme-test-featured'; banner.className = 'ec-root ec-ready';
    banner.style.setProperty('--ec-height', '430px');
    banner.innerHTML = '<div class="ec-actions"><button class="ec-button">Featured play</button><button class="ec-button ec-button-secondary">Featured details</button></div>';
    document.querySelector('#homeTab .homeSectionsContainer')!.prepend(banner);
  });
}

async function assertCinema(page:Page) {
  const card = page.locator('#homeTab [aria-label="Continue watching"] .card').first();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(page.locator('#theme-test-background')).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(page.locator('#theme-test-background')).toHaveCSS('background-image', 'none');
  expect(await page.locator('.skinHeader').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('rgba(16, 17, 18, 0.93)');
  expect(await page.locator('#homeTab .sectionTitle').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize) / parseFloat(getComputedStyle(node.parentElement!).fontSize))).toBeCloseTo(1.25, 2);
  await expect(card.locator('.cardBox')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(card.locator('.cardBox')).toHaveCSS('border-top-width', '0px');
  await expect(card.locator('.cardBox')).toHaveCSS('border-radius', '7px');
  await expect(card.locator('.cardText').first()).toHaveCSS('text-align', 'left');
  await expect(card.locator('.textActionButton')).toHaveCSS('text-align', 'left');
  // Cinema clears the caption surface, while the installed theme retains its
  // on-image progress gradient (ElegantFin replaces native solid black).
  await expect(card.locator('.innerCardFooter')).toHaveCSS('background-image', 'linear-gradient(0deg, rgba(13, 13, 13, 0.95), 40%, rgba(0, 0, 0, 0))');
  await expect(card.locator('.innerCardFooter')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name:'Featured play', exact:true })).toHaveCSS('background-color', 'rgb(246, 246, 243)');
  await expect(page.getByRole('button', { name:'Featured play', exact:true })).toHaveCSS('color', 'rgb(16, 17, 18)');
  await expect(page.getByRole('button', { name:'Featured details', exact:true })).toHaveCSS('background-color', 'rgba(38, 52, 44, 0.9)');
}

for (const mode of ['tv','desktop'] as const) test(`${mode} Home keeps Cinema after late native and ElegantFin styles, replacement rows and Back`, async ({page}) => {
  test.skip(!available, 'Set TVL_JELLYFIN_WEB_SOURCE, TVL_FEATURED_SOURCE, TVL_ELEGANTFIN_CSS and TVL_ELEGANTFIN_FEATURED_CSS to the audited external sources.');
  await layout(page, mode); await page.goto('/?featured=0#/home'); await nativeHomeMarkup(page);
  const first = page.locator('#homeTab [aria-label="Continue watching"] .card').first();
  await first.focus();
  await page.addStyleTag({content:lateCss});
  await assertCinema(page); await expect(first).toBeFocused();
  await expect(first.locator('.cardScalable')).toHaveCSS('outline-color', 'rgb(242, 250, 244)');
  // Native Home preferences can replace rows after the route has already opened.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('demo-home-settings', {detail:{sections:['resume','nextup']}})));
  await page.locator('#theme-test-background, #theme-test-featured').evaluateAll(nodes => nodes.forEach(node => node.remove()));
  await nativeHomeMarkup(page); await assertCinema(page);
  await first.click(); await expect(page.getByRole('dialog', {name:'After the Tide details',exact:true})).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/tvl-home/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Escape'); await expect(first).toBeFocused(); await assertCinema(page);
  await page.screenshot({path:test.info().outputPath(`${mode}-late-theme-home.png`),fullPage:true});
});

test('active Home restores a dropped route marker without remounting custom rows or moving focus', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem(`jellyfin-cinema.home-collections.v1:${encodeURIComponent(location.origin)}:demo`, JSON.stringify({version:1,rows:[
    {id:'stable',kind:'items',title:'Weekend picks',collectionIds:['collection-coast'],ranked:true,placement:'start'}
  ]})));
  await layout(page,'desktop'); await page.goto('/?featured=0#/home');
  const row = page.locator('[data-home-row="stable"]'); await expect(row.locator('.tvl-home-row-card')).toHaveCount(2);
  await row.locator('.tvl-home-row-card').first().focus();
  await page.evaluate(() => {
    (window as any).__themeStableRow = document.querySelector('[data-home-row="stable"]');
    (window as any).__themeStableFocus = document.activeElement;
    document.body.classList.remove('tvl-home');
  });
  await expect(page.locator('body')).toHaveClass(/tvl-home/);
  expect(await page.evaluate(() => (window as any).__themeStableRow === document.querySelector('[data-home-row="stable"]') && (window as any).__themeStableFocus === document.activeElement)).toBe(true);
  await page.evaluate(() => { document.body.classList.replace('layout-desktop','layout-mobile'); });
  await expect(page.locator('body')).not.toHaveClass(/tvl-home/); await expect(row).toHaveCount(0);
});

test('late Home overrides leave mobile and Featured outside Home under their own themes', async ({page}) => {
  test.skip(!available, 'External Jellyfin, Featured and ElegantFin styles are required.');
  await layout(page,'mobile'); await page.goto('/?featured=0#/home'); await nativeHomeMarkup(page);
  await page.addStyleTag({content:lateCss});
  await expect(page.locator('body')).not.toHaveClass(/tvl-home/);
  await expect(page.locator('body')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('#homeTab .cardTextCentered').first()).toHaveCSS('text-align','center');
  // The local root tokens represent a theme choice outside Cinema's Home scope.
  await page.addStyleTag({content:':root {--ec-theme-primary:#3d36b2;--ec-theme-primary-contrast:#fff}'});
  await expect(page.getByRole('button',{name:'Featured play',exact:true})).toHaveCSS('background-color','rgb(61, 54, 178)');
  await page.evaluate(() => {document.body.classList.replace('layout-mobile','layout-desktop');});
  await expect(page.locator('body')).toHaveClass(/tvl-home/);
  await expect(page.getByRole('button',{name:'Featured play',exact:true})).toHaveCSS('background-color','rgb(246, 246, 243)');
  await page.evaluate(() => document.body.append(document.querySelector('#theme-test-featured')!));
  await expect(page.getByRole('button',{name:'Featured play',exact:true})).toHaveCSS('background-color','rgb(61, 54, 178)');
});
