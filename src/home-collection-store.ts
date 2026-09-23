import { emptyHomeCollections, homeCollectionKey, parseHomeCollections, type HomeCollectionSettings } from './home-collection-settings';
import type { MediaApi } from './types';

// Leave room for the revision/envelope under the server's 512 KiB request cap.
export const maxHomeSettingsBytes = 512 * 1024 - 1024;
export type HomeCollectionSnapshot = { Revision: string | null; Settings: HomeCollectionSettings | null };
export type HomeCollectionTransport = {
  isCurrent(): boolean;
  load(): Promise<HomeCollectionSnapshot>;
  save(settings: HomeCollectionSettings, revision: string | null): Promise<HomeCollectionSnapshot>;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export class HomeCollectionSyncError extends Error {
  constructor(readonly kind: 'conflict' | 'unavailable' | 'stale' | 'invalid', message: string) { super(message); }
}
export function createHomeCollectionStore(api: MediaApi): HomeCollectionStore {
  const user = api.userId || (window.TvItemLayoutDemo ? 'demo' : 'anonymous');
  const key = homeCollectionKey(api.serverId || location.origin, user);
  return new HomeCollectionStore(key, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    api.homeCollections, [homeCollectionKey(location.origin, user)]);
}
const stale = () => new HomeCollectionSyncError('stale', 'Your Jellyfin account changed. Reopen collection rows for the current account.');
export function boundedHomeSettings(value: unknown): HomeCollectionSettings {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('rows' in value) || !Array.isArray(value.rows)) throw new HomeCollectionSyncError('invalid', 'Jellyfin returned invalid collection-row settings. Try again.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxHomeSettingsBytes)
    throw new HomeCollectionSyncError('invalid', 'These collection rows are too large to sync. Reduce custom item orders and try again.');
  return parseHomeCollections(value);
}
export function homeCollectionSnapshot(value: unknown): HomeCollectionSnapshot {
  const data = value as HomeCollectionSnapshot | null;
  if (data?.Revision === null && data.Settings === null) return { Revision: null, Settings: null };
  if (!data || typeof data.Revision !== 'string' || !data.Revision || data.Revision.length > 100)
    throw new HomeCollectionSyncError('invalid', 'Jellyfin returned invalid collection-row settings. Try again.');
  return { Revision: data.Revision, Settings: boundedHomeSettings(data.Settings) };
}

/** Server revisions protect migration and concurrent editors; local data is only
 * an offline cache once a server copy exists, including an explicitly empty one. */
export class HomeCollectionStore {
  private revision: string | null | undefined;
  private disposed = false;
  private generation = 0;
  private writing = false;
  private value: HomeCollectionSettings;
  private legacy: HomeCollectionSettings;
  readonly synced: boolean;

  constructor(readonly key: string, private storage: StorageLike, private transport?: HomeCollectionTransport,
    legacyKeys: string[] = []) {
    this.synced = !!transport;
    this.legacy = [key, ...legacyKeys].map(key => this.readLocal(key)).find(settings => settings.rows.length) || emptyHomeCollections();
    this.value = this.legacy;
    if (transport) {
      try {
        const raw = storage.getItem(`${key}:synced`);
        if (raw && raw.length <= maxHomeSettingsBytes) this.value = homeCollectionSnapshot(JSON.parse(raw)).Settings || this.legacy;
      } catch { /* Keep the valid legacy cache if the synced cache is damaged. */ }
    } else this.value = this.readLocal(key);
  }
  get cached(): HomeCollectionSettings { return parseHomeCollections(this.value); }
  private readLocal(key: string): HomeCollectionSettings {
    try { const raw = this.storage.getItem(key); return raw && raw.length <= maxHomeSettingsBytes ? boundedHomeSettings(JSON.parse(raw)) : emptyHomeCollections(); }
    catch { return emptyHomeCollections(); }
  }
  private current(generation: number): void {
    if (this.disposed || generation !== this.generation || this.transport && !this.transport.isCurrent()) throw stale();
  }
  private remember(snapshot: HomeCollectionSnapshot): HomeCollectionSettings {
    this.revision = snapshot.Revision;
    this.value = snapshot.Settings || emptyHomeCollections();
    if (snapshot.Settings) {
      // Cache failures cannot turn a completed server save into a failed save.
      try { this.storage.setItem(`${this.key}:synced`, JSON.stringify(snapshot)); this.storage.setItem(this.key, JSON.stringify(this.value)); } catch { /* Server remains authoritative. */ }
      this.legacy = this.value;
    }
    return this.cached;
  }
  async load(): Promise<HomeCollectionSettings> {
    if (this.writing) throw new HomeCollectionSyncError('unavailable', 'Collection rows are still saving. Please wait.');
    const generation = ++this.generation; this.current(generation);
    if (!this.transport) { this.value = this.readLocal(this.key); this.revision = null; return this.cached; }
    let snapshot = homeCollectionSnapshot(await this.transport.load()); this.current(generation);
    if (snapshot.Settings === null && this.legacy.rows.length) {
      // Only a populated old device may migrate. A fresh TV never writes an
      // empty default, and a simultaneous migration must not replace its winner.
      try {
        snapshot = homeCollectionSnapshot(await this.transport.save(this.legacy, null));
        if (snapshot.Settings === null) throw new HomeCollectionSyncError('invalid', 'Jellyfin did not confirm the migrated collection rows. Try again.');
      }
      catch (error) {
        this.current(generation);
        if (!(error instanceof HomeCollectionSyncError) || error.kind !== 'conflict') throw error;
        snapshot = homeCollectionSnapshot(await this.transport.load());
      }
      this.current(generation);
    }
    return this.remember(snapshot);
  }
  async save(value: HomeCollectionSettings): Promise<HomeCollectionSettings> {
    if (this.writing) throw new HomeCollectionSyncError('unavailable', 'Collection rows are still saving. Please wait.');
    const generation = ++this.generation; this.current(generation);
    if (this.revision === undefined) throw new HomeCollectionSyncError('unavailable', 'Load the saved collection rows before saving changes.');
    const settings = boundedHomeSettings(value);
    if (!this.transport) {
      try { this.storage.setItem(this.key, JSON.stringify(settings)); }
      catch { throw new HomeCollectionSyncError('unavailable', 'These settings could not be saved on this device. Check browser storage and try again.'); }
      this.value = settings; return this.cached;
    }
    this.writing = true;
    try {
      const snapshot = homeCollectionSnapshot(await this.transport.save(settings, this.revision)); this.current(generation);
      if (snapshot.Settings === null) throw new HomeCollectionSyncError('invalid', 'Jellyfin did not confirm the saved collection rows. Try again.');
      return this.remember(snapshot);
    } catch (error) {
      if (error instanceof HomeCollectionSyncError && error.kind === 'conflict') this.revision = undefined;
      throw error;
    } finally { this.writing = false; }
  }
  destroy(): void { this.disposed = true; this.generation++; }
}
