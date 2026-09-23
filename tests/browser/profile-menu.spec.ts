import { expect, test, type Page } from '@playwright/test';
const avatar = (page: Page) => page.locator('.skinHeader .headerUserButton');
const menu = (page: Page) => page.getByRole('dialog', { name: 'Profile options', exact: true });

async function setup(page: Page, desktop = false) {
  if (desktop) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.body.classList.replace('layout-tv', 'layout-desktop')));
  await page.goto('/?featured=0#/home');
  // Navigation's load event precedes both native Home's initial focus restore
  // and Cinema's first scheduled refresh. Wait for those observable states so
  // a synthetic remote command is not sent before the profile menu is enabled.
  await expect(page.getByRole('region', { name: 'My Media', exact: true }).getByRole('button', { name: 'Movies', exact: true })).toBeFocused();
  if (!desktop) await expect(page.locator('body')).toHaveClass(/\btvl-home\b/);
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

test('administrators get Dashboard in the profile menu and its policy is checked again before opening', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).__adminAllowed = true;
    (window as any).ApiClient = {
      getCurrentUserId: () => 'family', serverId: () => 'demo',
      getUser: async () => ({ Id: 'family', Policy: { IsAdministrator: (window as any).__adminAllowed } })
    };
  });
  await avatar(page).click();
  const dashboard = menu(page).getByRole('button', { name: 'Dashboard', exact: true });
  await expect(dashboard).toBeVisible();
  await page.evaluate(() => { (window as any).__adminAllowed = false; });
  await dashboard.click();
  await expect(dashboard).toHaveCount(0);
  await expect(menu(page).getByRole('status')).toHaveText('Dashboard access is no longer available.');
  expect(await page.evaluate(() => (window as any).__profileState.routes)).toEqual([]);
  await menu(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { (window as any).__adminAllowed = true; });
  await avatar(page).click(); await dashboard.click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  expect(await page.evaluate(() => (window as any).__profileState.routes)).toEqual(['dashboard']);
});

test('ordinary users and stale account policy responses cannot expose Dashboard in the profile menu', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).__policyUser = 'child';
    (window as any).ApiClient = {
      getCurrentUserId: () => (window as any).__policyUser, serverId: () => 'demo',
      getUser: async () => ({ Id: 'child', Policy: { IsAdministrator: false } })
    };
  });
  await avatar(page).click();
  await expect(menu(page).getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
  await menu(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => {
    (window as any).ApiClient.getUser = async () => {
      document.body.dataset.adminPolicyPending = 'true';
      await new Promise(resolve => document.addEventListener('finish-admin-policy', resolve, { once: true }));
      return { Id: 'child', Policy: { IsAdministrator: true } };
    };
  });
  await avatar(page).click();
  await expect(page.locator('body')).toHaveAttribute('data-admin-policy-pending', 'true');
  await page.evaluate(() => { (window as any).__policyUser = 'other'; document.dispatchEvent(new Event('finish-admin-policy')); });
  await expect(menu(page).getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
});

async function setupSwitch(page: Page, options: { deferLogout?: boolean; rejectAuth?: boolean; deferAuth?: boolean } = {}) {
  await setup(page);
  await page.evaluate(options => {
    const host = window as any, state = host.__profileState;
    Object.assign(state, { user: 'family', auth: 0, adopted: 0, handoff: 0, publicReads: 0 });
    const profiles = [{ Id: 'family', Name: 'Family', HasPassword: false }, { Id: 'child', Name: 'Kids', HasPassword: false }, { Id: 'adult', Name: 'Parents', HasPassword: true }];
    host.ApiClient = {
      getCurrentUserId: () => state.user, serverId: () => 'demo', getUser: async (id: string) => ({ Id: id, Policy: { IsAdministrator: false } }),
      getPublicUsers: async () => { state.publicReads++; return profiles; }, getUrl: (path: string) => '/native/' + path,
      ajax: async (request: { data: string }) => {
        state.auth++; state.payload = JSON.parse(request.data);
        if (options.deferAuth) await new Promise<void>(resolve => { host.__finishAuth = resolve; });
        if (options.rejectAuth) throw new Error('401');
        return { User: { Id: 'child' }, ServerId: 'demo', AccessToken: 'dummy-test-session' };
      },
      onAuthenticated: async (_client: unknown, response: { User: { Id: string } }) => { state.adopted++; state.user = response.User.Id; }
    };
    host.__finishLogout = () => { state.user = ''; location.hash = '/login'; };
    host.Dashboard.logout = () => { state.logout++; if (!options.deferLogout) host.__finishLogout(); };
    host.Dashboard.onServerChanged = () => { state.handoff++; };
  }, options);
}
const chooser = (page: Page) => page.getByRole('dialog', { name: 'Choose profile', exact: true });
const switching = (page: Page) => page.getByRole('dialog', { name: 'Switching profile', exact: true });
async function choose(page: Page) { await avatar(page).click(); await menu(page).getByRole('button', { name: 'Switch profile', exact: true }).click(); await expect(chooser(page)).toBeVisible(); }

