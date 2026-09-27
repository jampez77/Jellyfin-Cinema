import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultProviderHomes, providerHomesKey, type ProviderHomesSettings } from '../src/provider-settings.ts';
import { ProviderHomesStore, ProviderHomesSyncError, createProviderHomesTransport, providerHomesSnapshot, type ProviderHomesSnapshot, type ProviderHomesTransport } from '../src/provider-settings-store.ts';

class Storage {
  data = new Map<string, string>(); writes = 0;
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes++; this.data.set(key, value); }
}
class Server implements ProviderHomesTransport {
  current = true; writes = 0; reads = 0; snapshot: ProviderHomesSnapshot = { Revision: null, Settings: null };
  isCurrent = () => this.current;
  async load() { this.reads++; return structuredClone(this.snapshot); }
  async save(settings: ProviderHomesSettings, revision: string | null) {
    if (revision !== this.snapshot.Revision) throw new ProviderHomesSyncError('conflict', 'Changed elsewhere');
    this.snapshot = { Revision: String(++this.writes), Settings: structuredClone(settings) }; return structuredClone(this.snapshot);
  }
}
const key = providerHomesKey('server-a', 'user-a');
const settings = (title: string) => ({ ...defaultProviderHomes(), title });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('new server preferences use defaults without writing or migrating old device cache', async () => {
  const server = new Server(), storage = new Storage(); storage.setItem(key, JSON.stringify(settings('Obsolete')));
  const desktop = new ProviderHomesStore(key, storage, server), tv = new ProviderHomesStore(key, new Storage(), server);
  assert.equal(desktop.cached.title, 'Obsolete'); assert.deepEqual(await desktop.load(), defaultProviderHomes());
  assert.deepEqual(await tv.load(), defaultProviderHomes()); assert.equal(server.writes, 0);
  assert.deepEqual(new ProviderHomesStore(key, storage, server).cached, defaultProviderHomes());
});
test('saved settings follow the same account across devices including explicit disabled and empty values', async () => {
  const server = new Server(), desktop = new ProviderHomesStore(key, new Storage(), server), tvStorage = new Storage();
  tvStorage.setItem(key, JSON.stringify(settings('Old cached Home')));
  const tv = new ProviderHomesStore(key, tvStorage, server); await desktop.load();
  const value = settings(''); value.enabled = false; value.providers.reverse(); value.providers[0].hero = false; value.providers[0].enabled = false; value.providers[0].rows = [];
  await desktop.save(value); assert.deepEqual(await tv.load(), value); assert.equal(server.writes, 1);
  await desktop.save({ ...value, providers: [] }); assert.deepEqual((await tv.load()).providers, []);
  assert.deepEqual(new ProviderHomesStore(key, tvStorage, server).cached.providers, []);
});
test('stable server and account keys isolate cached provider preferences', async () => {
  const storage = new Storage(), local = new ProviderHomesStore(key, storage); await local.load(); await local.save(settings('A’s choices'));
  assert.equal(new ProviderHomesStore(key, storage).cached.title, 'A’s choices');
  assert.deepEqual(new ProviderHomesStore(providerHomesKey('server-a', 'user-b'), storage).cached, defaultProviderHomes());
  assert.deepEqual(new ProviderHomesStore(providerHomesKey('server-b', 'user-a'), storage).cached, defaultProviderHomes());
  const detached = local.cached; detached.providers[0].rows.pop(); assert.equal(local.cached.providers[0].rows.length, 4);
});
test('saving requires a successful server read and malformed or offline reloads invalidate the previous revision', async () => {
  const server = new Server(); let mode = 'good';
  const store = new ProviderHomesStore(key, new Storage(), { isCurrent: server.isCurrent,
    load: async () => { if (mode === 'offline') throw new Error('offline'); if (mode === 'invalid') return { Revision: '1', Settings: { version: 2 } } as any; return server.load(); }, save: server.save.bind(server) });
  await assert.rejects(store.save(settings('No')), /Load the saved/); await store.load(); await store.save(settings('Good'));
  mode = 'invalid'; await assert.rejects(store.load(), /invalid/); await assert.rejects(store.save(settings('No')), /Load the saved/); assert.equal(store.cached.title, 'Good');
  mode = 'good'; await store.load(); mode = 'offline'; await assert.rejects(store.load(), /offline/);
  await assert.rejects(store.save(settings('No')), /Load the saved/); assert.equal(server.writes, 1);
});
test('conflict preserves draft and cache, blocks stale retry, and reload adopts the winner', async () => {
  const server = new Server(), storage = new Storage(); await server.save(settings('Original'), null);
  const a = new ProviderHomesStore(key, new Storage(), server), b = new ProviderHomesStore(key, storage, server); await a.load(); await b.load();
  await a.save(settings('Elsewhere')); const cache = storage.getItem(key), draft = settings('Draft');
  await assert.rejects(b.save(draft), error => error instanceof ProviderHomesSyncError && error.kind === 'conflict');
  assert.equal(storage.getItem(key), cache); assert.equal(draft.title, 'Draft'); assert.equal(b.cached.title, 'Original');
  await assert.rejects(b.save(draft), /Load the saved/); assert.equal((await b.load()).title, 'Elsewhere');
  assert.equal((await b.save(draft)).title, 'Draft');
});
test('transport failures and unconfirmed writes cannot change offline cache; retry keeps the loaded revision', async () => {
  const server = new Server(), storage = new Storage(); await server.save(settings('Saved'), null); let mode = 'offline';
  const store = new ProviderHomesStore(key, storage, { isCurrent: server.isCurrent, load: server.load.bind(server),
    save: async (value, revision) => { if (mode === 'offline') throw new Error('offline'); if (mode === 'null') return { Revision: null, Settings: null }; return server.save(value, revision); } });
  await store.load(); const writes = storage.writes; await assert.rejects(store.save(settings('Draft')), /offline/);
  mode = 'null'; await assert.rejects(store.save(settings('Draft')), /did not confirm/); assert.equal(storage.writes, writes); assert.equal(store.cached.title, 'Saved');
  mode = 'good'; assert.equal((await store.save(settings('Draft'))).title, 'Draft');
});
test('account changes and destroyed editors reject late reads and writes without caching', async () => {
  const storage = new Storage(), pending = deferred<ProviderHomesSnapshot>(); let current = true;
  const store = new ProviderHomesStore(key, storage, { isCurrent: () => current, load: () => pending.promise, save: async () => { throw new Error('unexpected'); } });
  const loading = store.load(); current = false; pending.resolve({ Revision: '1', Settings: settings('Late') });
  await assert.rejects(loading, error => error instanceof ProviderHomesSyncError && error.kind === 'stale'); assert.equal(storage.writes, 0);
  const server = new Server(), later = deferred<ProviderHomesSnapshot>();
  const editor = new ProviderHomesStore(key, storage, { isCurrent: server.isCurrent, load: server.load.bind(server), save: () => later.promise });
  await editor.load(); const writes = storage.writes, saving = editor.save(settings('Late save')); editor.destroy(); later.resolve({ Revision: '1', Settings: settings('Late save') });
  await assert.rejects(saving, /account changed/); assert.equal(storage.writes, writes);
  server.current = false; const stale = new ProviderHomesStore(key, storage, server); await assert.rejects(stale.load(), /account changed/); await assert.rejects(stale.save(settings('No')), /account changed/); assert.equal(server.writes, 0);
});
test('newest read wins and a pending write excludes concurrent saves or reads', async () => {
  const a = deferred<ProviderHomesSnapshot>(), b = deferred<ProviderHomesSnapshot>(); let calls = 0;
  const storage = new Storage(), store = new ProviderHomesStore(key, storage, { isCurrent: () => true, load: () => ++calls === 1 ? a.promise : b.promise, save: async () => { throw new Error('unexpected'); } });
  const first = store.load(), second = store.load(); b.resolve({ Revision: '2', Settings: settings('New') }); await second;
  a.resolve({ Revision: '1', Settings: settings('Old') }); await assert.rejects(first, /account changed/); assert.equal(store.cached.title, 'New');
  const late = deferred<ProviderHomesSnapshot>(), writer = new ProviderHomesStore(key, storage, { isCurrent: () => true, load: async () => ({ Revision: null, Settings: null }), save: () => late.promise });
  await writer.load(); const saving = writer.save(settings('Pending')); await assert.rejects(writer.save(settings('Duplicate')), /still saving/); await assert.rejects(writer.load(), /still saving/);
  late.resolve({ Revision: '1', Settings: settings('Pending') }); await saving;
});
test('storage failure cannot turn a successful server save into failure, while demo writes report storage failures', async () => {
  const server = new Server(), broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const synced = new ProviderHomesStore(key, broken, server); await synced.load(); assert.equal((await synced.save(settings('Server saved'))).title, 'Server saved');
  const local = new ProviderHomesStore(key, broken); await local.load(); await assert.rejects(local.save(settings('Not saved')), /could not be saved/);
  assert.deepEqual(local.cached, defaultProviderHomes());
});
test('invalid settings and snapshot envelopes are rejected whole before any save operation', async () => {
  const server = new Server(), store = new ProviderHomesStore(key, new Storage(), server); await store.load();
  const invalid = settings('Bad'); invalid.providers[0].enabled = 'false' as any; await assert.rejects(store.save(invalid), /invalid/); assert.equal(server.writes, 0);
  for (const value of [{ Revision: null, Settings: settings('Bad') }, { Revision: '1', Settings: null }, { Revision: '', Settings: settings('Bad') }, { Revision: '1', Settings: settings('Bad'), UserId: 'other' }]) assert.throws(() => providerHomesSnapshot(value), /invalid/);
  const damaged = new Storage(); damaged.setItem(key, '{broken'); assert.deepEqual(new ProviderHomesStore(key, damaged).cached, defaultProviderHomes());
});
test('transport uses current native authentication, preserves conditional revision and never sends a user identifier', async () => {
  const calls: any[] = []; let current = true;
  const transport = createProviderHomesTransport({ getUrl: path => '/base/' + path, getJSON: async url => { calls.push(url); return { Revision: null, Settings: null }; },
    ajax: async options => { calls.push(options); return { Revision: '1', Settings: settings('Draft') }; } }, () => current);
  await transport.load(); await transport.save(settings('Draft'), 'previous');
  assert.equal(calls[0], '/base/TvItemLayout/ProviderHomes'); assert.equal(calls[1].url, calls[0]); assert.equal(calls[1].type, 'PUT');
  assert.deepEqual(Object.keys(JSON.parse(calls[1].data)).sort(), ['Revision', 'Settings']); assert.equal(JSON.parse(calls[1].data).Revision, 'previous');
  current = false; await assert.rejects(transport.load(), /account changed/); await assert.rejects(transport.save(settings('No'), null), /account changed/); assert.equal(calls.length, 2);
});
test('transport translates conflicts, missing endpoints, auth and size failures without concealing them', async () => {
  for (const [status, kind, message] of [[409, 'conflict', /draft/], [401, 'unavailable', /Sign in/], [403, 'unavailable', /Sign in/], [404, 'unavailable', /Update ScreenHarbour/], [413, 'invalid', /too large/], [500, 'unavailable', /could not sync/]] as const) {
    const transport = createProviderHomesTransport({ getUrl: path => path, getJSON: async () => { throw { response: { status } }; }, ajax: async () => { throw { statusCode: status }; } }, () => true);
    for (const operation of [() => transport.load(), () => transport.save(settings('Draft'), null)]) await assert.rejects(operation(), error => error instanceof ProviderHomesSyncError && error.kind === kind && message.test(error.message));
  }
});

test('legacy account settings migrate quietly in cache and only explicit saves publish schema2', async () => {
  const original = defaultProviderHomes(); original.enabled = false; original.providers[0].enabled = false;
  const legacy = { version: 1, enabled: original.enabled, title: 'Saved services', placement: 'end',
    providers: original.providers.slice(0, 6).map(({ id, enabled, hero, rows }) => ({ id, enabled, hero, rows })) };
  const server = new Server(); server.snapshot = { Revision: 'legacy-revision', Settings: legacy } as any;
  const storage = new Storage(); storage.setItem(key, JSON.stringify(legacy));
  const store = new ProviderHomesStore(key, storage, server);
  assert.equal(store.cached.version, 2); assert.equal(store.cached.providers[0].enabled, false);
  const migrated = await store.load(); assert.equal(migrated.providers.length, 9); assert.equal(migrated.enabled, false);
  assert.equal(server.writes, 0); assert.equal(server.snapshot.Settings!.version, 1); assert.equal(JSON.parse(storage.getItem(key)!).version, 2);
  await store.save(migrated); assert.equal(server.writes, 1); assert.equal(server.snapshot.Settings!.version, 2);
});
