import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderData, ProviderDataError, type ProviderItemsPage } from '../src/provider-data.ts';
import { providerBrands } from '../src/provider-brands.ts';
import type { ProviderRow } from '../src/provider-settings.ts';
import type { Item, MediaApi } from '../src/types.ts';

const item = (Id: string, Type = 'Movie', Name = Id): Item => ({ Id, Name, Type });
const collection = (Id: string, Name: string): Item => item(Id, 'BoxSet', Name);
const row = (source: ProviderRow['source'], change: Partial<ProviderRow> = {}): ProviderRow => ({ id: source, title: source, source, collectionId: '', enabled: true, ranked: false, itemSort: 'collection', ...change });
const api = (change: Partial<MediaApi> = {}): MediaApi => ({ serverId: 'server', userId: 'alice', getCollectionList: async () => [], getCollectionItems: async () => [], ...change } as MediaApi);
const page = (Items: Item[], change: Partial<ProviderItemsPage> = {}): ProviderItemsPage => ({ Items, TotalRecordCount: Items.length, Pending: 0, Total: Items.length, UpdatedAt: null, Status: 'ready', Region: 'GB', ...change });
const ids = (result: { items: Item[] }) => result.items.map(item => item.Id);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const stale = (error: unknown) => error instanceof ProviderDataError && error.kind === 'stale';

test('full provider library and weekly trending remain distinct sources, with no chart fallback for a missing catalogue API', async () => {
  const source = api({
    getProviderItems: async () => page([item('chart-hit'), item('older-film'), item('new-to-library')]),
    getCollectionList: async () => [collection('chart', 'Netflix — Trending Movies (UK)')],
    getCollectionItems: async () => [item('chart-hit')]
  });
  const data = new ProviderData(source);
  assert.deepEqual(ids(await data.load('netflix', row('movies'))), ['chart-hit', 'older-film', 'new-to-library']);
  const trending = await data.load('netflix', row('trending-movies'));
  assert.deepEqual(ids(trending), ['chart-hit']); assert.match(trending.sourceUrl!, /provider=nfx$/);
  delete source.getProviderItems;
  const unavailable = await data.load('netflix', row('movies'));
  assert.deepEqual(unavailable.items, []); assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.missingSource, undefined);
});

test('catalogue queries isolate provider, media type, sort and page, while retaining partial indexing status', async () => {
  const calls: unknown[] = [];
  const data = new ProviderData(api({
    getProviderItems: async (provider, query) => {
      calls.push({ provider, query });
      return page([item(`${provider}-${query.type}`, query.type)], {
        TotalRecordCount: 82, Total: 430, Pending: 40, MissingIds: 3, FailedIds: 2, Status: 'refreshing', UpdatedAt: '2026-09-27T18:00:00Z'
      });
    },
    getCollectionList: async () => { throw new Error('Catalogue must not inspect chart collections'); }
  }));
  for (const provider of providerBrands) {
    for (const source of ['movies', 'shows'] as const) {
      const result = await data.load(provider.id, row(source, { itemSort: 'newest' }), 60, 20);
      assert.deepEqual(ids(result), [`${provider.id}-${source === 'movies' ? 'Movie' : 'Series'}`]);
      assert.equal(result.total, 82); assert.equal(result.totalToCheck, 430); assert.equal(result.pending, 40);
      assert.equal(result.missingIds, 3); assert.equal(result.failedIds, 2); assert.equal(result.status, 'refreshing');
      assert.equal(result.updatedAt, '2026-09-27T18:00:00Z'); assert.match(result.sourceLabel, /JustWatch via TMDB/);
    }
  }
  assert.deepEqual(calls[0], { provider: 'netflix', query: { type: 'Movie', sort: 'newest', startIndex: 60, limit: 20 } });
  assert.deepEqual(calls[11], { provider: 'paramount', query: { type: 'Series', sort: 'newest', startIndex: 60, limit: 20 } });
});

