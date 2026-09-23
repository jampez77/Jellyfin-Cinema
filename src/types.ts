export type Item = {
  Id: string; Name: string; Type?: string; Overview?: string; OriginalTitle?: string;
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

export interface MediaApi {
  getItem(id: string): Promise<Item>;
  getSeasons(seriesId: string): Promise<Item[]>;
  getEpisodes(seriesId: string, seasonId: string): Promise<Item[]>;
  getNextEpisode(seriesId: string): Promise<Item | null>;
  getSimilar(id: string): Promise<Item[]>;
  getChannels(): Promise<Item[]>;
  getPrograms(channelId: string): Promise<Item[]>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  play(item: Item, ticks: number, isCurrent: () => boolean): Promise<void>;
  playTrailer(item: Item, isCurrent: () => boolean): Promise<void>;
  image(item: Item, kind: 'backdrop' | 'thumb' | 'logo'): string | null;
}

declare global {
  interface Window {
    TvItemLayoutDemo?: { api: MediaApi; initialItem: string };
    TvItemLayout?: { refresh(): void; destroy(): void };
  }
}
