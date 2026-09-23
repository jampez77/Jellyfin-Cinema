import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Exercise Jellyfin's actual public login controller/template without vendoring
// its GPL v2 source. Audited jellyfin/jellyfin-web v12.0 revision
// 0e83c6a724b31f3e9b5a499244331a288c060a4a; TVL_JELLYFIN_WEB_SOURCE may point there.
// API/dialog/component adapters below are fixture-owned. Native authentication
// decisions, chooser rendering, validation and form event handlers are upstream.
const source = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const entry = resolve(source, 'src/apps/legacy/controllers/session/login/index.js');
const available = existsSync(entry);
const strings: Record<string, string> = {
  HeaderPleaseSignIn: 'Please sign in', LabelUser: 'User', LabelPassword: 'Password', RememberMe: 'Remember me',
  ButtonSignIn: 'Sign in', ButtonCancel: 'Cancel', ButtonManualLogin: 'Manual Login', ButtonUseQuickConnect: 'Use Quick Connect',
  ButtonForgotPassword: 'Forgot Password', ButtonChangeServer: 'Change Server', MessageInvalidUser: 'Invalid username or password. Please try again.',
  MessageUnauthorizedUser: 'This account cannot sign in here.', HeaderConnectionFailure: 'Connection failure', MessageUnableToConnectToServer: 'Could not connect to the server.',
  QuickConnect: 'Quick Connect', QuickConnectAuthorizeCode: 'Enter code {0} to login', ButtonGotIt: 'Got it',
};
const read = (path: string) => readFileSync(resolve(source, path), 'utf8');
const template = available ? read('src/apps/legacy/controllers/session/login/index.html').replace(/\$\{([^}]+)\}/g, (_, key) => strings[key] || key) : '';
const dialogTemplate = available ? read('src/components/dialog/dialog.template.html') : '';
// Optional active user-theme regression, kept outside this repository. This is
// ElegantFin v26.09.05's served theme.css; fonts are irrelevant to cascade tests.
const elegantFinPath = process.env.TVL_ELEGANTFIN_CSS || '/tmp/cinema-elegantfin-theme.css';
const elegantFinAvailable = existsSync(elegantFinPath);
const elegantFinCss = elegantFinAvailable ? readFileSync(elegantFinPath, 'utf8')
  .replace(/@import\s+url\((?:"[^"]*"|'[^']*'|[^)])*\)\s*;/g, '').replace(/@font-face\s*\{[^}]*\}/g, '') : '';
const nativeCss = available ? [
  'src/components/cardbuilder/card.scss', 'src/elements/emby-button/emby-button.scss',
  'src/elements/emby-input/emby-input.scss', 'src/elements/emby-checkbox/emby-checkbox.scss',
  'src/components/formdialog.scss', 'src/apps/legacy/controllers/session/login/login.scss',
].map(path => read(path).replace(/\/\/[^\n]*/g, '')).join('\n') : '';
let controller = '';
test.skip(!available, 'Set TVL_JELLYFIN_WEB_SOURCE to the audited Jellyfin 12 web checkout.');
test.beforeAll(async () => {
  if (!available) return;
  const stubs: Record<string, string> = {
    'dompurify': 'export default ()=>({setConfig(){},sanitize:value=>value});',
    'markdown-it': 'export default ()=>({render:value=>value});',
    'constants/appFeature': 'export const AppFeature={MultiServer:"multi"};',
    'lib/jellyfin-apiclient': 'export const ServerConnections={getOrCreateApiClient:()=>window.ApiClient};',
    'components/apphost': 'export const appHost={supports:()=>window.__loginState.multiServer};',
    'scripts/settings/appSettings': 'export default {enableAutoLogin(value){if(value!==undefined)window.__loginState.remember=value;return window.__loginState.remember;}};',
    'utils/dom': 'export default {parentWithClass:(node,name)=>node.closest("."+name)};',
    'components/loading/loading': 'export default {show(){},hide(){}};',
    'components/layoutManager': 'export default {get tv(){return document.documentElement.classList.contains("layout-tv");}};',
    'scripts/libraryMenu': 'export default {setTransparentMenu(){}};',
    'scripts/browser': 'export default {slow:false,edge:false};',
    'lib/globalize': 'export default {translate:(key,...args)=>(window.__loginStrings[key]||key).replace(/\\{(\\d+)\\}/g,(_,i)=>args[+i]||"")};',
    'utils/dashboard': 'export default {onServerChanged(id){window.__loginState.signedIn=id;},navigate(route){window.__loginState.routes.push(route);},selectServer(){window.__loginState.routes.push("selectserver");},alert:options=>window.__loginAlert({title:options.title,text:options.message})};',
    'components/toast/toast': 'export default text=>{const node=document.createElement("div");node.className="toast toastVisible";node.setAttribute("role","alert");node.textContent=text;document.querySelector(".toastContainer").append(node);};',
    'components/dialogHelper/dialogHelper': 'export default {close:node=>node.remove()};',
    'components/alert': 'export default options=>window.__loginAlert(options);',
    'components/cardbuilder/utils/builder': 'export const getDefaultBackgroundClass=()=>"defaultCardBackground1";',
    'components/autoFocuser': 'export default {autoFocus:root=>root.querySelector(".visualLoginForm:not(.hide) button")?.focus()};',
  };
  controller = (await build({ stdin: { contents: `import init from ${JSON.stringify(entry)};window.__initNativeLogin=init;`, resolveDir: source },
    bundle: true, format: 'iife', target: 'chrome79', write: false, logLevel: 'silent', plugins: [{ name: 'login-native-adapters', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path === entry ? { path: entry } : { path: args.path, namespace: 'fixture' });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] || 'export default {};', loader: 'js' }));
    } }] })).outputFiles[0].text;
});

