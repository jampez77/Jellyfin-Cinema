import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createJellyfinApi } from '../src/api';
import type { Item } from '../src/types';

const saved = new Map<string, PropertyDescriptor | undefined>();
function global(name: string, value: unknown): void {
  if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  saved.clear();
});

function client(overrides: Record<string, unknown> = {}) {
  const value = {
    getCurrentUserId: () => 'user-a', serverId: () => 'server-a',
    getItem: async (_user: string, id: string) => ({ Id: id, Name: id, Type: 'Movie' }),
    ...overrides
  };
  global('ApiClient', value);
  return createJellyfinApi()!;
}
const episode = (id: string, index: number, extra: Partial<Item> = {}): Item => ({
  Id: id, Name: id, Type: 'Episode', SeriesId: 'show', SeasonId: 'season',
  ParentIndexNumber: 1, IndexNumber: index, ...extra
});

test('activation requires a signed-in Jellyfin client', () => {
  global('ApiClient', undefined);
  assert.equal(createJellyfinApi(), null);
  global('ApiClient', { getCurrentUserId: () => '' });
  assert.equal(createJellyfinApi(), null);
});

test('adapter exposes the active Jellyfin server identity for native detail navigation', () => {
  assert.equal(client().serverId, 'server-a');
  assert.equal(client({ serverId: () => 'server-b' }).serverId, 'server-b');
  for (const serverId of [undefined, () => '', () => '   ', () => null]) {
    assert.equal(client({ serverId }).serverId, undefined);
  }
});

test('movie pages send real scoped filters and retain the raw continuation offset', async () => {
  let requestedUser = '';
  let query: Record<string, unknown> = {};
  const api = client({ getItems: async (user: string, options: Record<string, unknown>) => {
    requestedUser = user; query = options;
    return { Items: [
      { Id: 'movie', Name: 'Movie', Type: 'Movie' },
      { Id: 'missing', Name: 'Missing', Type: 'Movie', IsMissing: true },
      { Id: 'blocked', Name: 'Blocked', Type: 'Movie', PlayAccess: 'None' },
      { Id: 'show', Name: 'Show', Type: 'Series' }
    ], TotalRecordCount: 25 };
  } });
  const page = await api.getMovies({ parentId: 'films', search: '  Moon  ', letter: 'm', genreId: 'genre', favorite: true, startIndex: 10, limit: 20 });
  assert.deepEqual(page, { items: [{ Id: 'movie', Name: 'Movie', Type: 'Movie' }], total: 25, nextStartIndex: 14 });
  assert.equal(requestedUser, 'user-a');
  assert.equal(query.ParentId, 'films');
  assert.equal(query.SearchTerm, 'Moon');
  assert.equal(query.NameStartsWith, 'M');
  assert.equal(query.GenreIds, 'genre');
  assert.equal(query.IsFavorite, true);
  assert.equal(query.IncludeItemTypes, 'Movie');
  assert.equal(query.IsMissing, false);
  assert.equal(query.CollapseBoxSetItems, false);
  assert.equal(query.Recursive, true);
  assert.equal(query.StartIndex, 10);
  assert.equal(query.Limit, 20);
  assert.equal(query.EnableTotalRecordCount, true);
});

test('movie pagination bounds requests, maps # to the server alphabet filter, and clears inactive filters', async () => {
  const queries: Record<string, unknown>[] = [];
  const api = client({ getItems: async (_user: string, query: Record<string, unknown>) => {
    queries.push(query);
    return { Items: [], TotalRecordCount: 0 };
  } });
  assert.deepEqual(await api.getMovies({ startIndex: -8, limit: 10000, letter: '#', favorite: false, search: ' ' }), { items: [], total: 0, nextStartIndex: 0 });
  assert.equal(queries[0].StartIndex, 0);
  assert.equal(queries[0].Limit, 100);
  assert.equal(queries[0].NameLessThan, 'A');
  for (const key of ['ParentId', 'IsFavorite', 'SearchTerm', 'NameStartsWith', 'GenreIds']) assert.ok(!(key in queries[0]));
  await api.getMovies({ startIndex: NaN, limit: Infinity });
  assert.equal(queries[1].Limit, 60);
  assert.equal(queries[1].StartIndex, 0);
  assert.ok(!('NameLessThan' in queries[1]));
  await assert.rejects(api.getMovies({ letter: 'Any letter' }), /choose a letter/i);
  assert.equal(queries.length, 2);
});

