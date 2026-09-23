import type { BrowseApi } from './browse-api';

export type Item = {
  Id: string; Name: string; Type?: string; Overview?: string; OriginalTitle?: string;
  CollectionType?: string;
  Artists?: string[]; AlbumArtist?: string; Album?: string; AlbumId?: string;
  IsInProgress?: boolean; Status?: string; MediaType?: string; IsFolder?: boolean;
  ExtraType?: string;
  ProductionYear?: number; OfficialRating?: string; CommunityRating?: number;
  RunTimeTicks?: number; Genres?: string[]; Tags?: string[]; Taglines?: string[];
  LocalTrailerCount?: number; RemoteTrailers?: { Url?: string; Name?: string }[];
  People?: { Name?: string; Type?: string; Role?: string }[];
  IndexNumber?: number; ParentIndexNumber?: number; SeriesId?: string; SeriesName?: string;
  SeasonId?: string; ChildCount?: number; RecursiveItemCount?: number;
  ChannelId?: string; ChannelName?: string; ChannelNumber?: string; Number?: string;
  StartDate?: string; EndDate?: string; CurrentProgram?: Item;
  PremiereDate?: string; LocationType?: string; PlayAccess?: string;
  IsMissing?: boolean; IsVirtualItem?: boolean; IsPlaceHolder?: boolean;
  ImageTags?: Record<string, string>; BackdropImageTags?: string[];
  ParentBackdropItemId?: string; ParentBackdropImageTags?: string[];
  SeriesPrimaryImageTag?: string; MediaStreams?: { Type?: string; Width?: number; DisplayTitle?: string; Language?: string }[];
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean; IsFavorite?: boolean; PlayedPercentage?: number };
};

export type LibraryQuery = {
  parentId?: string; search?: string; letter?: string; genreId?: string;
  favorite?: boolean; startIndex?: number; limit?: number;
};
export type MovieQuery = LibraryQuery;
export type ItemPage = { items: Item[]; total: number; nextStartIndex: number };
export type SuggestionSection = { title: string; items: Item[] };

export type PlaybackContext = {
  PlayingItemId: string;
  PlayingItemType?: string;
  PlayingItemExtraType?: string;
  PlaylistItemId?: string;
  Queue: { Id: string; PlaylistItemId?: string }[];
};

export interface MediaApi extends BrowseApi {
  serverId?: string;
  userId?: string;
  getItem(id: string): Promise<Item>;
  getPlaybackContext?(): Promise<PlaybackContext | null>;
  getMovies(query: MovieQuery): Promise<ItemPage>;
  getMovieGenres(parentId?: string): Promise<Item[]>;
  getMovieSuggestions(parentId?: string): Promise<SuggestionSection[]>;
  getShows(query: LibraryQuery): Promise<ItemPage>;
  getShowGenres(parentId?: string): Promise<Item[]>;
  getShowSuggestions(parentId?: string): Promise<SuggestionSection[]>;
  getSeasons(seriesId: string): Promise<Item[]>;
  getEpisodes(seriesId: string, seasonId: string): Promise<Item[]>;
  getNextEpisode(seriesId: string): Promise<Item | null>;
  getSimilar(id: string): Promise<Item[]>;
  getCollections(itemId: string): Promise<Item[]>;
  getCollectionList(parentId?: string): Promise<Item[]>;
  getCollectionItems(collectionId: string): Promise<Item[]>;
  canManageCollections?(): Promise<boolean>;
  addToCollection?(collectionId: string, itemId: string): Promise<void>;
  createCollection?(name: string, itemId: string): Promise<Item>;
  getChannels(): Promise<Item[]>;
  getPrograms(channelId: string): Promise<Item[]>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  play(item: Item, ticks: number, isCurrent: () => boolean): Promise<void>;
  playTrailer(item: Item, isCurrent: () => boolean): Promise<void>;
  image(item: Item, kind: 'backdrop' | 'thumb' | 'logo' | 'disc' | 'poster'): string | null;
}

declare global {
  interface Window {
    TvItemLayoutDemo?: { api: MediaApi; initialItem: string };
    TvItemLayout?: { refresh(): void; destroy(): void };
  }
}
