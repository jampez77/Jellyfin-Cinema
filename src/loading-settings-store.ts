import { defaultLoadingScreen, parseLoadingScreen, loadingScreenKey, maxLoadingSettingsBytes, type LoadingScreenSettings } from './loading-settings';
import type { MediaApi } from './types';

export type LoadingScreenSnapshot = { Revision: string | null; Settings: LoadingScreenSettings | null };
export type LoadingScreenTransport = {
  isCurrent(): boolean;
  load(): Promise<LoadingScreenSnapshot>;
  save(settings: LoadingScreenSettings, revision: string | null): Promise<LoadingScreenSnapshot>;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type LoadingScreenListener = (store: LoadingScreenStore, settings: LoadingScreenSettings) => void;
const listeners = new Set<LoadingScreenListener>();
/** Only confirmed reads/saves are published; editor drafts stay private. */
export function subscribeLoadingScreen(listener: LoadingScreenListener): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
function changed(store: LoadingScreenStore): void {
  for (const listener of listeners) { try { listener(store, store.cached); } catch { /* A view cannot fail a confirmed save. */ } }
}
type Client = {
  getUrl(path: string): string;
  getJSON(url: string): Promise<unknown>;
  ajax(options: { type: 'PUT'; url: string; data: string; contentType: 'application/json'; dataType: 'json' }): Promise<unknown>;
};
export class LoadingScreenSyncError extends Error {
  constructor(readonly kind: 'conflict' | 'unavailable' | 'stale' | 'invalid', message: string) { super(message); }
}
const stale = () => new LoadingScreenSyncError('stale', 'Your Jellyfin account changed. Reopen loading screen for the current account.');
export function boundedLoadingScreen(value: unknown): LoadingScreenSettings {
  try { return parseLoadingScreen(value); }
  catch { throw new LoadingScreenSyncError('invalid', 'Jellyfin returned invalid loading-screen settings. Try again.'); }
}
export function loadingScreenSnapshot(value: unknown): LoadingScreenSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !('Revision' in value) || !('Settings' in value))
    throw new LoadingScreenSyncError('invalid', 'Jellyfin returned invalid loading-screen settings. Try again.');
  if (value.Revision === null && value.Settings === null) return { Revision: null, Settings: null };
  if (typeof value.Revision !== 'string' || !value.Revision || value.Revision.length > 100)
    throw new LoadingScreenSyncError('invalid', 'Jellyfin returned invalid loading-screen settings. Try again.');
  return { Revision: value.Revision, Settings: boundedLoadingScreen(value.Settings) };
}

/** Authentication belongs to Jellyfin's native client. The authenticated server
 * session chooses the owner; there is no user-id parameter to impersonate. */
export function createLoadingScreenTransport(client: Client, isCurrent: () => boolean): LoadingScreenTransport {
  const current = () => { if (!isCurrent()) throw stale(); };
  const request = async (operation: () => Promise<unknown>) => {
    current();
    try { const result = await operation(); current(); return loadingScreenSnapshot(result); }
    catch (error) {
      current();
      if (error instanceof LoadingScreenSyncError) throw error;
      const response = error as { status?: number; statusCode?: number; response?: { status?: number } } | null;
      const status = response?.status || response?.statusCode || response?.response?.status;
      if (status === 409) throw new LoadingScreenSyncError('conflict', 'Loading screen changed on another device. Your draft is still here. Reload saved settings before saving again.');
      if (status === 401 || status === 403) throw new LoadingScreenSyncError('unavailable', 'Sign in again to sync loading screen. Your changes have not been saved.');
      if (status === 404) throw new LoadingScreenSyncError('unavailable', 'Update ScreenHarbour on the server to sync loading screen. Your changes have not been saved.');
      if (status === 413) throw new LoadingScreenSyncError('invalid', 'These loading-screen settings are too large to sync. Your changes have not been saved.');
      throw new LoadingScreenSyncError('unavailable', 'Loading screen could not sync with Jellyfin. Check your connection and try again. Your changes have not been saved.');
    }
  };
  return { isCurrent, load: () => request(() => client.getJSON(client.getUrl('TvItemLayout/LoadingScreen'))),
    save: (settings, revision) => request(() => client.ajax({ type: 'PUT', url: client.getUrl('TvItemLayout/LoadingScreen'),
      data: JSON.stringify({ Revision: revision, Settings: boundedLoadingScreen(settings) }), contentType: 'application/json', dataType: 'json' })) };
}