test('movie pages reject malformed or stalled totals rather than inventing a page count', async () => {
  for (const result of [
    { Items: [], TotalRecordCount: -1 },
    { Items: [], TotalRecordCount: NaN },
    { Items: [], TotalRecordCount: 1.5 },
    { Items: [] },
    { Items: [], TotalRecordCount: 10 },
    { Items: [{ Id: 'movie', Name: 'Movie', Type: 'Movie' }], TotalRecordCount: 0 }
  ]) {
    const api = client({ getItems: async () => result });
    await assert.rejects(api.getMovies({}), /incomplete movie page/i);
  }
  const beyondEnd = client({ getItems: async () => ({ Items: [], TotalRecordCount: 3 }) });
  assert.deepEqual(await beyondEnd.getMovies({ startIndex: 60 }), { items: [], total: 3, nextStartIndex: 60 });
});

test('movie genres paginate within the selected library', async () => {
  const requests: { user: string; query: Record<string, unknown> }[] = [];
  const api = client({ getGenres: async (user: string, query: Record<string, unknown>) => {
    requests.push({ user, query });
    return query.StartIndex === 0
      ? { Items: [{ Id: 'drama', Name: 'Drama', Type: 'Genre' }], TotalRecordCount: 2 }
      : { Items: [{ Id: 'mystery', Name: 'Mystery', Type: 'Genre' }], TotalRecordCount: 2 };
  } });
  assert.deepEqual((await api.getMovieGenres('film-library')).map(item => item.Name), ['Drama', 'Mystery']);
  assert.deepEqual(requests.map(({ query }) => query.StartIndex), [0, 1]);
  assert.ok(requests.every(({ user, query }) => user === 'user-a' && query.ParentId === 'film-library' && query.IncludeItemTypes === 'Movie'));
});

test('movie suggestions preserve native recommendation categories, recent items and user progress', async () => {
  const urls = new Map<string, Record<string, unknown>>();
  const movies = (id: string) => [{ Id: id, Name: id, Type: 'Movie' }];
  let resumeQuery: Record<string, unknown> = {};
  const api = client({
    getItems: async (user: string, query: Record<string, unknown>) => {
      assert.equal(user, 'user-a'); resumeQuery = query;
      return { Items: [{ ...movies('resume')[0], UserData: { PlaybackPositionTicks: 600 } }] };
    },
    getUrl: (path: string, query: Record<string, unknown>) => { urls.set(path, query); return path; },
    getJSON: async (path: string) => path.endsWith('/Latest') ? movies('latest') : [
      { RecommendationType: 'SimilarToRecentlyPlayed', BaselineItemName: 'The Shore', Items: movies('watched') },
      { RecommendationType: 'SimilarToLikedItem', BaselineItemName: 'The Trail', Items: movies('liked') },
      { RecommendationType: 'HasLikedDirector', BaselineItemName: 'Ada Voss', Items: movies('director') },
      { RecommendationType: 'HasActorFromRecentlyPlayed', BaselineItemName: 'Romy Bell', Items: movies('actor') },
      { RecommendationType: 'FutureCategory', BaselineItemName: 'Unknown reason', Items: movies('other') },
      { RecommendationType: 'SimilarToLikedItem', BaselineItemName: 'Empty', Items: [] }
    ]
  });
  const sections = await api.getMovieSuggestions('library');
  assert.deepEqual(sections.map(section => section.title), [
    'Continue watching', 'Recently added', 'Because you watched The Shore', 'Because you like The Trail',
    'Directed by Ada Voss', 'Starring Romy Bell', 'Recommended for you'
  ]);
  assert.equal(sections[0].items[0].UserData?.PlaybackPositionTicks, 600);
  assert.equal(resumeQuery.ParentId, 'library');
  assert.equal(resumeQuery.Filters, 'IsResumable');
  assert.equal(resumeQuery.CollapseBoxSetItems, false);
  assert.ok(urls.has('Users/user-a/Items/Latest'));
  assert.equal(urls.get('Movies/Recommendations')?.UserId, 'user-a');
  assert.ok([...urls.values()].every(query => query.ParentId === 'library'));
});