async function setup(page: Page, options: { desktop?: boolean; mobile?: boolean; jf12PublicUsers?: boolean; noUsers?: boolean; width?: number; multiServer?: boolean; elegantFin?: boolean } = {}) {
  if (options.width) await page.setViewportSize({ width: options.width, height: 900 });
  await page.goto('/?featured=0#/login');
  await page.locator('style[data-tv-item-layout]').waitFor({ state: 'attached' });
  await page.evaluate(({ template, nativeCss, elegantFinCss, strings, dialogTemplate, options }) => {
    document.documentElement.classList.remove('layout-tv', 'layout-desktop', 'layout-mobile'); document.body.classList.remove('layout-tv', 'layout-desktop', 'layout-mobile');
    document.documentElement.classList.add(options.mobile ? 'layout-mobile' : options.desktop ? 'layout-desktop' : 'layout-tv'); document.documentElement.dir = 'ltr';
    // Model a signed-out session. Login theme must not depend on a MediaApi.
    delete (window as any).TvItemLayoutDemo;
    const state = { remember: true, attempts: [] as { name: string; password: string }[], routes: [] as string[], reject: 0, signedIn: '', multiServer: !!options.multiServer, quickRequests: 0 };
    (window as any).__loginState = state; (window as any).__loginStrings = strings;
    (window as any).ApiClient = {
      getCurrentUserId: () => '', serverId: () => 'fixture-server', accessToken: () => '',
      getPublicUsers: async () => options.noUsers ? [] : [{ Id: 'protected', Name: 'Alex', HasPassword: true, PrimaryImageTag: 'art' }, { Id: 'guest', Name: 'Guest', HasPassword: !!options.jf12PublicUsers }, { Id: 'long', Name: 'An unusually long profile name', HasPassword: true }],
      getUserImageUrl: () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#405d4c"/><circle cx="150" cy="112" r="50" fill="#c6d6c9"/><ellipse cx="150" cy="275" rx="105" ry="95" fill="#c6d6c9"/></svg>'),
      getQuickConnect: async () => true, getUrl: (path: string) => path,
      getJSON: async () => ({ LoginDisclaimer: '<p>Welcome to our library. <a href="https://example.invalid/help">Sign-in help</a></p>' }),
      authenticateUserByName: async (name: string, password: string) => { state.attempts.push({ name, password }); if (state.reject) throw { status: state.reject }; return { User: { Id: name === 'Guest' ? 'guest' : 'protected' }, AccessToken: 'fixture-token' }; },
      ajax: async () => { state.quickRequests++; return { json: async () => ({ Secret: 'fixture-secret', Code: '123456' }) }; },
    };
    const style = document.createElement('style');
    style.textContent = nativeCss + (options.elegantFin ? elegantFinCss : '') + `
      .hide{display:none!important}.flex{display:flex}.align-items-center{align-items:center}.justify-content-center{justify-content:center}
      body{margin:0}body>:not(#loginPage):not(.dialogContainer):not(.toastContainer):not(script):not(style){display:none!important}
      #loginPage{position:relative;z-index:100}.standalonePage{padding-top:4.5em!important}.readOnlyContent,form{max-width:54em}.material-icons{font-family:Arial;font-style:normal}.material-icons.person::before{content:'♟'}
      .toastContainer{position:fixed;bottom:1rem;left:1rem;z-index:99999}.toast{padding:1rem}
      .dialogContainer{position:fixed;inset:0;z-index:9999}.dialog.formDialog{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#080808;color:white}
      .formDialogFooter{position:static}.formDialogContent{flex:none;overflow:auto}`;
    document.head.append(style); document.querySelector('#loginPage')?.remove();
    document.body.insertAdjacentHTML('beforeend', template + '<div class="toastContainer"></div>');
    const root = document.querySelector('#loginPage')!;
    root.querySelectorAll<HTMLInputElement>('input[is="emby-input"]').forEach(input => { input.classList.add('emby-input'); const label = document.createElement('label'); label.className = 'inputLabel'; label.htmlFor = input.id; label.textContent = input.getAttribute('label'); input.before(label); });
    root.querySelectorAll('button[is="emby-button"]').forEach(button => button.classList.add('emby-button', 'show-focus'));
    const checkbox = root.querySelector('.chkRememberLogin')!; checkbox.classList.add('emby-checkbox'); checkbox.parentElement!.classList.add('emby-checkbox-label'); checkbox.nextElementSibling!.classList.add('checkboxLabel'); checkbox.parentElement!.insertAdjacentHTML('beforeend', '<span class="checkboxOutline"><span class="material-icons checkboxIcon checkboxIcon-checked check" aria-hidden="true">✓</span></span>');
    (window as any).__loginNativeNodes = [root, root.querySelector('.manualLoginForm'), root.querySelector('#txtManualPassword'), root.querySelector('#divUsers')];
    (window as any).__loginAlert = (options: { dialogOptions?: { id?: string }; title: string; text: string }) => {
      const holder = document.createElement('div'); holder.className = 'dialogContainer';
      const dialog = document.createElement('div'); dialog.className = 'dialog formDialog opened'; dialog.id = options.dialogOptions?.id || 'loginErrorAlert'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', options.title);
      dialog.innerHTML = dialogTemplate; dialog.querySelector('.formDialogHeaderTitle')!.textContent = options.title; dialog.querySelector('.text')!.textContent = options.text;
      const content = dialog.querySelector<HTMLElement>('.formDialogContent')!; content.style.maxWidth = '50%'; content.style.maxHeight = '60%';
      const button = document.createElement('button'); button.className = 'emby-button raised button-submit btnOption'; button.textContent = 'Got it'; button.addEventListener('click', () => holder.remove()); dialog.querySelector('.formDialogFooter')!.append(button);
      holder.append(dialog); document.body.append(holder); button.focus();
    };
    window.TvItemLayout!.refresh();
  }, { template, nativeCss, elegantFinCss, strings, dialogTemplate, options });
  await page.addScriptTag({ content: controller });
  await page.evaluate(() => { const root = document.querySelector('#loginPage')!; (window as any).__initNativeLogin(root, {}); root.dispatchEvent(new CustomEvent('viewshow')); });
  await expect(page.locator('.btnQuick')).toBeVisible();
}

