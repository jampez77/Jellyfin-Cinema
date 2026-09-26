import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, transform } from 'esbuild';

// Run Jellyfin's actual shortcut parsing and input handlers. The React host
// mounts the same handlers as ItemsContainer.tsx; the legacy case additionally
// loads the real v0 component and its exact lockfile polyfill version. Only
// playbackManager's final play call and unrelated service dependencies adapt.
// Audited sources: v12.0 0e83c6a724b31f3e9b5a499244331a288c060a4a and
// v10.11.0 fa7831bd1fd72e61b3133d2234832201d6dc803e (upstream GPL v2).
const source = process.env.TVL_JELLYFIN_WEB_SOURCE || '/tmp/tvl-jellyfin-web-12-audit';
const polyfill = process.env.TVL_WEBCOMPONENTS_SOURCE || '/tmp/cinema-native-webcomponents-0.7.24/package/webcomponents-lite.js';
const actual = {
  shortcuts: resolve(source, 'src/components/shortcuts.js'),
  input: resolve(source, 'src/scripts/inputManager.js'),
  dom: resolve(source, 'src/utils/dom.js'),
  action: resolve(source, 'src/constants/itemAction.ts'),
  legacy: resolve(source, 'src/elements/emby-itemscontainer/emby-itemscontainer.js'),
};
test.skip(!existsSync(actual.shortcuts), 'Set TVL_JELLYFIN_WEB_SOURCE to audited Jellyfin 12 source.');
let native = '', legacy = '', bridge = '';
test.beforeAll(async () => {
  if (!existsSync(actual.shortcuts)) return;
  const nativeBuild = async (contents: string) => (await build({ stdin: { contents, resolveDir: source },
    bundle: true, format: 'iife', target: 'chrome79', write: false, logLevel: 'silent', plugins: [{ name: 'native-playback-adapters', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (Object.values(actual).includes(args.path)) return { path: args.path };
        if (/^(?:\.\.\/|\.\/)?(?:components\/)?shortcuts$/.test(args.path)) return { path: actual.shortcuts };
        if (args.path.endsWith('/shortcuts')) return { path: actual.shortcuts };
        if (args.path.endsWith('/inputManager')) return { path: actual.input };
        if (args.path === 'utils/dom' || args.path.endsWith('/utils/dom')) return { path: actual.dom };
        if (args.path === 'constants/itemAction') return { path: actual.action };
        if (args.path === 'webcomponents.js/webcomponents-lite') return { path: polyfill };
        return { path: args.path, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
        args.path.includes('playbackmanager') ? `export const playbackManager={canPlay:()=>true,play:options=>{window.__nativePlayback.calls.push(options);return Promise.resolve()},isPlaying:()=>false};`
          : args.path.includes('userSettings') ? `export const getSortValuesLegacy=()=>({sortBy:'SortName',sortOrder:'Ascending'});`
            : `export const EventType={},AppFeature={},OutboundWebSocketMessageType={},appHost={},appRouter={},ServerConnections={currentApiClient:()=>null};
              export const getPlaylistApi=()=>({}),getPlaylistsApi=()=>({}),toApi=value=>value;
              export default {desktop:false,mobile:false,tv:true,touch:false,on(){},off(){},lazyChildren(){},focus(node){node.focus()},autoFocus(){}};` }));
    } }] })).outputFiles[0].text;
  native = await nativeBuild(`import shortcuts from ${JSON.stringify(actual.shortcuts)};
    window.__nativePlayback={calls:[],outside:0}; window.Events={on(){},off(){}};
    window.__mountNativeItems=(server='server-a', handled=true)=>{
      const host=document.createElement('div');host.className='itemsContainer MuiBox-root';host.dataset.nativeFixture='true';
      host.innerHTML='<button class="itemAction" data-id="existing" data-serverid="'+server+'" data-type="Program" data-mediatype="Video">Native programme</button>';
      if(handled){shortcuts.on(host,{click:false});host.addEventListener('click',event=>shortcuts.onClick.call(host,event));}
      host.fetchData=()=>{throw new Error('Native fetchData must not be borrowed or changed');};
      document.body.append(host);return host;
    };`);
  if (existsSync(polyfill)) legacy = await nativeBuild(`import ${JSON.stringify(actual.legacy)};`);
  bridge = (await transform(readFileSync(process.env.TVL_PLAYBACK_BRIDGE_SOURCE || 'src/local-playback.ts', 'utf8'),
    { loader: 'ts', format: 'iife', globalName: 'CinemaPlayback', target: 'chrome79' })).code;
});

