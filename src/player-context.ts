import type { Item, MediaApi, PlaybackContext } from './types';
import { isCinemaLayout } from './layout';

/** Native OSD identity and queue handling follow InPlayerEpisodePreview-TV
 * (jampez77, f61a2d6), distributed under the MIT notice in LICENSE.md. */
export type ActivePlayback = {
  video: HTMLVideoElement; osd: HTMLElement; key: string;
  itemId: string; item: Item | null; playingItemId: string;
  playlistItemId?: string; upcomingItemId?: string; playbackContext?: PlaybackContext;
};
export type PlayerContext = {
  getSnapshot(): ActivePlayback | null;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  destroy(): void;
};

export function sameMediaId(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const normalize = (value: string) => /^[\da-f]{32}$/i.test(value.replace(/-/g, '')) ? value.replace(/-/g, '').toLowerCase() : value;
  return normalize(a) === normalize(b);
}
export function isIntro(item: { Type?: string; ExtraType?: string } | null): boolean {
  return !!item && (item.Type === 'Trailer' || item.Type === 'Video' || item.ExtraType === 'Trailer');
}
export function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], .hide, [aria-hidden="true"]') || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** Never search past an unknown queue entry or guess between repeated intros. */
export async function queuedFeature(context: PlaybackContext, api: MediaApi, current: () => boolean): Promise<Item | null> {
  const queue = context.Queue || [];
  const positions = queue.map((item, index) => ({ item, index })).filter(({ item }) =>
    sameMediaId(item.Id, context.PlayingItemId) && (!context.PlaylistItemId || item.PlaylistItemId === context.PlaylistItemId));
  if (positions.length !== 1) return null;
  const start = positions[0].index + 1;
  for (let index = start; index < Math.min(queue.length, start + 32); index++) {
    const id = queue[index].Id;
    if (!id || !current()) return null;
    let item: Item;
    try { item = await api.getItem(id); } catch { return null; }
    if (!current() || !sameMediaId(item.Id, id)) return null;
    if (isIntro(item)) continue;
    return item.Type === 'Movie' || item.Type === 'Episode' ? item : null;
  }
  return null;
}