test('suggestions preserve honest empty results and surface malformed or failed native reads', async () => {
  const base = {
    getItems: async () => ({ Items: [] }), getUrl: (path: string) => path,
    getJSON: async () => []
  };
  assert.deepEqual(await client(base).getMovieSuggestions(), []);
  const malformed = client({ ...base, getJSON: async (path: string) => path.endsWith('/Latest') ? [] : [{ Items: null }] });
  await assert.rejects(malformed.getMovieSuggestions(), /invalid recommended movie list/i);
  const failed = client({ ...base, getJSON: async () => { throw { status: 503 }; } });
  await assert.rejects(failed.getMovieSuggestions(), /could not load/i);
});

test('movie catalogue requests cannot return data after an account change', async () => {
  let user = 'user-a';
  const api = client({
    getCurrentUserId: () => user,
    getItems: async () => { user = 'user-b'; return { Items: [], TotalRecordCount: 0 }; }
  });
  await assert.rejects(api.getMovies({ parentId: 'library' }), /account changed/i);
});

test('episodes retain every available page while excluding missing and blocked entries', async () => {
  const requests: { series: string; query: Record<string, unknown> }[] = [];
  const api = client({ getEpisodes: async (series: string, query: Record<string, unknown>) => {
    requests.push({ series, query });
    return query.StartIndex === 0 ? { Items: [episode('second', 2), episode('missing', 3, { IsMissing: true })], TotalRecordCount: 5 }
      : { Items: [episode('first', 1), episode('second', 2), episode('blocked', 4, { PlayAccess: 'None' })], TotalRecordCount: 5 };
  } });
  assert.deepEqual((await api.getEpisodes('show', 'season')).map(item => item.Id), ['first', 'second']);
  assert.deepEqual(requests.map(request => request.query.StartIndex), [0, 2]);
  assert.ok(requests.every(({ series, query }) => series === 'show' && query.UserId === 'user-a' && query.SeasonId === 'season' && query.EnableUserData === true));
});

test('a repeated episode page fails instead of hanging or silently truncating a show', async () => {
  let requests = 0;
  const api = client({ getEpisodes: async () => {
    requests++;
    return { Items: [episode('one', 1)], TotalRecordCount: 3 };
  } });
  await assert.rejects(api.getEpisodes('show', 'season'), /repeated.*episode/i);
  assert.equal(requests, 2);
});

test('prematurely empty and malformed lists remain errors rather than empty-library states', async () => {
  const incomplete = client({ getEpisodes: async () => ({ Items: [], TotalRecordCount: 2 }) });
  await assert.rejects(incomplete.getEpisodes('show', 'season'), /incomplete/i);
  const malformed = client({ getSeasons: async () => ({ TotalRecordCount: 0 }) });
  await assert.rejects(malformed.getSeasons('show'), /invalid.*season/i);
  const empty = client({ getSeasons: async () => ({ Items: [] }) });
  assert.deepEqual(await empty.getSeasons('show'), []);
});

