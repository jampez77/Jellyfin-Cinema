import { expect, test, type Page } from '@playwright/test';
const avatar = (page: Page) => page.locator('.skinHeader .headerUserButton');
const menu = (page: Page) => page.getByRole('dialog', { name: 'Profile options', exact: true });

async function setup(page: Page, desktop = false) {
  if (desktop) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.body.classList.replace('layout-tv', 'layout-desktop')));
  await page.goto('/?featured=0#/home');
  await page.evaluate(() => {
    const state = { nativeClicks: 0, logout: 0, routes: [] as string[] };
    (window as any).__profileState = state;
    (window as any).Dashboard = {
      logout() { state.logout++; location.hash = '/login'; },
      navigate(route: string) { state.routes.push(route); location.hash = '/' + route; }
    };
    // The native avatar can arrive after Cinema has initialized, including its
    // image child. Cinema must retain this element and its desktop listener.
    const control = document.createElement('button'); control.type = 'button';
    control.className = 'headerButton headerButtonRight headerUserButton headerUserButtonRound'; control.title = 'Family';
    control.innerHTML = '<div class="headerButton headerUserButtonRound" style="width:36px;height:36px;background-image:linear-gradient(45deg,#759a87,#d3e7de)"></div>';
    control.addEventListener('click', () => { state.nativeClicks++; });
    document.querySelector('.skinHeader')!.append(control);
    (window as any).__profileAvatar = control;
    (window as any).__profileAvatarHtml = control.outerHTML;
  });
}
async function remote(page: Page, command: string) {
  await page.evaluate(command => document.activeElement!.dispatchEvent(new CustomEvent('command', { bubbles: true, cancelable: true, detail: { command } })), command);
}

test('TV avatar opens explicit profile actions, preserves current artwork and restores focus on Back', async ({ page }) => {
  await setup(page);
  await avatar(page).locator('div').click();
  await expect(menu(page)).toBeVisible(); await expect(menu(page)).toContainText('Family');
  await expect(menu(page).getByRole('button', { name: 'Switch profile', exact: true })).toBeFocused();
  await page.screenshot({ path: '/tmp/jellyfin-cinema-profile-menu.png' });
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 0, logout: 0, routes: [] });
  await remote(page, 'down'); await expect(menu(page).getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await remote(page, 'back'); await expect(menu(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused();
  expect(await avatar(page).evaluate(node => node === (window as any).__profileAvatar && node.outerHTML === (window as any).__profileAvatarHtml)).toBe(true);
  await avatar(page).click(); await menu(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/#\/mypreferencesmenu$/); await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 0, logout: 0, routes: ['mypreferencesmenu'] });
});

test('remote Select opens the menu and Switch profile invokes the native sign-in flow exactly once', async ({ page }) => {
  await setup(page); await avatar(page).focus(); await remote(page, 'select');
  await expect(menu(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await remote(page, 'select'); await expect(page).toHaveURL(/#\/login$/);
  await expect(menu(page)).toHaveCount(0); await expect(page.locator('body')).not.toHaveClass(/tvl-profile-open/);
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 0, logout: 1, routes: [] });
});

test('holding Enter while opening does not immediately sign out; a fresh press selects the action', async ({ page }) => {
  await setup(page); await avatar(page).focus();
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
  await expect(menu(page)).toBeVisible(); expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await page.keyboard.up('Enter'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/login$/); expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(1);
});

test('desktop retains the original avatar, artwork and native click handler', async ({ page }) => {
  await setup(page, true); await avatar(page).click();
  await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 1, logout: 0, routes: [] });
  expect(await avatar(page).evaluate(node => node === (window as any).__profileAvatar && node.outerHTML === (window as any).__profileAvatarHtml)).toBe(true);
  expect(await page.evaluate(async () => {
    window.TvItemLayout!.refresh();
    let mutations = 0; const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    observer.disconnect(); return mutations;
  })).toBe(0);
});

test('native fallback, layout changes, account changes and destroy release all menu behavior', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__nativeDashboard = (window as any).Dashboard; delete (window as any).Dashboard; });
  await avatar(page).click(); await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileState.nativeClicks)).toBe(1);
  await page.evaluate(() => { (window as any).Dashboard = (window as any).__nativeDashboard; });
  await avatar(page).click(); await expect(menu(page)).toBeVisible();
  await page.evaluate(() => document.body.classList.replace('layout-tv', 'layout-desktop'));
  await expect(menu(page)).toHaveCount(0); await avatar(page).click();
  expect(await page.evaluate(() => (window as any).__profileState.nativeClicks)).toBe(2);
  await page.evaluate(() => { document.body.classList.replace('layout-desktop', 'layout-tv'); window.TvItemLayout!.refresh(); });
  await avatar(page).click(); await expect(menu(page)).toBeVisible();
  await page.evaluate(() => { window.TvItemLayoutDemo!.api = { ...window.TvItemLayoutDemo!.api, userId: 'another-user' }; });
  await expect(menu(page)).toHaveCount(0);
  await avatar(page).click(); await expect(menu(page)).toBeVisible();
  await page.evaluate(() => window.TvItemLayout!.destroy());
  await expect(menu(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused(); await avatar(page).click();
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 3, logout: 0, routes: [] });
  expect(await avatar(page).evaluate(node => node.outerHTML === (window as any).__profileAvatarHtml)).toBe(true);
});

test('leaving the route closes the dialog without pulling focus back to the outgoing avatar', async ({ page }) => {
  await setup(page); await avatar(page).click(); await expect(menu(page)).toBeVisible();
  await page.evaluate(() => { location.hash = '/search'; });
  await expect(menu(page)).toHaveCount(0); await expect(avatar(page)).not.toBeFocused();
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
});