test('signed-out TV uses Cinema chooser and native protected/passwordless authentication decisions', async ({ page }) => {
  await setup(page);
  await expect(page.locator('body')).toHaveClass(/tvl-login-native/);
  await expect(page.locator('#loginPage')).toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await expect(page.locator('#divUsers .card')).toHaveCount(3);
  await expect(page.locator('#divUsers [data-userid="protected"] .cardImageContainer')).not.toHaveCSS('background-image', 'none');
  await expect(page.locator('.btnSelectServer')).toBeHidden();
  await page.getByRole('button', { name: 'Alex', exact: true }).click();
  await expect(page.getByLabel('User', { exact: true })).toHaveValue('Alex');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__loginState.attempts)).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Guest', exact: true }).focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__loginState.attempts)).toEqual([{ name: 'Guest', password: '' }]);
  expect(await page.evaluate(() => (window as any).__loginNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('cinema-login-chooser.png'), fullPage: true });
});

test('native manual form preserves required fields, remember choice, failures and password submission', async ({ page }) => {
  await setup(page); await page.getByRole('button', { name: 'Manual Login', exact: true }).click();
  await expect(page.getByLabel('User', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__loginState.attempts)).toEqual([]);
  await page.getByLabel('User', { exact: true }).fill('Alex'); await page.getByLabel('Password', { exact: true }).fill('incorrect-fixture-password');
  await page.evaluate(() => { (window as any).__loginState.reject = 401; });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid username or password');
  await expect(page.getByRole('alert')).toHaveCSS('color', 'rgb(255, 240, 229)');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByLabel('Remember me').focus(); await page.keyboard.press('Space');
  await expect(page.getByLabel('Remember me')).not.toBeChecked();
  await page.evaluate(() => { (window as any).__loginState.reject = 0; });
  await page.getByLabel('Password', { exact: true }).fill('valid-fixture-password'); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => ({ remember: (window as any).__loginState.remember, signedIn: (window as any).__loginState.signedIn, attempts: (window as any).__loginState.attempts.length }))).toEqual({ remember: false, signedIn: 'protected', attempts: 2 });
  await page.screenshot({ path: test.info().outputPath('cinema-login-password.png'), fullPage: true });
});

