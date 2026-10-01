import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultLoadingScreen, loadingAnimations, loadingScreenKey, parseLoadingScreen } from '../src/loading-settings';
import { createLoadingScreenTransport, LoadingScreenStore, LoadingScreenSyncError, loadingScreenSnapshot, type LoadingScreenSnapshot } from '../src/loading-settings-store';

function cache() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test('loading choices preserve text, blanks and independent defaults', () => {
  assert.equal(loadingAnimations.length, 6);
  for (const { id } of loadingAnimations) {
    const value = { ...defaultLoadingScreen(), animation: id, brandText: '<b>Family cinema</b> 🎬', message: '' };
    assert.deepEqual(parseLoadingScreen(value), value);
  }
  const draft = defaultLoadingScreen(); draft.brandText = 'Changed';
  assert.equal(defaultLoadingScreen().brandText, 'SCREENHARBOUR');
  assert.deepEqual(parseLoadingScreen({ ...draft, brandText: 'x'.repeat(60), message: 'y'.repeat(120) }).message, 'y'.repeat(120));
});
test('loading settings reject malformed snapshots and control characters without silently replacing choices', () => {
  for (const value of [null, [], {}, { ...defaultLoadingScreen(), version: 2 }, { ...defaultLoadingScreen(), animation: 'unknown' },
    { ...defaultLoadingScreen(), extra: true }, { ...defaultLoadingScreen(), brandText: null },
    { ...defaultLoadingScreen(), brandText: 'x'.repeat(61) }, { ...defaultLoadingScreen(), message: 'y'.repeat(121) },
    ...['\n', '\t', '\0', '\u007f', '\u009f'].map(c => ({ ...defaultLoadingScreen(), message: c }))]) {
    assert.throws(() => parseLoadingScreen(value), /invalid/);
  }
  assert.deepEqual(loadingScreenSnapshot({ Revision: null, Settings: null }), { Revision: null, Settings: null });
  for (const value of [null, {}, { Revision: null }, { Revision: 'rev', Settings: null },
    { Revision: null, Settings: defaultLoadingScreen() }, { Revision: 'rev', Settings: defaultLoadingScreen(), Other: true }]) {
    assert.throws(() => loadingScreenSnapshot(value), /invalid/);
  }
});
test('loading preferences are isolated by account and server and survive reconstruction', async () => {
  const storage = cache(), key = loadingScreenKey('server:a', 'user:b');
  assert.notEqual(key, loadingScreenKey('server', 'a:user:b'));
  const store = new LoadingScreenStore(key, storage);
  await assert.rejects(store.save(defaultLoadingScreen()), /Load the saved/);
  await store.load(); const choice = { ...defaultLoadingScreen(), animation: 'jellyfin' as const, message: 'Welcome home' };
  await store.save(choice); store.destroy();
  assert.deepEqual(new LoadingScreenStore(key, storage).cached, choice);
  assert.deepEqual(new LoadingScreenStore(loadingScreenKey('another', 'user:b'), storage).cached, defaultLoadingScreen());
  assert.deepEqual(new LoadingScreenStore(loadingScreenKey('server:a', 'kids'), storage).cached, defaultLoadingScreen());
});
test('server loading choices are authoritative and blank first-use state does not write stale local choices', async () => {
  const storage = cache(); storage.setItem('key', JSON.stringify({ ...defaultLoadingScreen(), animation: 'spotlights' }));
  let writes = 0;
  const store = new LoadingScreenStore('key', storage, { isCurrent: () => true,
    load: async () => ({ Revision: null, Settings: null }), save: async () => { writes++; throw new Error('unexpected write'); } });
  assert.equal(store.cached.animation, 'spotlights');
  assert.deepEqual(await store.load(), defaultLoadingScreen()); assert.equal(writes, 0);
});
test('conflicts keep the old saved cache and require a fresh revision before retrying', async () => {
  const storage = cache(); let revision = 'one', writes = 0, conflict = true;
  const store = new LoadingScreenStore('key', storage, { isCurrent: () => true,
    load: async () => ({ Revision: revision, Settings: defaultLoadingScreen() }),
    save: async (settings, expected) => {
      writes++; assert.equal(expected, revision);
      if (conflict) throw new LoadingScreenSyncError('conflict', 'Changed elsewhere');
      return { Revision: 'three', Settings: settings };
    } });
  await store.load(); const draft = { ...defaultLoadingScreen(), animation: 'countdown' as const };
  await assert.rejects(store.save(draft), /Changed elsewhere/);
  assert.equal(store.cached.animation, 'projector');
  await assert.rejects(store.save(draft), /Load the saved/); assert.equal(writes, 1);
  conflict = false; revision = 'two'; await store.load(); await store.save(draft);
  assert.equal(store.cached.animation, 'countdown');
});
test('late loading preference reads cannot overwrite another session or a destroyed view', async () => {
  for (const dispose of [false, true]) {
    const storage = cache(); let current = true, finish!: (value: LoadingScreenSnapshot) => void;
    const store = new LoadingScreenStore('key', storage, { isCurrent: () => current,
      load: () => new Promise(resolve => { finish = resolve; }), save: async () => { throw new Error('unexpected write'); } });
    const pending = store.load(); if (dispose) store.destroy(); else current = false;
    finish({ Revision: 'one', Settings: { ...defaultLoadingScreen(), message: 'Old account' } });
    await assert.rejects(pending, /account changed/); assert.equal(storage.data.size, 0);
  }
});
test('loading transport uses only its own endpoint and preserves text and revisions exactly', async () => {
  const calls: unknown[] = []; const settings = { ...defaultLoadingScreen(), brandText: 'Our cinema', message: '<img src=x>' };
  const transport = createLoadingScreenTransport({ getUrl: path => path,
    getJSON: async url => { calls.push(url); return { Revision: null, Settings: null }; },
    ajax: async request => { calls.push(request); return { Revision: 'saved', Settings: settings }; } }, () => true);
  await transport.load(); await transport.save(settings, null);
  assert.equal(calls[0], 'TvItemLayout/LoadingScreen');
  assert.deepEqual(calls[1], { type: 'PUT', url: 'TvItemLayout/LoadingScreen', data: JSON.stringify({ Revision: null, Settings: settings }), contentType: 'application/json', dataType: 'json' });
});
test('transport rejects stale sessions and failed reads retain the last successful account cache', async () => {
  let current = true, resolve!: (value: unknown) => void;
  const transport = createLoadingScreenTransport({ getUrl: path => path,
    getJSON: () => new Promise(done => { resolve = done; }), ajax: async () => null }, () => current);
  const pending = transport.load(); current = false;
  resolve({ Revision: 'old', Settings: defaultLoadingScreen() }); await assert.rejects(pending, /account changed/);
  const storage = cache(), saved = { ...defaultLoadingScreen(), animation: 'film-reel' as const };
  storage.setItem('key', JSON.stringify(saved));
  const store = new LoadingScreenStore('key', storage, { isCurrent: () => true, load: async () => { throw new Error('offline'); }, save: async () => { throw new Error('unexpected'); } });
  await assert.rejects(store.load(), /offline/); assert.deepEqual(store.cached, saved);
});
