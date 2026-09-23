import type { Item, ItemPage, LibraryQuery, MediaApi, PlaybackContext, SuggestionSection } from './types';
import { createBrowseApi } from './browse-api';
import { dispatchPlayback, dispatchTrailerPlayback, type PlaybackClient } from './local-playback';

type Query = Record<string, string | number | boolean>;
type ItemResult = { Items?: Item[]; TotalRecordCount?: number };
type Recommendation = { RecommendationType?: string; BaselineItemName?: string; Items?: Item[] };
interface JellyfinClient extends PlaybackClient {
  getCurrentUserId(): string;
  getItem(userId: string, id: string): Promise<Item>;
  getItems(userId: string, query: Query): Promise<ItemResult>;
  getGenres(userId: string, query: Query): Promise<ItemResult>;
  getUrl(path: string, query?: Query): string;
  getJSON(url: string): Promise<unknown>;
  ajax(options: { type: 'POST'; url: string; dataType?: 'json' }): Promise<unknown>;
  getSeasons(seriesId: string, query: Query): Promise<ItemResult>;
  getEpisodes(seriesId: string, query: Query): Promise<ItemResult>;
  getNextUpEpisodes(query: Query): Promise<ItemResult>;
  getSimilarItems(id: string, query: Query): Promise<ItemResult>;
  getLiveTvChannels(query: Query): Promise<ItemResult>;
  getLiveTvPrograms(query: Query): Promise<ItemResult>;
  updateFavoriteStatus(userId: string, id: string, favorite: boolean): Promise<unknown>;
  getImageUrl(id: string, options: Query): string;
}

declare const ApiClient: JellyfinClient | undefined;

const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const MOVIE_PAGE_SIZE = 60;
const MAX_MOVIE_PAGE_SIZE = 100;

function available(item: Item): boolean {
  return !!item?.Id && item.LocationType !== 'Virtual' && !item.IsMissing
    && !item.IsVirtualItem && !item.IsPlaceHolder && item.PlayAccess !== 'None';
}

function itemsFrom(result: ItemResult, label: string): Item[] {
  if (!result || !Array.isArray(result.Items)) {
    throw new Error(`Jellyfin returned an invalid ${label} list. Open the page again to retry.`);
  }
  return result.Items.filter((item): item is Item => !!item && typeof item.Id === 'string' && !!item.Id);
}

function identity(id: string): string {
  return /^[\da-f]{32}$|^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)
    ? id.replace(/-/g, '').toLowerCase() : id;
}

function movieItems(result: ItemResult, label: string): Item[] {
  return itemsFrom(result, label).filter(item => item.Type === 'Movie' && available(item));
}

function recommendationTitle(category: Recommendation): string {
  const name = typeof category.BaselineItemName === 'string' ? category.BaselineItemName.trim() : '';
  if (!name) return 'Recommended for you';
  switch (category.RecommendationType) {
    case 'SimilarToRecentlyPlayed': return `Because you watched ${name}`;
    case 'SimilarToLikedItem': return `Because you like ${name}`;
    case 'HasDirectorFromRecentlyPlayed': case 'HasLikedDirector': return `Directed by ${name}`;
    case 'HasActorFromRecentlyPlayed': case 'HasLikedActor': return `Starring ${name}`;
    default: return 'Recommended for you';
  }
}

async function pages(fetch: (startIndex: number) => Promise<ItemResult>, label: string,
  stopWhen?: (item: Item) => boolean): Promise<Item[]> {
  const unique = new Map<string, Item>();
  let start = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetch(start);
    const batch = itemsFrom(result, label);
    const count = result.Items!.length;
    const total = Number.isInteger(result.TotalRecordCount) && result.TotalRecordCount! >= 0
      ? result.TotalRecordCount! : null;
    if (!count) {
      if (total !== null && start < total) throw new Error(`Jellyfin returned an incomplete ${label} list. Try again.`);
      return [...unique.values()];
    }
    const before = unique.size;
    for (const item of batch) unique.set(identity(item.Id), item);
    if (unique.size === before) throw new Error(`Jellyfin repeated a ${label} page. Refresh the library and try again.`);
    if (stopWhen && batch.some(stopWhen)) return [...unique.values()];
    start += count;
    if (total !== null ? start >= total : count < PAGE_SIZE) return [...unique.values()];
  }
  throw new Error(`The ${label} list exceeded the browsing limit. Refresh your Jellyfin library and try again.`);
}