export function createLoadingScreenStore(api: MediaApi & { loadingScreen?: LoadingScreenTransport }): LoadingScreenStore {
  const user = api.userId || (window.TvItemLayoutDemo ? 'demo' : 'anonymous');
  return new LoadingScreenStore(loadingScreenKey(api.serverId || location.origin, user),
    { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, api.loadingScreen);
}

/** Local storage is an account-scoped offline cache. A new server snapshot
 * chooses defaults without saving them, including when an older cache exists. */
export class LoadingScreenStore {
  private revision: string | null | undefined;
  private value: LoadingScreenSettings;
  private disposed = false;
  private generation = 0;
  private writing = false;
  readonly synced: boolean;

  constructor(readonly key: string, private storage: StorageLike, private transport?: LoadingScreenTransport) {
    this.synced = !!transport; this.value = this.readLocal();
  }
  get cached(): LoadingScreenSettings { return boundedLoadingScreen(this.value); }
  private cachedText(): string | null | undefined {
    try { return this.storage.getItem(this.key); } catch { return undefined; }
  }
  private readLocal(): LoadingScreenSettings {
    try {
      const raw = this.storage.getItem(this.key);
      return raw && raw.length <= maxLoadingSettingsBytes ? boundedLoadingScreen(JSON.parse(raw)) : defaultLoadingScreen();
    } catch { return defaultLoadingScreen(); }
  }
  private current(generation: number): void {
    if (this.disposed || generation !== this.generation || this.transport && !this.transport.isCurrent()) throw stale();
  }
  private remember(snapshot: LoadingScreenSnapshot): LoadingScreenSettings {
    this.revision = snapshot.Revision; this.value = snapshot.Settings || defaultLoadingScreen();
    // The server read or save already succeeded even when device storage is full.
    try { this.storage.setItem(this.key, JSON.stringify(this.value)); } catch { /* Server remains authoritative. */ }
    changed(this);
    return this.cached;
  }
  async load(): Promise<LoadingScreenSettings> {
    if (this.writing) throw new LoadingScreenSyncError('unavailable', 'Loading screen are still saving. Please wait.');
    const generation = ++this.generation; this.current(generation);
    // A failed reload must not leave an old revision eligible for a later save.
    this.revision = undefined;
    if (!this.transport) { this.value = this.readLocal(); this.revision = null; changed(this); return this.cached; }
    const before = this.cachedText();
    const response = await this.transport.load(); this.current(generation);
    const snapshot = loadingScreenSnapshot(response), after = this.cachedText();
    // Another store/tab may have confirmed a newer choice while this GET was
    // pending. Reject a differing late result before it can overwrite the cache
    // or notify any interface branding subscribers. Identical reads may coexist.
    if (before !== undefined && after !== undefined && after !== before
      && after !== JSON.stringify(snapshot.Settings || defaultLoadingScreen()))
      throw new LoadingScreenSyncError('conflict', 'Loading screen changed while loading. Reload saved settings.');
    return this.remember(snapshot);
  }
  async save(value: LoadingScreenSettings): Promise<LoadingScreenSettings> {
    if (this.writing) throw new LoadingScreenSyncError('unavailable', 'Loading screen are still saving. Please wait.');
    const generation = ++this.generation; this.current(generation);
    if (this.revision === undefined) throw new LoadingScreenSyncError('unavailable', 'Load the saved loading-screen settings before saving changes.');
    const settings = boundedLoadingScreen(value);
    if (!this.transport) {
      try { this.storage.setItem(this.key, JSON.stringify(settings)); }
      catch { throw new LoadingScreenSyncError('unavailable', 'These settings could not be saved on this device. Check browser storage and try again.'); }
      this.value = settings; changed(this); return this.cached;
    }
    this.writing = true;
    try {
      const response = await this.transport.save(settings, this.revision); this.current(generation);
      const snapshot = loadingScreenSnapshot(response);
      if (!snapshot.Settings) throw new LoadingScreenSyncError('invalid', 'Jellyfin did not confirm the saved loading-screen settings. Try again.');
      return this.remember(snapshot);
    } catch (error) {
      this.current(generation);
      if (error instanceof LoadingScreenSyncError && error.kind === 'conflict') this.revision = undefined;
      throw error;
    } finally { this.writing = false; }
  }
  destroy(): void { this.disposed = true; this.generation++; }
}
