import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
const elegantSource = process.env.TVL_ELEGANTFIN_CSS || '/tmp/cinema-elegantfin-theme.css';
const elegantCss = existsSync(elegantSource) ? readFileSync(elegantSource, 'utf8') : '';
const avatar = (page: Page) => page.locator('.skinHeader .headerUserButton');
const menu = (page: Page) => page.getByRole('dialog', { name: 'Who’s watching?', exact: true });

type ProfileLayout = 'tv' | 'desktop' | 'mobile';
async function setup(page: Page, layout: ProfileLayout = 'tv') {
  if (layout !== 'tv') await page.addInitScript(layout => document.addEventListener('DOMContentLoaded', () => document.body.classList.replace('layout-tv', 'layout-' + layout)), layout);
  await page.goto('/?featured=0#/home');
  // Navigation's load event precedes both native Home's initial focus restore
  // and Cinema's first scheduled refresh. Wait for those observable states so
  // a synthetic remote command is not sent before the profile menu is enabled.
  await expect(page.getByRole('region', { name: 'My Media', exact: true }).getByRole('button', { name: 'Movies', exact: true })).toBeFocused();
  if (layout === 'tv') await expect(page.locator('body')).toHaveClass(/\btvl-home\b/);
  await page.evaluate(() => {
    const state = { nativeClicks: 0, logout: 0, routes: [] as string[] };
    (window as any).__profileState = state;
    (window as any).Dashboard = {
      logout() { state.logout++; location.hash = '/login'; },
      navigate(route: string) { state.routes.push(route); location.hash = '/' + route; }
    };
    // The native avatar can arrive after Cinema has initialized, including its
    // image child. Cinema must retain this element and its native listener.
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

test('TV avatar opens the full-screen chooser, preserves native artwork and restores focus on Back', async ({ page }) => {
  await setup(page);
  await avatar(page).locator('div').click();
  await expect(menu(page)).toBeVisible(); await expect(menu(page)).toContainText('Who’s watching?');
  await expect(menu(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  const bounds = await page.locator('.tvl-profile-overlay').boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  await page.screenshot({ path: '/tmp/jellyfin-cinema-profile-menu.png' });
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 0, logout: 0, routes: [] });
  await remote(page, 'left'); await expect(menu(page).getByRole('button', { name: 'Use login screen', exact: true })).toBeFocused();
  await remote(page, 'left'); await expect(menu(page).getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await remote(page, 'back'); await expect(menu(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused();
  expect(await avatar(page).evaluate(node => node === (window as any).__profileAvatar && node.outerHTML === (window as any).__profileAvatarHtml)).toBe(true);
  await avatar(page).click(); await menu(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/#\/mypreferencesmenu$/); await expect(menu(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 0, logout: 0, routes: ['mypreferencesmenu'] });
});

test('remote Select opens the chooser and explicit Use login screen invokes native sign-in exactly once', async ({ page }) => {
  await setup(page); await avatar(page).focus(); await remote(page, 'select');
  await expect(menu(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await menu(page).getByRole('button', { name: 'Use login screen', exact: true }).focus();
  await remote(page, 'select'); await expect(page).toHaveURL(/#\/login$/);
  await expect(menu(page)).toHaveCount(0); await expect(page.locator('body')).not.toHaveClass(/tvl-profile-open/);
  expect(await page.evaluate(() => (window as any).__profileState)).toEqual({ nativeClicks: 0, logout: 1, routes: [] });
});

test('holding Enter while opening does not immediately sign out; a fresh press selects the action', async ({ page }) => {
  await setup(page); await avatar(page).focus();
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter');
  await expect(menu(page)).toBeVisible(); expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await page.keyboard.up('Enter');
  await menu(page).getByRole('button', { name: 'Use login screen', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/login$/); expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(1);
});

test('mobile retains the original avatar, artwork and native click handler', async ({ page }) => {
  await setup(page, 'mobile'); await avatar(page).click();
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
  await page.evaluate(() => document.body.classList.replace('layout-tv', 'layout-mobile'));
  await expect(menu(page)).toHaveCount(0); await avatar(page).click();
  expect(await page.evaluate(() => (window as any).__profileState.nativeClicks)).toBe(2);
  await page.evaluate(() => { document.body.classList.replace('layout-mobile', 'layout-tv'); window.TvItemLayout!.refresh(); });
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
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click();
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
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click();
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

async function setupSwitch(page: Page, options: { deferLogout?: boolean; rejectAuth?: boolean; deferAuth?: boolean; deferProfiles?: boolean; brokenImage?: boolean; layout?: ProfileLayout } = {}) {
  await setup(page, options.layout);
  await page.evaluate(options => {
    const host = window as any, state = host.__profileState;
    Object.assign(state, { user: 'family', auth: 0, adopted: 0, handoff: 0, publicReads: 0, eligibilityReads: 0, eligible: ['family', 'child'], admin: false });
    // Jellyfin 12 public DTO flags do not describe direct-switch eligibility.
    const profiles = [{ Id: 'family', Name: 'Family', HasPassword: true, PrimaryImageTag: 'family-art' }, { Id: 'child', Name: 'Kids', HasPassword: true }, { Id: 'adult', Name: 'Parents', HasPassword: true }];
    state.profiles = profiles;
    host.ApiClient = {
      getCurrentUserId: () => state.user, serverId: () => 'demo', getUser: async (id: string) => ({ Id: id, Policy: { IsAdministrator: state.admin } }),
      getPublicUsers: async () => {
        state.publicReads++;
        if (options.deferProfiles) await new Promise<void>(resolve => { host.__finishProfiles = resolve; });
        return profiles;
      },
      getUrl: (path: string) => '/native/' + path,
      getUserImageUrl: () => options.brokenImage ? '/missing-profile-art.jpg' : '/demo/assets/forest.jpg',
      getJSON: async (url: string) => { state.eligibilityReads++; state.eligibilityUrl = url; return { ProfileIds: state.eligible }; },
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
const chooser = (page: Page) => page.getByRole('dialog', { name: 'Who’s watching?', exact: true });
const switching = (page: Page) => page.getByRole('dialog', { name: 'Switching profile', exact: true });
async function choose(page: Page) { await avatar(page).click(); await expect(chooser(page)).toBeVisible(); }

test('TV avatar opens profile tiles directly; endpoint eligibility overrides native DTO flags and held Enter cannot switch', async ({ page }) => {
  await setupSwitch(page); await avatar(page).focus();
  await page.keyboard.down('Enter');
  await expect(chooser(page)).toBeVisible();
  await expect(chooser(page).getByRole('button', { name: 'Family, current profile', exact: true })).toBeFocused();
  await expect(chooser(page).getByRole('button', { name: 'Family, current profile', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(chooser(page).getByRole('button', { name: 'Parents, sign in', exact: true })).toBeVisible();
  await expect(chooser(page)).not.toContainText('Password required');
  await expect(chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/jellyfin-cinema-profile-chooser.png' });
  await page.keyboard.down('Enter');
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await page.keyboard.up('Enter'); await remote(page, 'right');
  await expect(chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/home$/); await expect(switching(page)).toHaveCount(0);
  expect(await page.evaluate(() => {
    const s = (window as any).__profileState; return { logout: s.logout, auth: s.auth, adopted: s.adopted, handoff: s.handoff, publicReads: s.publicReads, payload: s.payload, user: s.user, routes: s.routes };
  })).toEqual({ logout: 1, auth: 1, adopted: 1, handoff: 1, publicReads: 2, payload: { Username: 'Kids', Pw: '' }, user: 'child', routes: ['home'] });
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.eligibilityReads, s.eligibilityUrl]; })).toEqual([2, '/native/TvItemLayout/ProfileSwitchEligibility']);
});

test('ineligible profile keeps native login and stale cards never sign out a changed account', async ({ page }) => {
  await setupSwitch(page); await choose(page);
  await page.evaluate(() => { (window as any).__profileState.user = 'other'; });
  await chooser(page).getByRole('button', { name: 'Parents, sign in', exact: true }).click();
  await expect(chooser(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
  await page.evaluate(() => { (window as any).__profileState.user = 'family'; });
  await choose(page); await chooser(page).getByRole('button', { name: 'Parents, sign in', exact: true }).click();
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


test('current profile returns without signing out; arrows and Tab stay inside the full-screen chooser', async ({ page }) => {
  await setupSwitch(page); await choose(page);
  const current = chooser(page).getByRole('button', { name: 'Family, current profile', exact: true });
  await expect(current).toBeFocused();
  await avatar(page).evaluate(node => (node as HTMLElement).focus());
  await expect(current).toBeFocused();
  await remote(page, 'right');
  await expect(chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true })).toBeFocused();
  await remote(page, 'right');
  await expect(chooser(page).getByRole('button', { name: 'Parents, sign in', exact: true })).toBeFocused();
  await remote(page, 'down');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.tvl-profile-actions'))).toBe(true);
  await chooser(page).getByRole('button', { name: 'Back', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(current).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(chooser(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await current.focus(); await remote(page, 'select');
  await expect(chooser(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused();
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth]; })).toEqual([0, 0]);
});

test('late public profiles cannot reopen a closed chooser or steal focus', async ({ page }) => {
  await setupSwitch(page, { deferProfiles: true }); await choose(page);
  await expect(chooser(page).getByRole('status')).toHaveText('Loading profiles…');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishProfiles)).toBe('function');
  await remote(page, 'back'); await expect(avatar(page)).toBeFocused();
  await page.evaluate(() => (window as any).__finishProfiles());
  await expect(chooser(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused();
  expect(await page.evaluate(() => (window as any).__profileState.logout)).toBe(0);
});

test('artwork falls back to initials and wrapped profile rows stay visible at TV and phone widths', async ({ page }) => {
  await setupSwitch(page, { brokenImage: true });
  await page.evaluate(() => {
    (window as any).__profileState.profiles.push(
      { Id: 'guest-one', Name: 'Movie Night', HasPassword: true },
      { Id: 'guest-two', Name: 'Alex', HasPassword: true },
      { Id: 'guest-three', Name: 'Sam', HasPassword: true });
  });
  await choose(page);
  await expect(chooser(page).locator('.tvl-profile-avatar')).toHaveCount(0);
  await expect(chooser(page).getByRole('button', { name: 'Family, current profile', exact: true }).locator('.tvl-profile-initials')).toHaveText('F');
  await expect(chooser(page).getByRole('button', { name: 'Movie Night, sign in', exact: true }).locator('.tvl-profile-initials')).toHaveText('MN');
  for (const width of [1920, 800, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    expect(await page.locator('.tvl-profile-overlay').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const cards = await chooser(page).locator('.tvl-profile-card').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, width: box.width };
    }));
    expect(cards).toHaveLength(6);
    expect(cards.every(box => box.x >= 0 && box.right <= width && box.width > 100)).toBe(true);
    if (width === 390) expect(new Set(cards.map(box => Math.round(box.y))).size).toBeGreaterThan(1);
  }
  await page.screenshot({ path: '/tmp/jellyfin-cinema-profile-chooser-mobile.png' });
});

test('a revoked direct-switch eligibility is checked before logout and offers explicit native login', async ({ page }) => {
  await setupSwitch(page); await choose(page);
  await expect(chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__profileState.eligible = ['family']; });
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('button', { name: 'Continue to login', exact: true })).toBeVisible();
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth, s.user]; })).toEqual([0, 0, 'family']);
});

test('empty or failed profile lists keep usable Back, Settings and native-login actions', async ({ page }) => {
  await setupSwitch(page);
  await page.evaluate(() => { (window as any).__profileState.profiles.length = 0; });
  await choose(page);
  await expect(chooser(page).getByRole('status')).toHaveText('No public profiles are available. Use the login screen for a hidden account.');
  await expect(chooser(page).getByRole('button', { name: 'Use login screen', exact: true })).toBeFocused();
  await expect(chooser(page).getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await remote(page, 'back'); await expect(avatar(page)).toBeFocused();
  await page.evaluate(() => { (window as any).ApiClient.getPublicUsers = async () => { throw new Error('offline'); }; });
  await choose(page);
  await expect(chooser(page).getByRole('status')).toHaveText('Could not load profiles. Use the login screen or go back and try again.');
  await expect(chooser(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await chooser(page).getByRole('button', { name: 'Use login screen', exact: true }).click();
  await expect(page).toHaveURL(/#\/login$/);
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth]; })).toEqual([1, 0]);
});

test('profile tiles keep Cinema artwork and strong focus over actual ElegantFin CSS', async ({ page }) => {
  test.skip(!elegantCss, 'Set TVL_ELEGANTFIN_CSS to the published ElegantFin CSS to exercise its real cascade.');
  await page.route('https://**/*', route => route.abort());
  await setupSwitch(page); await choose(page);
  await page.evaluate(css => {
    document.documentElement.dir = 'ltr';
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  }, elegantCss);
  const current = chooser(page).getByRole('button', { name: 'Family, current profile', exact: true });
  await expect(current).toBeFocused();
  await expect(current.locator('.tvl-profile-avatar')).toBeVisible();
  await expect.poll(() => current.locator('.tvl-profile-avatar').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(current.locator('.tvl-profile-artwork')).toHaveCSS('border-radius', '14px');
  await expect(current.locator('.tvl-profile-artwork')).toHaveCSS('border-top-color', 'rgb(211, 231, 222)');
  expect(await current.locator('.tvl-profile-artwork').evaluate(node => getComputedStyle(node).boxShadow)).toContain('7px');
  await remote(page, 'right'); await expect(chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true })).toBeFocused();
  await remote(page, 'down');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.tvl-profile-actions'))).toBe(true);
  await remote(page, 'up');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.tvl-profile-grid'))).toBe(true);
  await current.focus();
  await page.screenshot({ path: '/tmp/jellyfin-cinema-profile-chooser-elegantfin.png' });
});


for (const input of ['mouse', 'keyboard'] as const) {
  test(`desktop ${input} opens the same chooser and switches directly without native menu or focus leaks`, async ({ page }) => {
    await setupSwitch(page, { layout: 'desktop' });
    if (input === 'mouse') await avatar(page).locator('div').click();
    else { await avatar(page).focus(); await page.keyboard.press('Enter'); }
    const current = chooser(page).getByRole('button', { name: 'Family, current profile', exact: true });
    const kids = chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true });
    await expect(current).toBeFocused();
    await avatar(page).evaluate(node => (node as HTMLElement).focus()); await expect(current).toBeFocused();
    await chooser(page).getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Tab'); await expect(current).toBeFocused();
    if (input === 'mouse') await kids.click();
    else { await page.keyboard.press('Tab'); await expect(kids).toBeFocused(); await page.keyboard.press('Enter'); }
    await expect(switching(page)).toHaveCount(0); await expect(chooser(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/home$/);
    expect(await page.evaluate(() => {
      const s = (window as any).__profileState;
      return { nativeClicks: s.nativeClicks, user: s.user, logout: s.logout, auth: s.auth, adopted: s.adopted, handoff: s.handoff };
    })).toEqual({ nativeClicks: 0, user: 'child', logout: 1, auth: 1, adopted: 1, handoff: 1 });
    expect(await avatar(page).evaluate(node => node === (window as any).__profileAvatar && node.outerHTML === (window as any).__profileAvatarHtml)).toBe(true);
  });
}

test('desktop supports current profile, Escape, Settings and freshly revalidated administrator actions', async ({ page }) => {
  await setupSwitch(page, { layout: 'desktop' });
  await page.evaluate(() => { (window as any).__profileState.admin = true; });
  await choose(page);
  await chooser(page).getByRole('button', { name: 'Family, current profile', exact: true }).click();
  await expect(chooser(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused();
  await page.keyboard.press('Enter'); await expect(chooser(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(chooser(page)).toHaveCount(0); await expect(avatar(page)).toBeFocused();
  await choose(page);
  const admin = chooser(page).getByRole('button', { name: 'Dashboard', exact: true });
  await expect(admin).toBeVisible();
  await page.evaluate(() => { (window as any).__profileState.admin = false; });
  await admin.click(); await expect(admin).toHaveCount(0);
  await expect(chooser(page).getByRole('status')).toHaveText('Dashboard access is no longer available.');
  await chooser(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/#\/mypreferencesmenu$/); await expect(chooser(page)).toHaveCount(0);
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.logout, s.auth, s.routes]; })).toEqual([0, 0, ['mypreferencesmenu']]);
});

test('desktop pending authentication survives a TV layout change but is cancelled when switching to mobile', async ({ page }) => {
  await setupSwitch(page, { layout: 'desktop', deferAuth: true }); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('status')).toHaveText('Signing in…');
  await page.evaluate(() => { document.body.classList.replace('layout-desktop', 'layout-tv'); window.TvItemLayout!.refresh(); });
  await expect(switching(page)).toBeVisible();
  await page.evaluate(() => { document.body.classList.replace('layout-tv', 'layout-mobile'); window.TvItemLayout!.refresh(); });
  await expect(switching(page)).toHaveCount(0);
  await page.evaluate(async () => { (window as any).__finishAuth(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.user, s.auth, s.adopted, s.handoff]; })).toEqual(['', 1, 0, 0]);
  await expect(page).toHaveURL(/#\/login$/);
});

test('desktop account changes close the chooser and cannot adopt a late response for the previous account', async ({ page }) => {
  await setupSwitch(page, { layout: 'desktop', deferAuth: true }); await choose(page);
  await page.evaluate(() => {
    (window as any).__profileState.user = 'other';
    window.TvItemLayoutDemo!.api = { ...window.TvItemLayoutDemo!.api, userId: 'other' }; window.TvItemLayout!.refresh();
  });
  await expect(chooser(page)).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__profileState.user = 'family';
    window.TvItemLayoutDemo!.api = { ...window.TvItemLayoutDemo!.api, userId: 'family' }; window.TvItemLayout!.refresh();
  });
  await choose(page); await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('status')).toHaveText('Signing in…');
  await page.evaluate(async () => {
    (window as any).__profileState.user = 'other';
    window.TvItemLayoutDemo!.api = { ...window.TvItemLayoutDemo!.api, userId: 'other' }; window.TvItemLayout!.refresh();
    (window as any).__finishAuth(); await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(switching(page)).toHaveCount(0);
  expect(await page.evaluate(() => { const s = (window as any).__profileState; return [s.user, s.auth, s.adopted, s.handoff]; })).toEqual(['other', 1, 0, 0]);
});


async function nativeTvSwitch(page: Page, options: { deferLogout?: boolean; rejectAuth?: boolean; deferAuth?: boolean } = {}) {
  await setupSwitch(page, options);
  await page.evaluate(options => {
    const host = window as any, state = host.__profileState;
    Object.assign(state, { nativeServerSelections: 0, queryClears: 0, viewResets: 0 });
    // Official webOS NativeShell.selectServer posts to its parent, which
    // removes the web frame. A document navigation exercises the same loss of
    // Cinema's in-memory switch; no intent or credentials are persisted here.
    host.NativeShell = { selectServer() { state.nativeServerSelections++; location.href = '/demo/index.html?tv-server-picker#/selectserver'; } };
    host.__nativeSelectServer = host.NativeShell.selectServer;
    host.__finishLogout = () => {
      state.user = ''; state.queryClears++; state.viewResets++;
      host.NativeShell.selectServer();
    };
    host.Dashboard.logout = () => {
      state.logout++;
      if (!options.deferLogout) void Promise.resolve().then(host.__finishLogout);
    };
    const authenticate = host.ApiClient.ajax;
    host.ApiClient.ajax = (request: unknown) => {
      state.cleanupBeforeAuth = [state.queryClears, state.viewResets];
      return authenticate(request);
    };
  }, options);
}

test('webOS native logout keeps the chosen server alive until exactly one eligible profile authentication completes', async ({ page }) => {
  await nativeTvSwitch(page); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page)).toHaveCount(0); await expect(page).toHaveURL(/#\/home$/);
  expect(await page.evaluate(() => {
    const host = window as any, s = host.__profileState;
    return { selected: s.nativeServerSelections, cleanup: s.cleanupBeforeAuth, routes: s.routes, auth: s.auth, adopted: s.adopted, user: s.user, restored: host.NativeShell.selectServer === host.__nativeSelectServer };
  })).toEqual({ selected: 0, cleanup: [1, 1], routes: ['login?serverid=demo', 'home'], auth: 1, adopted: 1, user: 'child', restored: true });
  // Unrelated ordinary logout still delegates to the TV's real server picker.
  await page.evaluate(() => (window as any).Dashboard.logout());
  await expect(page).toHaveURL(/\?tv-server-picker#\/selectserver$/);
});

test('webOS explicit login stays on the current server without attempting authentication', async ({ page }) => {
  await nativeTvSwitch(page); await choose(page);
  await chooser(page).getByRole('button', { name: 'Use login screen', exact: true }).click();
  await expect(chooser(page)).toHaveCount(0); await expect(page).toHaveURL(/#\/login\?serverid=demo$/);
  expect(await page.evaluate(() => {
    const host = window as any, s = host.__profileState;
    return [s.nativeServerSelections, s.queryClears, s.viewResets, s.auth, host.NativeShell.selectServer === host.__nativeSelectServer];
  })).toEqual([0, 1, 1, 0, true]);
});

test('webOS rejected authentication restores the native shell and keeps the same-server login usable', async ({ page }) => {
  await nativeTvSwitch(page, { rejectAuth: true }); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('button', { name: 'Continue to login', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const host = window as any, s = host.__profileState;
    return [s.nativeServerSelections, s.auth, s.adopted, host.NativeShell.selectServer === host.__nativeSelectServer];
  })).toEqual([0, 1, 0, true]);
  await switching(page).getByRole('button', { name: 'Continue to login', exact: true }).click();
  await expect(switching(page)).toHaveCount(0); await expect(page).toHaveURL(/#\/login\?serverid=demo$/);
});

test('webOS cancel during authentication cannot adopt a late response and leaves the shell restored', async ({ page }) => {
  await nativeTvSwitch(page, { deferAuth: true }); await choose(page);
  await chooser(page).getByRole('button', { name: 'Kids, switch profile', exact: true }).click();
  await expect(switching(page).getByRole('status')).toHaveText('Signing in…');
  await switching(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(async () => { (window as any).__finishAuth(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(await page.evaluate(() => {
    const host = window as any, s = host.__profileState;
    return [s.nativeServerSelections, s.auth, s.adopted, s.user, host.NativeShell.selectServer === host.__nativeSelectServer];
  })).toEqual([0, 1, 0, '', true]);
  await expect(switching(page)).toHaveCount(0); await expect(page).toHaveURL(/#\/login\?serverid=demo$/);
});

for (const action of ['switch', 'login'] as const) test(`destroy restores the webOS bridge during pending native ${action} cleanup`, async ({ page }) => {
  await nativeTvSwitch(page, { deferLogout: true }); await choose(page);
  await chooser(page).getByRole('button', { name: action === 'switch' ? 'Kids, switch profile' : 'Use login screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const host = window as any; return host.NativeShell.selectServer !== host.__nativeSelectServer;
  })).toBe(true);
  await page.evaluate(() => window.TvItemLayout!.destroy());
  await expect(chooser(page)).toHaveCount(0); await expect(switching(page)).toHaveCount(0);
  expect(await page.evaluate(() => {
    const host = window as any; return [host.NativeShell.selectServer === host.__nativeSelectServer, host.__profileState.auth];
  })).toEqual([true, 0]);
  await page.evaluate(() => (window as any).__finishLogout());
  await expect(page).toHaveURL(/\?tv-server-picker#\/selectserver$/);
});
