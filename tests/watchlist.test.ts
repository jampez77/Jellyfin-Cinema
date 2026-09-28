import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaApi } from '../src/types';
import { getAllWatchlistItems, notifyWatchlistChanged, subscribeWatchlist } from '../src/watchlist.ts';
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });

test('mixed Watchlist rows follow raw continuation offsets, deduplicate and retain movies and whole series', async () => {
  const calls: unknown[] = [];
  const api = { serverId: 'server', userId: 'user', getWatchlist: async (query: unknown) => {
    calls.push(query); return calls.length === 1 ? { items: [{ Id: 'movie', Type: 'Movie', Name: 'Movie' }, { Id: 'episode', Type: 'Episode', Name: 'Episode' }], total: 105, nextStartIndex: 100 }
      : { items: [{ Id: 'movie', Type: 'Movie', Name: 'Movie' }, { Id: 'show', Type: 'Series', Name: 'Show' }], total: 105, nextStartIndex: 105 };
  } } as MediaApi;
  assert.deepEqual((await getAllWatchlistItems(api)).map(item => item.Id), ['movie', 'show']);
  assert.deepEqual(calls, [0, 100].map(startIndex => ({ type: 'All', startIndex, limit: 100, sort: 'collection' })));
});

test('Watchlist rows reject unavailable, incomplete, malformed and account-switched results', async () => {
  await assert.rejects(getAllWatchlistItems({} as MediaApi), /unavailable/i);
  for (const result of [{ items: [], total: 10, nextStartIndex: 0 }, { items: [], total: 10, nextStartIndex: 11 },
    { items: [], total: -1, nextStartIndex: 0 }, { items: [], total: 2.5, nextStartIndex: 1 }, { items: null, total: 0, nextStartIndex: 0 }])
    await assert.rejects(getAllWatchlistItems({ getWatchlist: async () => result } as MediaApi), /watchlist/i);
  const api = { userId: 'one', getWatchlist: async () => { api.userId = 'two'; return { items: [], total: 0, nextStartIndex: 0 }; } } as MediaApi;
  await assert.rejects(getAllWatchlistItems(api), /account changed/i);
});

test('Watchlist notifications refresh only the subscribed current account and stop after disposal', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const api = { serverId: 'server-a', userId: 'user-a' } as MediaApi; let changes = 0;
  const stop = subscribeWatchlist(api, () => changes++);
  notifyWatchlistChanged({ serverId: 'server-a', userId: 'user-b' });
  notifyWatchlistChanged({ serverId: 'server-b', userId: 'user-a' });
  assert.equal(changes, 0);
  notifyWatchlistChanged(api, { ItemId: 'movie', InWatchlist: true }); assert.equal(changes, 1);
  api.userId = 'user-b'; notifyWatchlistChanged({ serverId: 'server-a', userId: 'user-a' }); assert.equal(changes, 1);
  api.userId = 'user-a'; stop(); notifyWatchlistChanged(api); assert.equal(changes, 1);
});