test('containing collections use paginated direct membership, not an item parent or an Ids query', async () => {
  const requests: { user: string; query: Record<string, unknown> }[] = [];
  const box = (id: string): Item => ({ Id: id, Name: id, Type: 'BoxSet', ImageTags: { Primary: 'art' } });
  const api = client({ getItems: async (user: string, query: Record<string, unknown>) => {
    requests.push({ user, query });
    if (!query.ParentId) return query.StartIndex === 0
      ? { Items: [box('first'), box('unrelated')], TotalRecordCount: 4 }
      : { Items: [box('second'), { Id: 'not-a-collection', Name: 'Movie', Type: 'Movie' }], TotalRecordCount: 4 };
    if (query.ParentId === 'first') return query.StartIndex === 0
      ? { Items: [{ Id: 'other', Name: 'Other', Type: 'Movie' }], TotalRecordCount: 2 }
      : { Items: [{ Id: 'target', Name: 'Target', Type: 'Movie' }], TotalRecordCount: 2 };
    if (query.ParentId === 'second') return { Items: [{ Id: 'target', Name: 'Target', Type: 'Series' }], TotalRecordCount: 1 };
    return { Items: [], TotalRecordCount: 0 };
  } });
  const collections = await api.getCollections('target');
  assert.deepEqual(collections.map(item => item.Id), ['first', 'second']);
  assert.equal(collections[0].ImageTags?.Primary, 'art');
  assert.ok(requests.every(({ user, query }) => user === 'user-a' && !('Ids' in query)));
  const lists = requests.filter(({ query }) => !query.ParentId);
  assert.deepEqual(lists.map(({ query }) => query.StartIndex), [0, 2]);
  assert.ok(lists.every(({ query }) => query.IncludeItemTypes === 'BoxSet' && query.Recursive === true));
  const members = requests.filter(({ query }) => query.ParentId);
  assert.ok(members.every(({ query }) => query.ParentId !== 'target' && query.Recursive === false && query.CollapseBoxSetItems === false));
  assert.deepEqual(members.filter(({ query }) => query.ParentId === 'first').map(({ query }) => query.StartIndex), [0, 1]);
  const count = requests.length;
  assert.deepEqual(await api.getCollections('target'), collections);
  assert.equal(requests.length, count, 'successful membership is cached for this detail view');
});

test('collection scans stop after a match and normalize Jellyfin UUID formats', async () => {
  const compact = 'abcdef1234567890abcdef1234567890';
  const dashed = 'ABCDEF12-3456-7890-ABCD-EF1234567890';
  let membershipRequests = 0;
  const api = client({ getItems: async (_user: string, query: Record<string, unknown>) => {
    if (!query.ParentId) return { Items: [{ Id: 'collection', Name: 'Collection', Type: 'BoxSet' }], TotalRecordCount: 1 };
    membershipRequests++;
    assert.equal(query.StartIndex, 0);
    return { Items: [{ Id: dashed, Name: 'Target', Type: 'Series' }], TotalRecordCount: 2000 };
  } });
  assert.deepEqual((await api.getCollections(compact)).map(item => item.Id), ['collection']);
  assert.deepEqual((await api.getCollections(dashed)).map(item => item.Id), ['collection']);
  assert.equal(membershipRequests, 1);
});

test('collection browser retains every page and applies the native library scope', async () => {
  const queries:Record<string,unknown>[]=[];
  const api=client({getItems:async(user:string,query:Record<string,unknown>)=>{
    assert.equal(user,'user-a');queries.push(query);
    return query.StartIndex===0
      ? {Items:[{Id:'coast',Name:'Coast',Type:'BoxSet'}],TotalRecordCount:2}
      : {Items:[{Id:'mountains',Name:'Mountains',Type:'BoxSet'}],TotalRecordCount:2};
  }});
  assert.deepEqual((await api.getCollectionList('movie-library')).map(item=>item.Id),['coast','mountains']);
  assert.deepEqual(queries.map(query=>query.StartIndex),[0,1]);
  assert.ok(queries.every(query=>query.ParentId==='movie-library'&&query.IncludeItemTypes==='BoxSet'&&query.Recursive===true));
});

test('collection contents preserve mixed and nested members without collapsing or flattening them', async () => {
  const queries:Record<string,unknown>[]=[];
  const api=client({getItems:async(_user:string,query:Record<string,unknown>)=>{
    queries.push(query);
    return query.StartIndex===0
      ? {Items:[{Id:'movie',Name:'Movie',Type:'Movie'},{Id:'nested',Name:'Nested',Type:'BoxSet'}],TotalRecordCount:5}
      : {Items:[{Id:'show',Name:'Show',Type:'Series'},{Id:'track',Name:'Track',Type:'Audio'},{Id:'missing',Name:'Missing',IsMissing:true}],TotalRecordCount:5};
  }});
  assert.deepEqual((await api.getCollectionItems('collection')).map(item=>item.Id),['movie','nested','show','track']);
  assert.ok(queries.every(query=>query.ParentId==='collection'&&query.Recursive===false&&query.CollapseBoxSetItems===false&&!query.IncludeItemTypes&&!query.Ids));
});