function imageFor(client: JellyfinClient, item: Item, kind: 'backdrop' | 'thumb' | 'logo' | 'disc' | 'poster'): string | null {
  let id = item.Id;
  let type: string;
  let tag: string | undefined;
  if (kind === 'poster' && item.ImageTags?.Primary) {
    type = 'Primary';
    tag = item.ImageTags.Primary;
  } else if (kind === 'disc') {
    type = 'Disc';
    tag = item.ImageTags?.Disc;
  } else if (kind === 'logo') {
    const logo = item as Item & { ParentLogoItemId?: string; ParentLogoImageTag?: string };
    type = 'Logo';
    tag = item.ImageTags?.Logo;
    if (!tag && logo.ParentLogoItemId && logo.ParentLogoImageTag) {
      id = logo.ParentLogoItemId;
      tag = logo.ParentLogoImageTag;
    }
  } else if (kind === 'backdrop' && item.BackdropImageTags?.length) {
    type = 'Backdrop';
    tag = item.BackdropImageTags[0];
  } else if (kind === 'backdrop' && item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
    type = 'Backdrop';
    id = item.ParentBackdropItemId;
    tag = item.ParentBackdropImageTags[0];
  } else if (item.ImageTags?.Thumb) {
    type = 'Thumb';
    tag = item.ImageTags.Thumb;
  } else if (item.Type !== 'Episode' && item.BackdropImageTags?.length) {
    type = 'Backdrop';
    tag = item.BackdropImageTags[0];
  } else {
    type = 'Primary';
    tag = item.ImageTags?.Primary;
  }
  if (!id || !tag) return null;
  return client.getImageUrl(id, {
    type, tag, maxWidth: kind === 'backdrop' ? 1920 : kind === 'logo' ? 800 : kind === 'disc' ? 700 : 640, quality: 90
  });
}