test('native Quick Connect and connection errors retain their content and dismiss controls', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Use Quick Connect', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Quick Connect', exact: true });
  await expect(quick).toBeVisible(); await expect(quick).toContainText('123456');
  await expect(quick.locator('.formDialogContent')).toHaveCSS('background-color', 'rgb(27, 41, 32)');
  await quick.getByRole('button', { name: 'Got it' }).click(); await expect(quick).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__loginState.quickRequests)).toBe(1);
  await page.getByRole('button', { name: 'Alex', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('fixture'); await page.evaluate(() => { (window as any).__loginState.reject = 503; });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const error = page.getByRole('dialog', { name: 'Connection failure', exact: true });
  await expect(error).toContainText('Could not connect to the server.'); await expect(error.getByRole('button', { name: 'Got it' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(error).toHaveCount(0);
});

test('empty public-user list and a narrow TV screen keep manual login usable', async ({ page }) => {
  await setup(page, { noUsers: true, width: 390, multiServer: true });
  await expect(page.locator('.visualLoginForm')).toBeHidden(); await expect(page.locator('.btnCancel')).toBeHidden();
  await expect(page.getByLabel('User', { exact: true })).toBeFocused(); await expect(page.locator('.btnSelectServer')).toBeVisible();
  for (const selector of ['.manualLoginForm', '#txtManualName', '#txtManualPassword', '.readOnlyContent']) {
    const box = await page.locator(selector).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
  await page.getByRole('button', { name: 'Use Quick Connect', exact: true }).click();
  const content = await page.locator('#quickConnectAlert .formDialogContent').boundingBox(); expect(content!.width).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('cinema-login-narrow.png'), fullPage: true });
});

test('mobile, route transitions and teardown release login skin without changing auth inputs', async ({ page }) => {
  await setup(page, { mobile: true });
  await expect(page.locator('body')).not.toHaveClass(/tvl-login-native/);
  await expect(page.locator('#loginPage')).not.toHaveCSS('background-color', 'rgb(16, 17, 18)');
  await page.evaluate(() => { document.documentElement.classList.replace('layout-mobile', 'layout-desktop'); window.TvItemLayout!.refresh(); });
  await expect(page.locator('body')).toHaveClass(/tvl-login-native/);
  await page.getByRole('button', { name: 'Manual Login', exact: true }).click(); await page.getByLabel('User', { exact: true }).fill('Still editing');
  expect(await page.evaluate(async () => { let count = 0; const observer = new MutationObserver(records => { count += records.length; }); observer.observe(document.body, { attributes: true, attributeFilter: ['class'] }); for (let i = 0; i < 5; i++) window.TvItemLayout!.refresh(); await new Promise(resolve => requestAnimationFrame(resolve)); observer.disconnect(); return count; })).toBe(0);
  await page.evaluate(() => { history.replaceState(null, '', '#/home'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('body')).not.toHaveClass(/tvl-login-native/);
  await page.evaluate(() => { location.hash = '/login?serverid=fixture-server'; });
  await expect(page.locator('body')).toHaveClass(/tvl-login-native/);
  await page.evaluate(() => window.TvItemLayout!.destroy());
  await expect(page.locator('body')).not.toHaveClass(/tvl-login-native/);
  await expect(page.getByLabel('User', { exact: true })).toHaveValue('Still editing');
  expect(await page.evaluate(() => (window as any).__loginNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
});

test('desktop native chooser, keyboard password form and Quick Connect use Cinema without TV markup or auth changes', async ({ page }) => {
  await setup(page, { desktop: true, jf12PublicUsers: true, elegantFin: elegantFinAvailable });
  await expect(page.locator('body')).toHaveClass(/tvl-login-native/);
  await expect(page.locator('.layout-tv')).toHaveCount(0);
  await expect(page.locator('#divUsers .card.show-focus')).toHaveCount(0);
  await expect(page.locator('.visualLoginForm h1')).toBeVisible();
  const alex = page.getByRole('button', { name: 'Alex', exact: true });
  await alex.click();
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toBeFocused();
  await expect(page.getByLabel('User', { exact: true })).toHaveValue('Alex');
  expect(await page.evaluate(() => (window as any).__loginState.attempts)).toEqual([]);
  await password.fill('invalid-fixture'); await page.evaluate(() => { (window as any).__loginState.reject = 401; });
  await password.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Invalid username or password');
  await expect(password).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Use Quick Connect', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Quick Connect', exact: true });
  await expect(quick).toContainText('123456'); await expect(quick.getByRole('button', { name: 'Got it' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(quick).toHaveCount(0);
  const guest = page.getByRole('button', { name: 'Guest', exact: true });
  await guest.focus(); await page.keyboard.press('Enter');
  await expect(password).toBeFocused(); await expect(password).toHaveValue('');
  // Jellyfin 12 reports HasPassword=true even for a blank-password account.
  // Cinema styles native login but must not infer eligibility or auto-submit it.
  expect(await page.evaluate(() => (window as any).__loginState.attempts.length)).toBe(1);
  await page.evaluate(() => { (window as any).__loginState.reject = 0; });
  await password.press('Enter');
  expect(await page.evaluate(() => (window as any).__loginState.attempts)).toEqual([
    { name: 'Alex', password: 'invalid-fixture' }, { name: 'Guest', password: '' }
  ]);
  expect(await page.evaluate(() => (window as any).__loginNativeNodes.every((node: Element) => node.isConnected))).toBe(true);
  await expect(page.locator('.layout-tv')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('cinema-desktop-native-login.png'), fullPage: true });
});

test('active ElegantFin theme cannot replace Cinema login layout, headings, primary action or error colours', async ({ page }) => {
  test.skip(!elegantFinAvailable, 'Set TVL_ELEGANTFIN_CSS to the served ElegantFin v26.09.05 theme.css.');
  await setup(page, { elegantFin: true });
  expect(await page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--elegantFinFooterText'))).toContain('ElegantFin');
  const wrapper = page.locator('#loginPage>.padded-left');
  await expect(page.locator('.visualLoginForm h1')).toBeVisible();
  await expect(wrapper).toHaveCSS('transform', 'none');
  await expect(wrapper).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect((await wrapper.boundingBox())!.width).toBeGreaterThan(1000);
  expect(await page.locator('.visualLoginForm').evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
  await page.getByRole('button', { name: 'Alex', exact: true }).click();
  await expect(page.locator('.manualLoginForm h1')).toBeVisible();
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await submit.focus();
  await expect(submit).toHaveCSS('background-color', 'rgb(245, 245, 242)');
  await expect(submit).toHaveCSS('color', 'rgb(16, 17, 18)');
  await page.getByLabel('Password', { exact: true }).fill('fixture'); await page.evaluate(() => { (window as any).__loginState.reject = 401; });
  await submit.click();
  await expect(page.getByRole('alert')).toHaveCSS('background-color', 'rgb(53, 41, 35)');
  await page.setViewportSize({ width: 390, height: 900 });
  const form = await page.locator('.manualLoginForm').boundingBox();
  expect(form!.x).toBeGreaterThanOrEqual(0); expect(form!.x + form!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: test.info().outputPath('cinema-login-elegantfin.png'), fullPage: true });
});