export function createPlayerContext(getApi: () => MediaApi | null): PlayerContext {
  let snapshot: ActivePlayback | null = null;
  let destroyed = false;
  let leaving = false;
  let generation = 0;
  let frame: number | undefined;
  let pending = false;
  let lastRequest = 0;
  let nativeKey = '';
  let apiScope = '';
  const listeners = new Set<() => void>();
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const identity = (object: object) => { if (!ids.has(object)) ids.set(object, ++nextId); return ids.get(object); };
  const items = new Map<string, Item>();
  const notify = () => { for (const listener of listeners) listener(); };
  const getItem = async (api: MediaApi, id: string) => {
    const scope = apiScope;
    const revision = generation;
    const cached = items.get(id);
    if (cached) return cached;
    const item = await api.getItem(id);
    if (!sameMediaId(item.Id, id)) throw new Error('The playing item changed.');
    if (scope !== apiScope || revision !== generation || destroyed) return item;
    items.set(id, item);
    if (items.size > 50) items.delete(items.keys().next().value!);
    return item;
  };
  function nativePlayer(): { video: HTMLVideoElement; osd: HTMLElement; itemId: string; key: string } | null {
    if (leaving || !isCinemaLayout()
      || !/(?:^|\/)video\/?(?:\?|$)/i.test(location.hash.replace(/^#/, '') || location.pathname)) return null;
    const osd = Array.from(document.querySelectorAll<HTMLElement>('[data-type="video-osd"], #videoOsdPage')).find(visible);
    if (!osd) return null;
    const video = Array.from(document.querySelectorAll<HTMLVideoElement>('video.htmlvideoplayer')).find(element => {
      if (!visible(element) || element.closest('.tvl-theme-player, [data-theme-video]')) return false;
      if (element.readyState >= 2 && !element.videoWidth && !element.videoHeight) return false;
      // onTop is removed by the native OSD after navigation, so it cannot be
      // required here. The video route and visible OSD exclude detail themes.
      return true;
    });
    if (!video) return null;
    const itemId = osd.querySelector<HTMLElement>('.btnUserRating[data-id]')?.dataset.id || '';
    const source = video.srcObject ? `object:${identity(video.srcObject)}` : video.currentSrc || video.src;
    return { video, osd, itemId, key: `${apiScope}:${identity(video)}:${identity(osd)}:${itemId}:${source}` };
  }
  async function resolve(player: NonNullable<ReturnType<typeof nativePlayer>>, revision: number): Promise<void> {
    const api = getApi();
    if (!api) return;
    pending = true; lastRequest = Date.now();
    const current = () => !destroyed && generation === revision && nativeKey === player.key;
    try {
      let context: PlaybackContext | null = null;
      try { context = await api.getPlaybackContext?.() || null; } catch { /* Native identity still works without session access. */ }
      if (!current()) return;
      const playingItemId = player.itemId || context?.PlayingItemId || '';
      if (!playingItemId) return;
      // A delayed session response may still describe the outgoing item.
      if (context && !sameMediaId(context.PlayingItemId, playingItemId)) context = null;
      let item: Item | null = null;
      try { item = await getItem(api, playingItemId); } catch { /* Deleted trailers may exist only in queue metadata. */ }
      if (!current()) return;
      let upcoming: Item | null = null;
      const intro = isIntro(item) || (!item && !!context && isIntro({ Type: context.PlayingItemType, ExtraType: context.PlayingItemExtraType }));
      if (intro && context) upcoming = await queuedFeature(context, api, current);
      if (!current()) return;
      const resolved = upcoming || item;
      snapshot = { video: player.video, osd: player.osd, key: player.key, playingItemId,
        itemId: resolved?.Id || playingItemId, item: resolved,
        playlistItemId: context?.PlaylistItemId, upcomingItemId: upcoming?.Id, playbackContext: context || undefined };
      notify();
    } finally { if (generation === revision) pending = false; }
  }
  function sync(): void {
    frame = undefined;
    if (destroyed) return;
    const api = getApi();
    const scope = api ? `${api.serverId || ''}:${api.userId || ''}` : '';
    if (!api || apiScope !== scope) {
      apiScope = scope; nativeKey = ''; generation++; pending = false; lastRequest = 0; items.clear();
      if (snapshot) { snapshot = null; notify(); }
      if (!api) return;
    }
    const player = nativePlayer();
    if (!player) {
      if (nativeKey || snapshot) { nativeKey = ''; generation++; snapshot = null; notify(); }
      return;
    }
    if (nativeKey !== player.key) {
      nativeKey = player.key; generation++; pending = false; lastRequest = 0;
      snapshot = player.itemId ? { ...player, playingItemId: player.itemId, item: items.get(player.itemId) || null } : null;
      notify();
    }
    if (!pending && Date.now() - lastRequest > 900) void resolve(player, generation);
  }
  function refresh(): void { if (!destroyed && frame === undefined) frame = requestAnimationFrame(sync); }
  const routeChange = () => { leaving = false; refresh(); };
  const viewHide = (event: Event) => {
    if ((event.target as HTMLElement)?.matches?.('[data-type="video-osd"], #videoOsdPage')) { leaving = true; sync(); }
  };
  const viewShow = (event: Event) => {
    if ((event.target as HTMLElement)?.matches?.('[data-type="video-osd"], #videoOsdPage')) leaving = false;
    refresh();
  };
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id', 'hidden', 'aria-hidden', 'style', 'src'] });
  window.addEventListener('hashchange', routeChange); window.addEventListener('popstate', routeChange);
  document.addEventListener('viewshow', viewShow, true); document.addEventListener('viewbeforehide', viewHide, true);
  const mediaEvents = ['playing', 'pause', 'ended', 'loadeddata', 'emptied', 'error'];
  for (const name of mediaEvents) document.addEventListener(name, refresh, true);
  const interval = window.setInterval(refresh, 1000);
  sync();
  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() {
      destroyed = true; generation++; observer.disconnect(); listeners.clear(); window.clearInterval(interval);
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', routeChange); window.removeEventListener('popstate', routeChange);
      document.removeEventListener('viewshow', viewShow, true); document.removeEventListener('viewbeforehide', viewHide, true);
      for (const name of mediaEvents) document.removeEventListener(name, refresh, true);
      snapshot = null;
    }
  };
}