test('a failed collection read does not return or cache a partial membership list', async () => {
  let fail = true;
  let lists = 0;
  const api = client({ getItems: async (_user: string, query: Record<string, unknown>) => {
    if (!query.ParentId) {
      lists++;
      return { Items: ['first', 'second'].map(id => ({ Id: id, Name: id, Type: 'BoxSet' })), TotalRecordCount: 2 };
    }
    if (query.ParentId === 'second' && fail) throw new Error('Collection is unavailable');
    return { Items: [{ Id: 'target', Name: 'Target' }], TotalRecordCount: 1 };
  } });
  await assert.rejects(api.getCollections('target'), /collection is unavailable/i);
  fail = false;
  assert.deepEqual((await api.getCollections('target')).map(item => item.Id), ['first', 'second']);
  assert.equal(lists, 2);
});

test('collection pagination stops if the signed-in account changes during a member request', async () => {
  let user = 'user-a';
  let memberRequests = 0;
  const api = client({
    getCurrentUserId: () => user,
    getItems: async (_user: string, query: Record<string, unknown>) => {
      if (!query.ParentId) return { Items: [{ Id: 'collection', Name: 'Collection', Type: 'BoxSet' }], TotalRecordCount: 1 };
      memberRequests++;
      user = 'user-b';
      return { Items: [{ Id: 'other', Name: 'Other' }], TotalRecordCount: 2 };
    }
  });
  await assert.rejects(api.getCollections('target'), /account changed/i);
  assert.equal(memberRequests, 1);
});

test('collection membership requests use bounded concurrency', async () => {
  let active = 0;
  let peak = 0;
  let inspected = 0;
  const api = client({ getItems: async (_user: string, query: Record<string, unknown>) => {
    if (!query.ParentId) return {
      Items: Array.from({ length: 9 }, (_, index) => ({ Id: `collection-${index}`, Name: 'Collection', Type: 'BoxSet' })),
      TotalRecordCount: 9
    };
    active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    inspected++; active--;
    return { Items: [], TotalRecordCount: 0 };
  } });
  assert.deepEqual(await api.getCollections('target'), []);
  assert.equal(inspected, 9);
  assert.ok(peak > 1 && peak <= 4, `expected between two and four concurrent requests, got ${peak}`);
});

test('channels paginate, retain programme data, and sort channel numbers numerically', async () => {
  const requests: Record<string, unknown>[] = [];
  const programme = { Id: 'programme', Name: 'News', Type: 'Program' };
  const api = client({ getLiveTvChannels: async (query: Record<string, unknown>) => {
    requests.push(query);
    return query.StartIndex === 0
      ? { Items: [{ Id: 'ten', Name: 'Ten', Type: 'TvChannel', ChannelNumber: '10' }], TotalRecordCount: 2 }
      : { Items: [{ Id: 'two', Name: 'Two', Type: 'TvChannel', ChannelNumber: '2', CurrentProgram: programme }], TotalRecordCount: 2 };
  } });
  const channels = await api.getChannels();
  assert.deepEqual(channels.map(item => item.Id), ['two', 'ten']);
  assert.equal(channels[0].CurrentProgram, programme);
  assert.ok(requests.every(query => query.AddCurrentProgram === true && query.UserId === 'user-a'));
  assert.deepEqual(requests.map(query => query.StartIndex), [0, 1]);
});