test('public profile tiles distinguish protected accounts and held Enter does not trigger a second action', async ({ page }) => {
  await setupSwitch(page); await avatar(page).click();
  await menu(page).getByRole('button', { name: 'Switch profile', exact: true }).focus();
  await page.keyboard.down('Enter');
  await expect(chooser(page)).toBeVisible();
  await expect(chooser(page)).toContainText('Profiles without a password open directly. Password-protected profiles use Jellyfin’s login screen.');
  await expect(chooser(page).getByRole('button', { name: 'Family, current profile', exact: true })).toBeDisabled();
  await expect(chooser(page).getByRole('button', { name: 'Parents, password required', exact: true })).toBeVisible();
  await expect(chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true })).toBeFocused();
  await page.screenshot({ path: '/tmp/jellyfin-cinema-profile-chooser.png' });
  await page.keyboard.down('Enter');
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await page.keyboard.up('Enter'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/home$/); await expect(switching(page)).toHaveCount(0);
  expect(await page.evaluate(() => {
    const s = (window as any).__profileState; return { logout: s.logout, auth: s.auth, adopted: s.adopted, handoff: s.handoff, publicReads: s.publicReads, payload: s.payload, user: s.user, routes: s.routes };
  })).toEqual({ logout: 1, auth: 1, adopted: 1, handoff: 1, publicReads: 2, payload: { Username: 'Kids', Pw: '' }, user: 'child', routes: ['home'] });
});

test('protected profile keeps native login and stale protected cards never sign out a changed account', async ({ page }) => {
  await setupSwitch(page); await choose(page);
  await page.evaluate(() => { (window as any).__profileState.user = 'other'; });
  await chooser(page).getByRole('button', { name: 'Parents, password required', exact: true }).click();
  await expect(chooser(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await page.evaluate(() => { (window as any).__profileState.user = 'family'; });
  await choose(page); await chooser(page).getByRole('button', { name: 'Parents, password required', exact: true }).click();
  await expect(page).toHaveURL(/#\/login$/);
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth, s.adopted]; })).toEqual([1, 0, 0]);
});

test('pending native logout blocks Cancel and repeat actions until cleanup finishes', async ({ page }) => {
  await setupSwitch(page, { deferLogout: true }); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('status')).toHaveText('Closing the current session…');
  await expect(switching(page).getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await remote(page, 'back'); await page.keyboard.press('Enter'); await expect(switching(page)).toBeVisible();
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth]; })).toEqual([1, 0]);
  await page.evaluate(() => (window as any).__finishLogout());
  await expect(switching(page)).toHaveCount(0); await expect(page).toHaveURL(/#\/home$/);
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth, s.adopted]; })).toEqual([1, 1, 1]);
});

test('failed passwordless authentication leaves an explicit usable native-login action', async ({ page }) => {
  await setupSwitch(page, { rejectAuth: true }); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('status')).toHaveText('Could not sign in to that profile. Continue with Jellyfin’s login screen.');
  await switching(page).getByRole('button', { name: 'Continue to login', exact: true }).click();
  await expect(switching(page)).toHaveCount(0); await expect(page).toHaveURL(/#\/login\?serverid=demo$/);
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth, s.adopted]; })).toEqual([1, 1, 0]);
});

test('Cancel during pending authentication cannot persist a late response', async ({ page }) => {
  await setupSwitch(page, { deferAuth: true }); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('status')).toHaveText('Signing in…');
  await switching(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(switching(page)).toHaveCount(0);
  await page.evaluate(async () => { (window as any).__finishAuth(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.user, s.auth, s.adopted, s.handoff]; })).toEqual(['', 1, 0, 0]);
  await expect(page).toHaveURL(/#\/login$/);
});