async function setup(page: Page, legacyMode = false) {
  await page.route('**/native-playback-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><button id="cinema-play">Watch channel</button></body></html>' }));
  await page.goto('/native-playback-fixture');
  await page.addScriptTag({ content: native });
  if (legacyMode) await page.addScriptTag({ content: legacy });
  await page.addScriptTag({ content: bridge });
}

for (const mode of ['react', 'legacy'] as const) test(`${mode} native handlers play live channels once and preserve existing native DOM and focus`, async ({ page }) => {
  test.skip(mode === 'legacy' && !existsSync(polyfill), 'Set TVL_WEBCOMPONENTS_SOURCE to webcomponents.js 0.7.24.');
  await setup(page, mode === 'legacy');
  const result = await page.evaluate(async legacyMode => {
    const context = window as any, host = context.__mountNativeItems(), child = host.firstElementChild, fetchData = host.fetchData;
    const control = document.getElementById('cinema-play')!; control.focus();
    document.addEventListener('command', () => { context.__nativePlayback.outside++; });
    await context.CinemaPlayback.dispatchPlayback({ serverId: () => 'server-a' }, { Id: 'channel-bluey', Name: 'Bluey TV', Type: 'TvChannel' }, 42, () => true);
    return { calls: context.__nativePlayback.calls, outside: context.__nativePlayback.outside,
      nativeIntact: host.firstElementChild === child && host.children.length === 1 && host.fetchData === fetchData,
      focused: document.activeElement === control, bridges: document.querySelectorAll('[data-tvl-playback-bridge]').length,
      registered: typeof (document.createElement as any)('div', 'emby-itemscontainer').attachedCallback === 'function', legacyMode };
  }, mode === 'legacy');
  expect(result.calls).toEqual([{ ids: ['channel-bluey'], startPositionTicks: 0, serverId: 'server-a', queryOptions: { SortBy: 'SortName', SortOrder: 'Ascending' } }]);
  expect(result).toMatchObject({ outside: 0, nativeIntact: true, focused: true, bridges: 0, registered: mode === 'legacy' });
});

for (const mode of ['react', 'legacy'] as const) test(`${mode} native handlers play current programmes by channel and retain ordered playlist selection`, async ({ page }) => {
  test.skip(mode === 'legacy' && !existsSync(polyfill), 'Set TVL_WEBCOMPONENTS_SOURCE to webcomponents.js 0.7.24.');
  await setup(page, mode === 'legacy');
  const calls = await page.evaluate(async () => {
    const context = window as any; context.__mountNativeItems();
    const client = { serverId: () => 'server-a' }, now = Date.now();
    await context.CinemaPlayback.dispatchPlayback(client, { Id: 'programme', Name: 'Now', Type: 'Program', ChannelId: 'channel-news', StartDate: new Date(now - 1000).toISOString(), EndDate: new Date(now + 60000).toISOString() }, 500, () => true);
    const items = [{ Id: 'track', Name: 'First', Type: 'Audio', PlaylistItemId: 'first' }, { Id: 'track', Name: 'Repeat', Type: 'Audio', PlaylistItemId: 'repeat' }];
    await context.CinemaPlayback.dispatchPlayback(client, { Id: 'playlist', Name: 'Playlist', Type: 'Playlist' }, 0, () => true, { items, startIndex: 1 });
    await Promise.resolve();
    return context.__nativePlayback.calls;
  });
  expect(calls[0]).toMatchObject({ ids: ['channel-news'], startPositionTicks: 0 });
  expect(calls[1]).toEqual({ items: [{ Id: 'track', Name: 'First', Type: 'Audio', PlaylistItemId: 'first', ServerId: 'server-a' }, { Id: 'track', Name: 'Repeat', Type: 'Audio', PlaylistItemId: 'repeat', ServerId: 'server-a' }], startIndex: 1 });
  await expect(page.locator('[data-tvl-playback-bridge]')).toHaveCount(0);
});