test('auto charts accept the six installed UK names and keep the saved rank order across filtering and pagination', async () => {
  let listReads = 0;
  const members = [item('rank-one', 'Movie', 'Zulu'), item('rank-two', 'Movie', 'Alpha'), item('rank-two'), item('not-film', 'Series'), item('rank-three')];
  const data = new ProviderData(api({
    getCollectionList: async () => { listReads++; return providerBrands.map(brand => collection(brand.id, `${brand.name} — Trending Movies (UK)`)); },
    getCollectionItems: async () => members
  }));
  for (const brand of providerBrands) {
    const first = await data.load(brand.id, row('trending-movies'), 0, 2), second = await data.load(brand.id, row('trending-movies'), 2, 2);
    assert.deepEqual(ids(first), ['rank-one', 'rank-two']); assert.deepEqual(ids(second), ['rank-three']); assert.equal(first.total, 3);
  }
  assert.equal(listReads, 1); assert.deepEqual(members.map(member => member.Id), ['rank-one', 'rank-two', 'rank-two', 'not-film', 'rank-three']);
});

test('punctuation and case are ignored, Apple TV aliases match, and NOW movies and shows link to their separate UK charts', async () => {
  const data = new ProviderData(api({
    getCollectionList: async () => [collection('apple', 'APPLE TV - TRENDING MOVIES [UK]'), collection('movies', 'now trending movies uk'), collection('shows', 'NOW: Trending Shows (UK)')],
    getCollectionItems: async id => [item(id, id === 'shows' ? 'Series' : 'Movie')]
  }));
  assert.deepEqual(ids(await data.load('apple', row('trending-movies'))), ['apple']);
  assert.match((await data.load('now', row('trending-movies'))).sourceUrl!, /official\/movies\/.*provider=ntc$/);
  assert.match((await data.load('now', row('trending-shows'))).sourceUrl!, /official\/shows\/.*provider=ntv$/);
});

test('missing, wrong-country, approximate and ambiguous chart names never pick a plausible substitute', async () => {
  for (const names of [[], ['Netflix — Trending Movies (US)'], ['Netflix Popular Movies (UK)'], ['Netflix — Trending Movies (UK) archive'], ['Netflix — Trending Movies (UK)', 'Netflix Trending Movies UK']]) {
    let reads = 0;
    const data = new ProviderData(api({ getCollectionList: async () => names.map((name, index) => collection(String(index), name)),
      getCollectionItems: async () => { reads++; return [item('wrong-film')]; } }));
    const result = await data.load('netflix', row('trending-movies'));
    assert.deepEqual(result.items, []); assert.equal(result.missingSource, true); assert.equal(result.status, 'unavailable'); assert.equal(reads, 0);
  }
});

test('duplicate listings of the same collection are not ambiguous, including equivalent Jellyfin GUID formats', async () => {
  const guid = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
  const data = new ProviderData(api({ getCollectionList: async () => [collection(guid, 'Netflix Trending Movies UK'), collection(guid.replace(/-/g, '').toUpperCase(), 'Netflix Trending Movies UK')],
    getCollectionItems: async () => [item('film')] }));
  assert.deepEqual(ids(await data.load('netflix', row('trending-movies'))), ['film']);
});

test('explicit collections keep native ordering, filter media type and deduplicate without pretending to be provider availability', async () => {
  const guid = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
  const raw = [item('show', 'Series'), item('film'), item('episode', 'Episode'), item(guid), item(guid.replace(/-/g, '').toUpperCase()),
    item('a-b'), item('ab'), { ...item('missing'), IsMissing: true }, { ...item('denied'), PlayAccess: 'None' }, { ...item('virtual'), LocationType: 'Virtual' }];
  const data = new ProviderData(api({ getCollectionItems: async id => { assert.equal(id, 'chosen'); return raw; },
    getCollectionList: async () => { throw new Error('Explicit source must not depend on discovery'); },
    getProviderItems: async () => { throw new Error('Explicit collection must not load catalogue'); } }));
  const movies = await data.load('prime', row('movies', { collectionId: 'chosen' }));
  assert.deepEqual(ids(movies), ['film', guid, 'a-b', 'ab']); assert.equal(movies.sourceLabel, 'Selected Jellyfin collection'); assert.equal(movies.sourceUrl, undefined);
  assert.deepEqual(ids(await data.load('prime', row('shows', { collectionId: 'chosen' }))), ['show']);
  assert.deepEqual(ids(await data.load('prime', row('collection', { collectionId: 'chosen' }))), ['show', 'film', guid, 'a-b', 'ab']);
  assert.equal((await data.load('prime', row('collection'))).missingSource, true);
});

