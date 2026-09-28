import type { Item, MediaApi, WatchlistState } from './types';

const eventName = 'tvl-watchlist-change';
type Account = Pick<MediaApi, 'serverId' | 'userId'>;
type Change = Account & Partial<WatchlistState>;

export function notifyWatchlistChanged(account: Account, state?: WatchlistState): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<Change>(eventName, {
    detail: { serverId: account.serverId, userId: account.userId, ...state }
  }));
}

export function subscribeWatchlist(api: MediaApi, refresh: () => void): () => void {
  const server = api.serverId, user = api.userId;
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<Change>).detail;
    if (detail && detail.serverId === server && detail.userId === user
      && api.serverId === server && api.userId === user) refresh();
  };
  window.addEventListener(eventName, changed);
  return () => window.removeEventListener(eventName, changed);
}

/** Shared rows retain both films and whole series, across every saved page. */
export async function getAllWatchlistItems(api: MediaApi): Promise<Item[]> {
  if (!api.getWatchlist) throw new Error('Watchlist is unavailable. Update ScreenHarbour and try again.');
  const server = api.serverId, user = api.userId;
  const items = new Map<string, Item>();
  let startIndex = 0;
  for (let page = 0; page < 100; page++) {
    const result = await api.getWatchlist({ type: 'All', startIndex, limit: 100, sort: 'collection' });
    if (api.serverId !== server || api.userId !== user) throw new Error('The Jellyfin account changed. Reopen your watchlist.');
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0
      || !Number.isSafeInteger(result.nextStartIndex) || result.nextStartIndex < startIndex
      || result.nextStartIndex > result.total) throw new Error('Jellyfin returned an invalid watchlist page.');
    for (const item of result.items) if (item.Type === 'Movie' || item.Type === 'Series') items.set(item.Id, item);
    if (result.nextStartIndex >= result.total) return [...items.values()];
    if (result.nextStartIndex <= startIndex) throw new Error('Jellyfin returned an incomplete watchlist. Try again.');
    startIndex = result.nextStartIndex;
  }
  throw new Error('Your watchlist could not be loaded completely. Try again.');
}