test('React fallback rejects missing, unhandled and different-server hosts without leaking commands or bridge nodes', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const context = window as any, errors = [];
    document.addEventListener('command', () => { context.__nativePlayback.outside++; });
    for (const scenario of ['missing', 'unhandled', 'other-server', 'cinema']) {
      document.querySelectorAll('[data-native-fixture]').forEach(node => node.remove());
      if (scenario !== 'missing') {
        const host = context.__mountNativeItems(scenario === 'other-server' ? 'another-server' : 'server-a', scenario !== 'unhandled');
        if (scenario === 'cinema') host.classList.add('tvl-home-collection-row');
      }
      try { await context.CinemaPlayback.dispatchPlayback({ serverId: () => 'server-a' }, { Id: 'channel', Name: 'Channel', Type: 'TvChannel' }, 0, () => true); }
      catch (error) { errors.push((error as Error).message); }
    }
    return { errors, calls: context.__nativePlayback.calls, outside: context.__nativePlayback.outside, bridges: document.querySelectorAll('[data-tvl-playback-bridge]').length };
  });
  expect(result.errors).toHaveLength(4); expect(result.errors.every(message => message.startsWith('Playback could not start'))).toBe(true);
  expect(result).toMatchObject({ calls: [], outside: 0, bridges: 0 });
});

for (const mode of ['react', 'legacy'] as const) test(`${mode} leaving the page during bridge attachment cancels playback`, async ({ page }) => {
  test.skip(mode === 'legacy' && !existsSync(polyfill), 'Set TVL_WEBCOMPONENTS_SOURCE to webcomponents.js 0.7.24.');
  await setup(page, mode === 'legacy');
  const result = await page.evaluate(async () => {
    const context = window as any; context.__mountNativeItems(); let current = true, name = '';
    const pending = context.CinemaPlayback.dispatchPlayback({ serverId: () => 'server-a' }, { Id: 'channel', Name: 'Channel', Type: 'TvChannel' }, 0, () => current);
    current = false;
    try { await pending; } catch (error) { name = (error as Error).name; }
    return { name, calls: context.__nativePlayback.calls, bridges: document.querySelectorAll('[data-tvl-playback-bridge]').length };
  });
  expect(result).toEqual({ name: 'AbortError', calls: [], bridges: 0 });
});

test('React fallback skips an unhandled host and dispatches once through the next native host', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const context = window as any;
    const first = context.__mountNativeItems('server-a', false), next = context.__mountNativeItems();
    document.addEventListener('command', () => { context.__nativePlayback.outside++; });
    await context.CinemaPlayback.dispatchPlayback({ serverId: () => 'server-a' }, { Id: 'channel', Name: 'Channel', Type: 'TvChannel' }, 0, () => true);
    return { calls: context.__nativePlayback.calls, outside: context.__nativePlayback.outside,
      childCounts: [first.children.length, next.children.length], bridges: document.querySelectorAll('[data-tvl-playback-bridge]').length };
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]).toMatchObject({ ids: ['channel'], serverId: 'server-a' });
  expect(result).toMatchObject({ outside: 0, childCounts: [1, 1], bridges: 0 });
});