test('collection ordering is applied to all members before pagination, including stable year ties and absent years', async () => {
  const raw = [{ ...item('c', 'Movie', 'Charlie'), ProductionYear: 2024 }, { ...item('b', 'Movie', 'Beta'), ProductionYear: 2026 },
    item('z', 'Movie', 'Zulu'), { ...item('a', 'Movie', 'Alpha'), ProductionYear: 2026 }];
  const data = new ProviderData(api({ getCollectionItems: async () => raw }));
  const load = (itemSort: ProviderRow['itemSort'], start = 0) => data.load('disney', row('collection', { collectionId: 'chosen', itemSort }), start, 2);
  assert.deepEqual(ids(await load('title')), ['a', 'b']); assert.deepEqual(ids(await load('title', 2)), ['c', 'z']);
  assert.deepEqual(ids(await load('title-desc')), ['z', 'c']); assert.deepEqual(ids(await load('newest')), ['b', 'a']);
  assert.deepEqual(ids(await load('oldest')), ['c', 'b']); assert.deepEqual(raw.map(value => value.Id), ['c', 'b', 'z', 'a']);
});

test('empty collection reads are cached successfully then expire; refresh invalidation discovers new chart membership', async t => {
  let now = 1_000; t.mock.method(Date, 'now', () => now);
  let listReads = 0, memberReads = 0, list: Item[] = [], members: Item[] = [];
  const data = new ProviderData(api({ getCollectionList: async () => { listReads++; return list; }, getCollectionItems: async () => { memberReads++; return members; } }));
  await data.load('netflix', row('trending-movies')); list = [collection('chart', 'Netflix Trending Movies UK')];
  await data.load('netflix', row('trending-movies')); assert.equal(listReads, 1); assert.equal(memberReads, 0);
  now += 30_001;
  assert.deepEqual(ids(await data.load('netflix', row('trending-movies'))), []); assert.equal(listReads, 2); assert.equal(memberReads, 1);
  members = [item('new-film')]; await data.load('netflix', row('trending-movies')); assert.equal(memberReads, 1);
  data.invalidate(); assert.deepEqual(ids(await data.load('netflix', row('trending-movies'))), ['new-film']); assert.equal(listReads, 3); assert.equal(memberReads, 2);
});

test('failed collection discovery or membership is never cached as an empty success and can immediately retry', async () => {
  let listReads = 0, memberReads = 0;
  const data = new ProviderData(api({
    getCollectionList: async () => { if (++listReads === 1) throw new Error('discovery offline'); return [collection('chart', 'Netflix Trending Movies UK')]; },
    getCollectionItems: async () => { if (++memberReads === 1) throw new Error('members offline'); return [item('found')]; }
  }));
  await assert.rejects(data.load('netflix', row('trending-movies')), /discovery offline/);
  await assert.rejects(data.load('netflix', row('trending-movies')), /members offline/);
  assert.deepEqual(ids(await data.load('netflix', row('trending-movies'))), ['found']); assert.equal(listReads, 2); assert.equal(memberReads, 2);
});

