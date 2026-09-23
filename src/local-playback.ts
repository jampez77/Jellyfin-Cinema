import type { Item } from './types';

export interface PlaybackClient {
  serverId?(): string;
  serverInfo?(): { Id?: string };
  getLocalTrailers?(userId: string, itemId: string): Promise<Item[]>;
}

type ItemsContainer = HTMLDivElement & { attachedCallback?: () => void };

function sameId(a: string | null | undefined, b: string): boolean {
  return !!a && a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();
}

function currentMoviePage(item: Item): HTMLElement | null {
  if (item.Type !== 'Movie') return null;
  const route = location.hash.replace(/^#/, '') || location.pathname + location.search;
  const [path, query = ''] = route.split('?');
  if (!/(?:^|\/)details\/?$/.test(path) || !sameId(new URLSearchParams(query).get('id'), item.Id)) return null;
  const page = Array.from(document.querySelectorAll<HTMLElement>('.itemDetailPage'))
    .find(element => !element.classList.contains('hide') && !element.hidden);
  if (!page) return null;
  // viewshow starts an asynchronous native reload. Verify its item identity first.
  const identity = page.querySelector<HTMLElement>('.btnUserRating[data-id], .btnPlaystate[data-id]');
  return sameId(identity?.dataset.id, item.Id) ? page : null;
}

function clickNativeButton(page: HTMLElement | null, selector: string): boolean {
  const button = page?.querySelector<HTMLButtonElement>(selector);
  if (!button || button.disabled || button.hidden || button.classList.contains('hide')) return false;
  button.click();
  return true;
}

/** Native buttons retain the current movie's source/audio/subtitle selections. */
function clickCurrentMovie(item: Item, ticks: number): boolean {
  if (ticks > 0 && ticks !== Math.max(0, item.UserData?.PlaybackPositionTicks || 0)) return false;
  const selector = ticks === 0 && (item.UserData?.PlaybackPositionTicks || 0) > 0 ? '.btnReplay' : '.btnPlay';
  return clickNativeButton(currentMoviePage(item), selector);
}

/**
 * Native details delegates to playbackManager.playTrailers, supporting local
 * files and remote metadata. Verified in jellyfin-web v10.10.7/v10.11.0/v12.0:
 * controllers/itemDetails/index.js (under apps/legacy in v12) and
 * components/playback/playbackmanager.js.
 * The card's `playtrailer` shortcut only handles local trailers, so it must not
 * be used as a remote-trailer fallback.
 */
export async function dispatchTrailerPlayback(client: PlaybackClient, userId: string, item: Item,
  isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) throw new DOMException('This media page has closed.', 'AbortError');
  if (item.Type !== 'Movie' || !item.Id || item.PlayAccess === 'None' || item.LocationType === 'Virtual'
    || item.IsMissing || item.IsVirtualItem || item.IsPlaceHolder) {
    throw new Error('This movie is not available to play in your library.');
  }
  if (clickNativeButton(currentMoviePage(item), '.btnPlayTrailer')) return;

  const hasRemote = !!item.RemoteTrailers?.length;
  const unsupported = 'Trailer playback is unavailable in this client. Open Jellyfin’s original details and use its Trailer button.';
  async function nativeRemoteTrailer(): Promise<void> {
    // Native viewshow can finish after the custom detail page. Give its trailer
    // control a bounded chance to catch up without dispatching on a stale page.
    for (let attempt = 0; attempt < 12; attempt++) {
      if (!isCurrent()) throw new DOMException('This media page has closed.', 'AbortError');
      if (clickNativeButton(currentMoviePage(item), '.btnPlayTrailer')) return;
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
    if (!isCurrent()) throw new DOMException('This media page has closed.', 'AbortError');
    if (clickNativeButton(currentMoviePage(item), '.btnPlayTrailer')) return;
    throw new Error(unsupported);
  }
  if (item.LocalTrailerCount === 0) {
    if (hasRemote) return nativeRemoteTrailer();
    throw new Error('No trailer is available for this movie in Jellyfin.');
  }
  if (!client.getLocalTrailers) {
    if (hasRemote) return nativeRemoteTrailer();
    throw new Error(unsupported);
  }
  // Official ApiClient signature, also declared in jellyfin-web's apiclient.d.ts.
  const trailers = await client.getLocalTrailers(userId, item.Id);
  if (!isCurrent()) throw new DOMException('This media page has closed.', 'AbortError');
  if (!Array.isArray(trailers)) throw new Error('Jellyfin returned an invalid trailer list. Open the page again to retry.');
  const trailer = trailers.find(candidate => candidate && typeof candidate.Id === 'string' && candidate.Id
    && !sameId(candidate.Id, item.Id) && candidate.Type === 'Trailer' && candidate.PlayAccess !== 'None'
    && candidate.LocationType !== 'Virtual' && !candidate.IsMissing && !candidate.IsVirtualItem && !candidate.IsPlaceHolder);
  if (!trailer) {
    if (hasRemote) return nativeRemoteTrailer();
    throw new Error('No playable trailer is available for this movie in Jellyfin.');
  }
  try {
    await dispatchPlayback(client, trailer, 0, isCurrent);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Trailer playback could not start in this client. Open Jellyfin’s original details and use its Trailer button.');
  }
}

/**
 * Adapted from InPlayerEpisodePreview-TV's TvLocalPlayback.ts (MIT):
 * https://github.com/jampez77/InPlayerEpisodePreview-TV
 * Copyright notices are retained in LICENSE.md.
 *
 * Jellyfin's playback manager is private, but its registered items container
 * exposes the same local play command used by media cards. A handled command
 * confirms dispatch only; the caller must wait for the playback route to open.
 */
export async function dispatchPlayback(client: PlaybackClient, item: Item, ticks: number,
  isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) throw new DOMException('This media page has closed.', 'AbortError');
  if (!item.Id || item.PlayAccess === 'None' || item.LocationType === 'Virtual'
    || item.IsMissing || item.IsVirtualItem || item.IsPlaceHolder) {
    throw new Error('This item is not available to play in your library.');
  }
  let id = item.Id;
  let type = item.Type;
  if (type === 'Program') {
    const start = Date.parse(item.StartDate || '');
    const end = Date.parse(item.EndDate || '');
    if (!item.ChannelId || !Number.isFinite(start) || !Number.isFinite(end) || Date.now() < start || Date.now() >= end) {
      throw new Error('This programme is not currently live. Open its channel to watch what is on now.');
    }
    id = item.ChannelId;
    type = 'TvChannel';
  }
  if (type !== 'Movie' && type !== 'Episode' && type !== 'TvChannel' && type !== 'Trailer') {
    throw new Error('Choose an available episode, film, trailer, or live channel to play.');
  }
  const position = type === 'TvChannel' || !Number.isFinite(ticks) ? 0 : Math.max(0, Math.trunc(ticks));
  if (clickCurrentMovie(item, position)) return;

  let container: ItemsContainer | undefined;
  try {
    const serverId = client.serverId?.() || client.serverInfo?.()?.Id;
    if (!serverId || !document.body) throw new Error('No active Jellyfin server is available.');
    // Jellyfin's v0 webcomponents polyfill expects a string extension name.
    const create = document.createElement as unknown as (tag: string, extension: string) => ItemsContainer;
    container = create.call(document, 'div', 'emby-itemscontainer');
    container.setAttribute('is', 'emby-itemscontainer');
    container.hidden = true;
    container.setAttribute('aria-hidden', 'true');
    container.setAttribute('data-contextmenu', 'false');
    container.setAttribute('data-multiselect', 'false');
    container.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'itemAction';
    card.dataset.id = id;
    card.dataset.type = type;
    card.dataset.mediatype = 'Video';
    card.dataset.serverid = serverId;
    card.dataset.isfolder = 'false';
    card.dataset.positionticks = String(position);
    container.appendChild(card);
    document.body.appendChild(container);
    // Allow the polyfill's MutationObserver to attach Jellyfin's command handler.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (!isCurrent()) throw new DOMException('This media page has closed.', 'AbortError');
    if (!container.isConnected || typeof container.attachedCallback !== 'function') {
      throw new Error('The Jellyfin playback action is unavailable.');
    }
    container.addEventListener('command', event => event.stopPropagation());
    const command = new CustomEvent('command', {
      detail: { command: 'play' }, bubbles: true, cancelable: true
    });
    card.dispatchEvent(command);
    if (!command.defaultPrevented) throw new Error('Jellyfin did not handle the playback action.');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Playback could not start in this client. Open Jellyfin’s original details and use its Play button.');
  } finally {
    // Jellyfin's detachedCallback removes the bridge's session/shortcut listeners.
    container?.remove();
  }
}