test('guide includes currently airing programmes and bounds downloads to one day', async () => {
  const requests: Record<string, unknown>[] = [];
  const before = Date.now();
  const api = client({ getLiveTvPrograms: async (query: Record<string, unknown>) => {
    requests.push(query);
    return query.StartIndex === 0
      ? { Items: [{ Id: 'later', Name: 'Later', StartDate: '2026-09-22T13:00:00Z' }], TotalRecordCount: 2 }
      : { Items: [{ Id: 'now', Name: 'Now', StartDate: '2026-09-22T12:00:00Z' }], TotalRecordCount: 2 };
  } });
  assert.deepEqual((await api.getPrograms('channel')).map(item => item.Id), ['now', 'later']);
  const cutoff = Date.parse(String(requests[0].MaxStartDate));
  assert.ok(cutoff >= before + 86_400_000 && cutoff <= Date.now() + 86_400_000);
  assert.equal(requests[0].MaxStartDate, requests[1].MaxStartDate);
  assert.ok(requests.every(query => query.ChannelIds === 'channel' && query.HasAired === false && !('MinStartDate' in query)));
});

test('account changes invalidate in-flight results and prevent subsequent favorite writes', async () => {
  let user = 'user-a';
  let resolveItem!: (item: Item) => void;
  let writes = 0;
  const api = client({
    getCurrentUserId: () => user,
    getItem: () => new Promise<Item>(resolve => { resolveItem = resolve; }),
    updateFavoriteStatus: async () => { writes++; }
  });
  const pending = api.getItem('movie');
  user = 'user-b';
  resolveItem({ Id: 'movie', Name: 'Movie' });
  await assert.rejects(pending, /account changed/i);
  await assert.rejects(api.setFavorite('movie', true), /account changed/i);
  assert.equal(writes, 0);
});

test('access and missing-item failures have actionable messages', async () => {
  for (const [status, message] of [[401, /sign in/i], [403, /access/i], [404, /no longer available/i]] as const) {
    const api = client({ getItem: async () => { throw { status }; } });
    await assert.rejects(api.getItem('movie'), message);
  }
  const api = client({ getItem: async () => ({ Id: 'different', Name: 'Other movie' }) });
  await assert.rejects(api.getItem('movie'), /requested media/i);
});

test('missing optional images and empty next-up remain valid states', async () => {
  const images: { id: string; query: Record<string, unknown> }[] = [];
  const api = client({
    getNextUpEpisodes: async () => ({ Items: [] }),
    getImageUrl: (id: string, query: Record<string, unknown>) => { images.push({ id, query }); return '/image'; }
  });
  assert.equal(await api.getNextEpisode('show'), null);
  assert.equal(api.image({ Id: 'movie', Name: 'Movie' }, 'logo'), null);
  assert.equal(api.image({ Id: 'ep', Name: 'Episode', ParentBackdropItemId: 'show', ParentBackdropImageTags: ['tag'] }, 'backdrop'), '/image');
  assert.equal(images[0].id, 'show');
  assert.equal(images[0].query.type, 'Backdrop');
});

function nativePage(identity: string | (() => string), options: { routeId?: string; hiddenButton?: boolean; expectedSelector?: string } = {}) {
  let clicked = 0;
  const button = {
    disabled: false, hidden: !!options.hiddenButton,
    classList: { contains: () => false }, click: () => { clicked++; }
  };
  global('location', { hash: `#/details?id=${options.routeId || 'movie'}`, pathname: '/', search: '' });
  global('document', {
    body: {},
    querySelectorAll: () => [{
      hidden: false, classList: { contains: () => false },
      querySelector: (selector: string) => selector.includes('[data-id]')
        ? { dataset: { id: typeof identity === 'function' ? identity() : identity } }
        : options.expectedSelector && selector !== options.expectedSelector ? null : button
    }],
    createElement: () => { throw new Error('No playback bridge in this fixture'); }
  });
  return () => clicked;
}

test('current movie uses native Play only after native item identity has caught up', async () => {
  const clicks = nativePage('movie');
  const api = client();
  await api.play({ Id: 'movie', Name: 'Movie', Type: 'Movie' }, 0, () => true);
  assert.equal(clicks(), 1);
});

