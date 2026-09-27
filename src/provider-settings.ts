import { providerBrands, type ProviderBrandId } from './provider-brands';

export const providerRowSources = ['movies', 'shows', 'trending-movies', 'trending-shows', 'collection'] as const;
export const providerItemSorts = ['collection', 'title', 'title-desc', 'newest', 'oldest'] as const;
export type ProviderRowSource = typeof providerRowSources[number];
export type ProviderItemSort = typeof providerItemSorts[number];
export type ProviderRow = { id: string; title: string; source: ProviderRowSource; collectionId: string; enabled: boolean; ranked: boolean; itemSort: ProviderItemSort };
export type ProviderHomeConfig = { id: ProviderBrandId; enabled: boolean; hero: boolean; rows: ProviderRow[] };
export type ProviderHomesSettings = { version: 1; enabled: boolean; title: string; placement: string; providers: ProviderHomeConfig[] };
export const maxProviderRows = 12;
export const maxProviderSettingsBytes = 128 * 1024 - 1024;

export function defaultProviderRows(): ProviderRow[] {
  return [
    { id: 'trending-movies', title: 'Trending films', source: 'trending-movies', collectionId: '', enabled: true, ranked: true, itemSort: 'collection' },
    { id: 'trending-shows', title: 'Trending TV shows', source: 'trending-shows', collectionId: '', enabled: true, ranked: true, itemSort: 'collection' },
    { id: 'movies', title: 'Films', source: 'movies', collectionId: '', enabled: true, ranked: false, itemSort: 'title' },
    { id: 'shows', title: 'TV shows', source: 'shows', collectionId: '', enabled: true, ranked: false, itemSort: 'title' }
  ];
}
export function defaultProviderHomes(): ProviderHomesSettings {
  return { version: 1, enabled: true, title: 'Streaming services', placement: 'start',
    providers: providerBrands.map(({ id }) => ({ id, enabled: true, hero: true, rows: defaultProviderRows() })) };
}
export function providerHomesKey(server: string, user: string): string {
  return `jellyfin-cinema.provider-homes.v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}`;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
const text = (value: unknown, max: number, nonempty = false): value is string => typeof value === 'string' && value.length <= max && (!nonempty || value.length > 0);
const invalid = () => new Error('Jellyfin returned invalid provider-home settings. Try again.');

/** Reject a malformed snapshot in full. Partial repair would silently replace a
 * user's disabled services or row order when another device saves it. */
export function parseProviderHomes(value: unknown): ProviderHomesSettings {
  if (!record(value) || !keys(value, ['version', 'enabled', 'title', 'placement', 'providers']) || value.version !== 1
    || typeof value.enabled !== 'boolean' || !text(value.title, 80) || !text(value.placement, 240)
    || !(['start', 'end'].includes(value.placement) || (value.placement.startsWith('native:') && value.placement.length > 7))
    || !Array.isArray(value.providers) || value.providers.length > providerBrands.length) throw invalid();
  const seen = new Set<string>();
  const providers: ProviderHomeConfig[] = value.providers.map(provider => {
    if (!record(provider) || !keys(provider, ['id', 'enabled', 'hero', 'rows']) || !text(provider.id, 100, true)
      || !providerBrands.some(brand => brand.id === provider.id) || seen.has(provider.id)
      || typeof provider.enabled !== 'boolean' || typeof provider.hero !== 'boolean'
      || !Array.isArray(provider.rows) || provider.rows.length > maxProviderRows) throw invalid();
    seen.add(provider.id);
    const rowIds = new Set<string>();
    const rows: ProviderRow[] = provider.rows.map(row => {
      if (!record(row) || !keys(row, ['id', 'title', 'source', 'collectionId', 'enabled', 'ranked', 'itemSort'])
        || !text(row.id, 100, true) || rowIds.has(row.id) || !text(row.title, 80) || !text(row.collectionId, 199)
        || !providerRowSources.includes(row.source as ProviderRowSource) || !providerItemSorts.includes(row.itemSort as ProviderItemSort)
        || typeof row.enabled !== 'boolean' || typeof row.ranked !== 'boolean') throw invalid();
      rowIds.add(row.id);
      return { id: row.id, title: row.title, source: row.source as ProviderRowSource, collectionId: row.collectionId,
        enabled: row.enabled, ranked: row.ranked, itemSort: row.itemSort as ProviderItemSort };
    });
    return { id: provider.id as ProviderBrandId, enabled: provider.enabled, hero: provider.hero, rows };
  });
  const settings: ProviderHomesSettings = { version: 1, enabled: value.enabled, title: value.title, placement: value.placement, providers };
  if (new TextEncoder().encode(JSON.stringify(settings)).length > maxProviderSettingsBytes) throw invalid();
  return settings;
}
export function cloneProviderHomes(settings: ProviderHomesSettings): ProviderHomesSettings { return parseProviderHomes(settings); }