test('concurrent collection rows and catalogue pages share only matching in-flight requests', async () => {
  let listReads = 0, memberReads = 0, catalogueReads = 0;
  const catalogue = deferred<ProviderItemsPage>();
  const data = new ProviderData(api({
    getCollectionList: async () => { listReads++; return [collection('chart', 'Netflix Trending Movies UK')]; },
    getCollectionItems: async () => { memberReads++; return [item('rank-one'), item('rank-two')]; },
    getProviderItems: async () => { catalogueReads++; return catalogue.promise; }
  }));
  const charts = await Promise.all([data.load('netflix', row('trending-movies'), 0, 1), data.load('netflix', row('trending-movies'), 1, 1)]);
  assert.equal(listReads, 1); assert.equal(memberReads, 1); assert.deepEqual(charts.map(ids), [['rank-one'], ['rank-two']]);
  const pages = [data.load('netflix', row('movies')), data.load('netflix', row('movies')), data.load('netflix', row('shows'))];
  await tick(); assert.equal(catalogueReads, 2); catalogue.resolve(page([item('film'), item('show', 'Series')]));
  assert.deepEqual((await Promise.all(pages)).map(ids), [['film'], ['film'], ['show']]);
  await data.load('netflix', row('movies')); assert.equal(catalogueReads, 3);
});

test('catalogue failures and malformed replies retry, while unavailable status retains already known items', async () => {
  let call = 0;
  const data = new ProviderData(api({ getProviderItems: async () => {
    if (++call === 1) throw new Error('catalogue offline');
    if (call === 2) return page([item('wrong-region')], { Region: 'US' as 'GB' });
    return page([item('known-film')], { Status: 'unavailable', Pending: 7, Total: 8 });
  } }));
  await assert.rejects(data.load('netflix', row('movies')), /catalogue offline/);
  await assert.rejects(data.load('netflix', row('movies')), error => error instanceof ProviderDataError && error.kind === 'invalid');
  const result = await data.load('netflix', row('movies')); assert.equal(result.status, 'unavailable'); assert.deepEqual(ids(result), ['known-film']); assert.equal(result.pending, 7);
});

test('invalidation rejects late reads without poisoning a newer request or its cached membership', async () => {
  const late = deferred<Item[]>(); let reads = 0;
  const data = new ProviderData(api({ getCollectionItems: async () => ++reads === 1 ? late.promise : [item('new')] }));
  const loading = data.load('netflix', row('collection', { collectionId: 'chosen' })); await tick(); data.invalidate();
  assert.deepEqual(ids(await data.load('netflix', row('collection', { collectionId: 'chosen' }))), ['new']);
  late.resolve([item('stale')]); await assert.rejects(loading, stale);
  assert.deepEqual(ids(await data.load('netflix', row('collection', { collectionId: 'chosen' }))), ['new']); assert.equal(reads, 2);
});

test('disposal and account changes reject late catalogue replies and prevent further requests or cached data exposure', async () => {
  for (const change of ['destroy', 'user', 'server', 'session'] as const) {
    const late = deferred<ProviderItemsPage>(); let requests = 0, current = true;
    const source = api({ getProviderItems: async () => { requests++; return late.promise; },
      providerHomes: { isCurrent: () => current, load: async () => ({ Revision: null, Settings: null }), save: async () => ({ Revision: null, Settings: null }) } });
    const data = new ProviderData(source), loading = data.load('netflix', row('movies'));
    await tick();
    if (change === 'destroy') data.destroy(); else if (change === 'user') source.userId = 'bob'; else if (change === 'server') source.serverId = 'other'; else current = false;
    late.resolve(page([item('private')])); await assert.rejects(loading, stale);
    await assert.rejects(data.load('netflix', row('movies')), stale); assert.equal(requests, 1);
  }
});

test('page bounds are finite integers and a cancelled queued request never reaches the API', async () => {
  const calls: unknown[] = [];
  const data = new ProviderData(api({ getProviderItems: async (_provider, query) => { calls.push(query); return page([]); } }));
  await data.load('apple', row('movies'), -4, Infinity);
  await data.load('apple', row('shows', { itemSort: 'title-desc' }), 2.8, 10_000);
  assert.deepEqual(calls, [{ type: 'Movie', startIndex: 0, limit: 60, sort: 'title' }, { type: 'Series', startIndex: 2, limit: 100, sort: 'title-desc' }]);
  const loading = data.load('apple', row('movies')); data.destroy(); await assert.rejects(loading, stale); assert.equal(calls.length, 2);
});