test('stale native details, another route, and unavailable native buttons cannot report successful dispatch', async () => {
  const movie: Item = { Id: 'movie', Name: 'Movie', Type: 'Movie' };
  for (const scenario of [{ id: 'previous' }, { id: 'movie', routeId: 'other' }, { id: 'movie', hiddenButton: true }]) {
    const clicks = nativePage(scenario.id, scenario);
    const api = client();
    await assert.rejects(api.play(movie, 0, () => true), /original details/i);
    assert.equal(clicks(), 0);
  }
});

test('closed pages, unavailable media, and future programmes never dispatch playback', async () => {
  const clicks = nativePage('movie');
  const api = client();
  await assert.rejects(api.play({ Id: 'movie', Name: 'Movie', Type: 'Movie' }, 0, () => false), { name: 'AbortError' });
  await assert.rejects(api.play({ Id: 'movie', Name: 'Movie', Type: 'Movie', PlayAccess: 'None' }, 0, () => true), /not available/i);
  await assert.rejects(api.play({
    Id: 'programme', Name: 'Future', Type: 'Program', ChannelId: 'channel',
    StartDate: new Date(Date.now() + 60_000).toISOString(), EndDate: new Date(Date.now() + 120_000).toISOString()
  }, 0, () => true), /not currently live/i);
  assert.equal(clicks(), 0);
});

function bridgePage(options: { handled?: boolean; registered?: boolean } = {}) {
  const commands: { command: unknown; data: Record<string, string> }[] = [];
  const containers: BridgeElement[] = [];
  class BridgeElement {
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    isConnected = false;
    removed = false;
    parent?: BridgeElement;
    attachedCallback?: () => void;
    setAttribute() { /* Attributes do not affect the command contract in this fixture. */ }
    appendChild(child: BridgeElement) { child.parent = this; }
    addEventListener() { /* Native command handling is emulated by dispatchEvent. */ }
    dispatchEvent(event: CustomEvent) {
      commands.push({ command: event.detail.command, data: { ...this.dataset } });
      if (options.handled !== false) event.preventDefault();
      return !event.defaultPrevented;
    }
    remove() { this.isConnected = false; this.removed = true; }
  }
  global('location', { hash: '#/details?id=movie', pathname: '/', search: '' });
  global('document', {
    querySelectorAll: () => [],
    body: { appendChild: (element: BridgeElement) => { element.isConnected = true; } },
    createElement: (_tag: string, extension?: string) => {
      const element = new BridgeElement();
      if (extension === 'emby-itemscontainer') {
        if (options.registered !== false) element.attachedCallback = () => {};
        containers.push(element);
      }
      return element;
    }
  });
  return { commands, containers };
}

const movie: Item = { Id: 'movie', Name: 'Movie', Type: 'Movie' };

test('movie trailers use the native Trailer control for local and remote sources', async () => {
  for (const metadata of [{ LocalTrailerCount: 1 }, { LocalTrailerCount: 0, RemoteTrailers: [{ Url: 'https://www.youtube.com/watch?v=abc' }] }]) {
    const clicks = nativePage('movie', { expectedSelector: '.btnPlayTrailer' });
    const api = client({ getLocalTrailers: async () => { throw new Error('Native trailer should own source selection'); } });
    await api.playTrailer({ ...movie, ...metadata }, () => true);
    assert.equal(clicks(), 1);
  }
});

test('remote trailer waits for the native item identity before clicking its Trailer control', async () => {
  let nativeIdentity = 'previous-movie';
  const clicks = nativePage(() => nativeIdentity, { expectedSelector: '.btnPlayTrailer' });
  const pending = client().playTrailer({ ...movie, LocalTrailerCount: 0, RemoteTrailers: [{ Url: 'https://www.youtube.com/watch?v=abc' }] }, () => true);
  assert.equal(clicks(), 0);
  nativeIdentity = 'movie';
  await pending;
  assert.equal(clicks(), 1);
});