/** Reuse the current web client's server and credentials; never store tokens. */
export function createJellyfinApi(): MediaApi | null {
  if (typeof ApiClient === 'undefined' || !ApiClient?.getCurrentUserId?.()) return null;
  const client = ApiClient;
  const userId = client.getCurrentUserId();
  const serverId = client.serverId?.();
  // An adapter belongs to one open detail view; reopening creates a fresh cache.
  const collectionsByItem = new Map<string, Item[]>();
  let collectionRevision = 0;
  const sessionCurrent = () => typeof ApiClient !== 'undefined' && ApiClient === client
    && client.getCurrentUserId() === userId && client.serverId?.() === serverId;
  function assertSession(): void {
    if (!sessionCurrent()) throw new Error('Your Jellyfin account changed. Open the media page again.');
  }
  async function read<T>(action: () => Promise<T>): Promise<T> {
    assertSession();
    try {
      const result = await action();
      assertSession();
      return result;
    } catch (error) {
      const status = (error as { status?: number; statusCode?: number } | null)?.status
        ?? (error as { statusCode?: number } | null)?.statusCode;
      if (status === 401 || status === 403) throw new Error('Sign in to Jellyfin again and check access to this media.');
      if (status === 404) throw new Error('This media is no longer available. Refresh your Jellyfin library.');
      throw error instanceof Error ? error : new Error('Jellyfin could not load this media. Check your connection and try again.');
    }
  }
  const collectionList = (parentId?: string) => read(async () => (await pages(startIndex => read(() => client.getItems(userId, {
    IncludeItemTypes: 'BoxSet', Recursive: true, SortBy: 'SortName', SortOrder: 'Ascending',
    ...(parentId ? {ParentId: parentId} : {}),
    Fields: 'Overview', EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop,Logo',
    EnableUserData: true, StartIndex: startIndex, Limit: PAGE_SIZE
  })), 'collection')).filter(item => item.Type === 'BoxSet'));
  const canManageCollections = () => read(async () => {
    const user = await client.getJSON(client.getUrl(`Users/${encodeURIComponent(userId)}`)) as {
      Id?: string; Policy?: { IsAdministrator?: boolean; EnableCollectionManagement?: boolean }
    } | null;
    if (!user?.Id || identity(user.Id) !== identity(userId) || !user.Policy) {
      throw new Error('Jellyfin could not check collection permissions. Please try again.');
    }
    return user.Policy.IsAdministrator === true || user.Policy.EnableCollectionManagement === true;
  });
  async function changeCollection(path: string, query: Query, json = false): Promise<unknown> {
    if (!await canManageCollections()) throw new Error('This account is not allowed to manage collections.');
    assertSession();
    try {
      // Use the web client's authenticated transport; collection writes have their
      // own CollectionManagement policy, independent of library administration.
      // https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Api/Controllers/CollectionController.cs
      const result = await client.ajax({ type: 'POST', url: client.getUrl(path, query), ...(json ? { dataType: 'json' as const } : {}) });
      assertSession();
      return result;
    } catch (error) {
      assertSession();
      const status = (error as { status?: number; statusCode?: number } | null)?.status
        ?? (error as { statusCode?: number } | null)?.statusCode;
      if (status === 401 || status === 403) throw new Error('This account is not allowed to manage collections. Sign in again or check its permissions.');
      if (status === 404) throw new Error('This collection or title is no longer available. Close the picker and try again.');
      throw error instanceof Error ? error : new Error('Jellyfin could not save the collection. Check your connection and try again.');
    } finally {
      // Also invalidate after ambiguous network failures: the server may have
      // committed the write. An earlier membership scan must not cache stale data.
      collectionRevision++;
      collectionsByItem.clear();
    }
  }
  const libraryPage = (type: 'Movie' | 'Series', options: LibraryQuery): Promise<ItemPage> => read(async () => {
    const label = type === 'Movie' ? 'movie' : 'TV show';
    const start = Number.isFinite(options.startIndex) ? Math.min(2_147_483_647, Math.max(0, Math.trunc(options.startIndex!))) : 0;
    const limit = Number.isFinite(options.limit) ? Math.min(MAX_MOVIE_PAGE_SIZE, Math.max(1, Math.trunc(options.limit!))) : MOVIE_PAGE_SIZE;
    const letter = options.letter?.trim().toUpperCase();
    if (letter && !/^[A-Z#]$/.test(letter)) throw new Error('Choose a letter from A to Z, or #.');
    const search = options.search?.trim();
    const result = await client.getItems(userId, {
      IncludeItemTypes: type, Recursive: true, IsMissing: false, CollapseBoxSetItems: false,
      SortBy: 'SortName,ProductionYear', SortOrder: 'Ascending',
      ...(options.parentId ? { ParentId: options.parentId } : {}),
      ...(search ? { SearchTerm: search } : {}),
      ...(letter === '#' ? { NameLessThan: 'A' } : letter ? { NameStartsWith: letter } : {}),
      ...(options.genreId ? { GenreIds: options.genreId } : {}),
      ...(options.favorite ? { IsFavorite: true } : {}),
      Fields: 'Overview,Genres', EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop,Logo',
      EnableUserData: true, EnableTotalRecordCount: true, StartIndex: start, Limit: limit
    });
    const items = itemsFrom(result, label).filter(item => item.Type === type && available(item));
    const count = result.Items!.length;
    const total = result.TotalRecordCount;
    if (!Number.isSafeInteger(total) || total! < 0 || count > limit
      || (count > 0 && total! < start + count) || (count === 0 && start < total!)) {
      throw new Error(`Jellyfin returned an incomplete ${label} page. Try again.`);
    }
    return { items, total: total!, nextStartIndex: start + count };
  });
  const libraryGenres = (type: 'Movie' | 'Series', parentId?: string) => read(async () => (await pages(startIndex => read(() => client.getGenres(userId, {
    IncludeItemTypes: type, Recursive: true, SortBy: 'SortName', SortOrder: 'Ascending',
    ...(parentId ? { ParentId: parentId } : {}),
    EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop', EnableTotalRecordCount: true,
    StartIndex: startIndex, Limit: PAGE_SIZE
  })), type === 'Movie' ? 'movie genre' : 'TV show genre')).filter(item => item.Type === 'Genre'));
  return {
    ...createBrowseApi(client, userId, read),
    userId,
    serverId: typeof serverId === 'string' && serverId.trim() ? serverId.trim() : undefined,
    getItem: id => read(async () => {
      const item = await client.getItem(userId, id);
      if (!item?.Id || identity(item.Id) !== identity(id)) throw new Error('Jellyfin did not return the requested media.');
      return item;
    }),
    getPlaybackContext: () => read(async () => {
      const result = await client.getJSON(client.getUrl('TvItemLayout/PlaybackContext')) as PlaybackContext | null;
      if (!result) return null;
      if (typeof result.PlayingItemId !== 'string' || !result.PlayingItemId || !Array.isArray(result.Queue)) {
        throw new Error('Jellyfin returned invalid playback information.');
      }
      return { ...result, Queue: result.Queue.filter(entry => entry && typeof entry.Id === 'string' && !!entry.Id) };
    }),
    getMovies: options => libraryPage('Movie', options),
    getMovieGenres: parentId => libraryGenres('Movie', parentId),
    getShows: options => libraryPage('Series', options),
    getShowGenres: parentId => libraryGenres('Series', parentId),
    getShowSuggestions: parentId => read(async () => {
      const scope: Query = parentId ? { ParentId: parentId } : {};
      const artwork: Query = { Fields: 'Overview,Genres', EnableImages: true,
        EnableImageTypes: 'Primary,Thumb,Backdrop,Logo', EnableUserData: true };
      // Jellyfin's TV suggestions are episodes from the user's progress and
      // latest additions. The latest endpoint can group episodes into a series.
      // https://github.com/jellyfin/jellyfin-web/blob/v12.0/src/apps/legacy/controllers/shows/tvrecommended.js
      const [resume, next, latest] = await Promise.all([
        read(() => client.getItems(userId, { ...scope, ...artwork, IncludeItemTypes: 'Episode',
          Recursive: true, IsMissing: false, CollapseBoxSetItems: false, Filters: 'IsResumable',
          SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 12, EnableTotalRecordCount: false })),
        read(() => client.getNextUpEpisodes({ ...scope, ...artwork, UserId: userId, Limit: 24,
          EnableTotalRecordCount: false })),
        read(() => client.getJSON(client.getUrl(`Users/${encodeURIComponent(userId)}/Items/Latest`, {
          ...scope, ...artwork, IncludeItemTypes: 'Episode', Limit: 30
        })))
      ]);
      if (!Array.isArray(latest)) throw new Error('Jellyfin returned invalid TV suggestions. Try again.');
      const episodes = (result: ItemResult, label: string) => itemsFrom(result, label)
        .filter(item => item.Type === 'Episode' && !!item.SeriesId && available(item));
      const sections: SuggestionSection[] = [
        { title: 'Continue watching', items: episodes(resume, 'resumable episode').slice(0, 12) },
        { title: 'Next up', items: episodes(next, 'next episode').slice(0, 24) },
        { title: 'Recently added', items: itemsFrom({ Items: latest }, 'latest TV show')
          .filter(item => available(item) && (item.Type === 'Series' || item.Type === 'Episode' && !!item.SeriesId)).slice(0, 30) }
      ];
      return sections.filter(section => section.items.length > 0);
    }),
    getMovieSuggestions: parentId => read(async () => {
      const scope: Query = parentId ? { ParentId: parentId } : {};
      const artwork: Query = { Fields: 'Overview,Genres', EnableImages: true,
        EnableImageTypes: 'Primary,Thumb,Backdrop,Logo', EnableUserData: true };
      // Match Jellyfin's native movie suggestions: user history, latest additions,
      // and server recommendation categories. Do not invent substitute rankings.
      // https://github.com/jellyfin/jellyfin-web/blob/v12.0/src/apps/legacy/controllers/movies/moviesrecommended.js
      const [resume, latest, recommendations] = await Promise.all([
        read(() => client.getItems(userId, { ...scope, ...artwork, IncludeItemTypes: 'Movie',
          Recursive: true, IsMissing: false, CollapseBoxSetItems: false, Filters: 'IsResumable',
          SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 12, EnableTotalRecordCount: false })),
        read(() => client.getJSON(client.getUrl(`Users/${encodeURIComponent(userId)}/Items/Latest`, {
          ...scope, ...artwork, IncludeItemTypes: 'Movie', Limit: 18, EnableTotalRecordCount: false
        }))),
        read(() => client.getJSON(client.getUrl('Movies/Recommendations', {
          ...scope, ...artwork, UserId: userId, CategoryLimit: 6, ItemLimit: 8
        })))
      ]);
      if (!Array.isArray(latest) || !Array.isArray(recommendations)) {
        throw new Error('Jellyfin returned invalid movie suggestions. Try again.');
      }
      const sections: SuggestionSection[] = [
        { title: 'Continue watching', items: movieItems(resume, 'resumable movie').slice(0, 12) },
        { title: 'Recently added', items: movieItems({ Items: latest }, 'latest movie').slice(0, 18) }
      ];
      for (const value of recommendations.slice(0, 6)) {
        if (!value || typeof value !== 'object') throw new Error('Jellyfin returned invalid movie recommendations. Try again.');
        const category = value as Recommendation;
        sections.push({ title: recommendationTitle(category), items: movieItems(category, 'recommended movie').slice(0, 8) });
      }
      return sections.filter(section => section.items.length > 0);
    }),
    getSeasons: seriesId => read(async () => itemsFrom(await client.getSeasons(seriesId, {
      UserId: userId, IsMissing: false, EnableImages: false, EnableUserData: true
    }), 'season').filter(available).sort((a, b) => (a.IndexNumber ?? Number.MAX_SAFE_INTEGER) - (b.IndexNumber ?? Number.MAX_SAFE_INTEGER))),
    getEpisodes: (seriesId, seasonId) => read(async () => (await pages(startIndex => client.getEpisodes(seriesId, {
      UserId: userId, ...(seasonId ? { SeasonId: seasonId } : {}), Fields: 'Overview',
      IsMissing: false, EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop', EnableUserData: true,
      StartIndex: startIndex, Limit: PAGE_SIZE
    }), 'episode')).filter(item => available(item) && item.Type === 'Episode')
      .sort((a, b) => (a.ParentIndexNumber ?? Number.MAX_SAFE_INTEGER) - (b.ParentIndexNumber ?? Number.MAX_SAFE_INTEGER)
        || (a.IndexNumber ?? Number.MAX_SAFE_INTEGER) - (b.IndexNumber ?? Number.MAX_SAFE_INTEGER)
        || a.Id.localeCompare(b.Id))),
    getNextEpisode: seriesId => read(async () => itemsFrom(await client.getNextUpEpisodes({
      UserId: userId, SeriesId: seriesId, Fields: 'Overview,MediaSourceCount', Limit: 1, EnableUserData: true
    }), 'next episode').find(item => available(item) && item.Type === 'Episode') || null),
    getSimilar: id => read(async () => itemsFrom(await client.getSimilarItems(id, {
      UserId: userId, Limit: 24, Fields: 'Overview,Genres', EnableUserData: true
    }), 'similar item').filter(available)),
    getCollectionList: collectionList,
    canManageCollections,
    addToCollection: (collectionId, itemId) => read(async () => {
      if (!collectionId.trim() || !itemId.trim()) throw new Error('Choose a collection and title first.');
      await changeCollection(`Collections/${encodeURIComponent(collectionId)}/Items`, { ids: itemId });
    }),
    createCollection: (name, itemId) => read(async () => {
      const trimmed = name.trim();
      if (!trimmed || !itemId.trim()) throw new Error('Enter a collection name first.');
      const result = await changeCollection('Collections', { name: trimmed, ids: itemId }, true) as { Id?: string } | null;
      if (typeof result?.Id !== 'string' || !result.Id.trim()) {
        throw new Error('Jellyfin did not confirm the new collection. Close the picker and check Collections before trying again.');
      }
      return { Id: result.Id, Name: trimmed, Type: 'BoxSet' };
    }),
    getCollectionItems: id => read(async () => (await pages(startIndex => read(() => client.getItems(userId, {
      ParentId: id, Recursive: false, CollapseBoxSetItems: false,
      // BoxSet.GetChildren honours the collection's DisplayOrder. Supplying a
      // request sort overrides it in UserViewBuilder.SortAndPage, before paging.
      // https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Controller/Entities/Movies/BoxSet.cs
      Fields: 'Overview,Genres',
      EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop,Logo', EnableUserData: true,
      StartIndex: startIndex, Limit: PAGE_SIZE
    })), 'collection item')).filter(available)),
    getCollections: id => read(async () => {
      const revision = collectionRevision;
      const itemId = identity(id);
      const cached = collectionsByItem.get(itemId);
      if (cached) return cached;
      // ItemsController does not support reverse collection membership:
      // v10.10 discards ParentId for BoxSet queries; v12 treats it as a library
      // ancestor filter. Enumerate user-visible BoxSets and their direct children.
      // Do not combine ParentId with Ids: Folder.GetItems bypasses the folder
      // when Ids is present, incorrectly making every collection appear to match.
      // https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Controller/Entities/Folder.cs
      const collections = await collectionList();
      const matched = new Set<string>();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, collections.length) }, async () => {
        while (next < collections.length) {
          const collection = collections[next++]!;
          const contains = (item: Item) => identity(item.Id) === itemId;
          const children = await pages(startIndex => read(() => client.getItems(userId, {
            ParentId: collection.Id, Recursive: false, CollapseBoxSetItems: false,
            EnableImages: false, EnableUserData: false, StartIndex: startIndex, Limit: PAGE_SIZE
          })), 'collection item', contains);
          if (children.some(contains)) matched.add(identity(collection.Id));
        }
      }));
      const result = collections.filter(collection => matched.has(identity(collection.Id)));
      if (revision === collectionRevision) collectionsByItem.set(itemId, result);
      return result;
    }),
    getChannels: () => read(async () => (await pages(startIndex => client.getLiveTvChannels({
      UserId: userId, AddCurrentProgram: true, Fields: 'Overview,Genres',
      EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop,Logo', EnableUserData: true,
      SortBy: 'ChannelNumber,SortName', SortOrder: 'Ascending', EnableFavoriteSorting: false,
      StartIndex: startIndex, Limit: PAGE_SIZE
    }), 'channel')).filter(item => available(item) && item.Type === 'TvChannel')
      .sort((a, b) => (a.ChannelNumber || a.Number || '').localeCompare(b.ChannelNumber || b.Number || '', undefined, { numeric: true })
        || (a.Name || '').localeCompare(b.Name || '', undefined, { numeric: true }))),
    getPrograms: channelId => read(async () => {
      // Keep the detail-page schedule to the next day, including programmes
      // already airing. Fix the cutoff once so all pages use the same window.
      const maxStartDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return (await pages(startIndex => client.getLiveTvPrograms({
        UserId: userId, ChannelIds: channelId, HasAired: false, MaxStartDate: maxStartDate,
        SortBy: 'StartDate', SortOrder: 'Ascending', Fields: 'Overview,Genres',
        EnableImages: true, EnableUserData: true, StartIndex: startIndex, Limit: PAGE_SIZE
      }), 'programme')).sort((a, b) => Date.parse(a.StartDate || '') - Date.parse(b.StartDate || ''));
    }),
    setFavorite: (id, favorite) => read(async () => { await client.updateFavoriteStatus(userId, id, favorite); }),
    play: (item, ticks, isCurrent) => read(() => dispatchPlayback(client, item, ticks,
      () => isCurrent() && sessionCurrent())),
    playTrailer: (item, isCurrent) => read(() => dispatchTrailerPlayback(client, userId, item,
      () => isCurrent() && sessionCurrent())),
    image: (item, kind) => imageFor(client, item, kind)
  };
}