test('local trailer fallback fetches with the active user and plays the actual trailer from its start', async () => {
  const bridge = bridgePage();
  const requests: string[][] = [];
  const api = client({ getLocalTrailers: async (user: string, id: string) => {
    requests.push([user, id]);
    return [
      { Id: 'missing-trailer', Type: 'Trailer', IsMissing: true },
      { Id: 'movie', Type: 'Trailer' },
      { Id: 'trailer', Name: 'Official trailer', Type: 'Trailer', UserData: { PlaybackPositionTicks: 8000 } }
    ];
  } });
  await api.playTrailer({ ...movie, LocalTrailerCount: 2 }, () => true);
  assert.deepEqual(requests, [['user-a', 'movie']]);
  assert.equal(bridge.commands.length, 1);
  assert.deepEqual(bridge.commands[0], {
    command: 'play', data: { id: 'trailer', type: 'Trailer', mediatype: 'Video', serverid: 'server-a', isfolder: 'false', positionticks: '0' }
  });
  assert.ok(bridge.containers.every(container => container.removed));
});

test('unavailable, malformed, and denied trailers produce useful errors without playback', async () => {
  const bridge = bridgePage();
  await assert.rejects(client().playTrailer({ ...movie, LocalTrailerCount: 0, RemoteTrailers: [] }, () => true), /no trailer is available/i);
  await assert.rejects(client({ getLocalTrailers: async () => [] }).playTrailer(movie, () => true), /no playable trailer/i);
  await assert.rejects(client({ getLocalTrailers: async () => ({ Items: [] }) }).playTrailer(movie, () => true), /invalid trailer list/i);
  await assert.rejects(client({ getLocalTrailers: async () => { throw { status: 403 }; } }).playTrailer(movie, () => true), /sign in/i);
  assert.equal(bridge.commands.length, 0);
});

test('remote metadata never dispatches the local-only playtrailer shortcut or opens an external URL', async () => {
  const bridge = bridgePage();
  let externalOpens = 0;
  global('window', { open: () => { externalOpens++; } });
  const api = client({ getLocalTrailers: async () => { throw new Error('Known remote-only movie must not fetch local trailers'); } });
  await assert.rejects(api.playTrailer({ ...movie, LocalTrailerCount: 0, RemoteTrailers: [{ Url: 'javascript:alert(1)' }] }, () => true), /original details.*Trailer button/i);
  assert.equal(bridge.commands.length, 0);
  assert.equal(externalOpens, 0);
});

test('trailer dispatch does not succeed when the registered playback bridge is unavailable or unhandled', async () => {
  for (const options of [{ registered: false }, { handled: false }]) {
    const bridge = bridgePage(options);
    const api = client({ getLocalTrailers: async () => [{ Id: 'trailer', Type: 'Trailer' }] });
    await assert.rejects(api.playTrailer(movie, () => true), /original details/i);
    assert.ok(bridge.containers.every(container => container.removed));
  }
});

test('page cancellation and account changes during trailer lookup prevent dispatch', async () => {
  for (const changeAccount of [false, true]) {
    const bridge = bridgePage();
    let user = 'user-a';
    let current = true;
    let resolveTrailers!: (items: Item[]) => void;
    const api = client({
      getCurrentUserId: () => user,
      getLocalTrailers: () => new Promise<Item[]>(resolve => { resolveTrailers = resolve; })
    });
    const pending = api.playTrailer(movie, () => current);
    if (changeAccount) user = 'user-b';
    else current = false;
    resolveTrailers([{ Id: 'trailer', Name: 'Trailer', Type: 'Trailer' }]);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(bridge.commands.length, 0);
    assert.equal(bridge.containers.length, 0);
  }
});

test('closed pages and inaccessible movies cannot click native Trailer controls', async () => {
  const clicks = nativePage('movie', { expectedSelector: '.btnPlayTrailer' });
  const api = client();
  await assert.rejects(api.playTrailer(movie, () => false), { name: 'AbortError' });
  await assert.rejects(api.playTrailer({ ...movie, PlayAccess: 'None' }, () => true), /not available/i);
  await assert.rejects(api.playTrailer({ ...movie, Type: 'Episode' }, () => true), /movie is not available/i);
  assert.equal(clicks(), 0);
});
