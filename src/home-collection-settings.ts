import type { Item } from './types';

export const itemSorts = ['collection', 'title', 'title-desc', 'newest', 'oldest', 'custom'] as const;
export type HomeItemSort = typeof itemSorts[number];
export type HomeCollectionTab = { id: string; label: string; collectionId: string; itemSort: HomeItemSort; itemOrder: string[] };
export const maxHomeCollectionTabs = 6;
export type HomeCollectionRow = { id: string; kind: 'collections' | 'items'; title: string; collectionIds: string[]; ranked: boolean;
  placement: string; itemSort: HomeItemSort; itemOrder: string[]; tabs?: HomeCollectionTab[] };
export type HomeCollectionSettings = { version: 1; rows: HomeCollectionRow[] };
export const emptyHomeCollections = (): HomeCollectionSettings => ({ version: 1, rows: [] });

/** Keep preferences bounded and treat local storage as untrusted input. */
export function parseHomeCollections(value: unknown): HomeCollectionSettings {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('rows' in value) || !Array.isArray(value.rows)) return emptyHomeCollections();
  const seen = new Set<string>();
  const rows: HomeCollectionRow[] = [];
  for (const row of value.rows.slice(0, 12)) {
    if (!row || !['collections', 'items'].includes(row.kind) || typeof row.id !== 'string' || !row.id || seen.has(row.id.slice(0, 100))) continue;
    const ids = Array.isArray(row.collectionIds) ? Array.from(new Set<string>(row.collectionIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length < 200))) : [];
    seen.add(row.id.slice(0, 100));
    const itemOrder = Array.isArray(row.itemOrder) ? Array.from(new Set<string>(row.itemOrder.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length < 200))).slice(0, 2000) : [];
    const next: HomeCollectionRow = { id: row.id.slice(0, 100), kind: row.kind, title: typeof row.title === 'string' ? row.title.trim().slice(0, 80) : '', collectionIds: ids.slice(0, row.kind === 'items' ? 1 : 40), ranked: row.kind === 'items' && row.ranked === true,
      placement: typeof row.placement === 'string' && (['start', 'end'].includes(row.placement) || row.placement.startsWith('native:')) ? row.placement.slice(0, 240) : 'end',
      itemSort: itemSorts.includes(row.itemSort) ? row.itemSort : 'collection', itemOrder };
    if (row.kind === 'items' && Array.isArray(row.tabs)) {
      const seenTabs = new Set<string>();
      const tabs: HomeCollectionTab[] = [];
      for (const tab of row.tabs.slice(0, maxHomeCollectionTabs)) {
        if (!tab || typeof tab.id !== 'string' || !tab.id || seenTabs.has(tab.id.slice(0, 100)) || typeof tab.collectionId !== 'string' || tab.collectionId.length >= 200) continue;
        seenTabs.add(tab.id.slice(0, 100));
        tabs.push({ id: tab.id.slice(0, 100), label: typeof tab.label === 'string' ? tab.label.trim().slice(0, 40) : '', collectionId: tab.collectionId,
          itemSort: itemSorts.includes(tab.itemSort) ? tab.itemSort : 'collection',
          itemOrder: Array.isArray(tab.itemOrder) ? Array.from(new Set<string>(tab.itemOrder.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length < 200))).slice(0, 2000) : [] });
      }
      if (tabs.length) {
        next.tabs = tabs;
        // Older clients can still display the first source as a single row.
        next.collectionIds = tabs[0].collectionId ? [tabs[0].collectionId] : [];
        next.itemSort = tabs[0].itemSort; next.itemOrder = tabs[0].itemOrder.slice();
      }
    }
    rows.push(next);
  }
  return { version: 1, rows };
}

/** Existing single-collection rows are also one source, without changing stored preferences. */
export function homeCollectionTabs(row: HomeCollectionRow): HomeCollectionTab[] {
  return row.tabs?.length ? row.tabs : [{ id: 'primary', label: '', collectionId: row.collectionIds[0] || '', itemSort: row.itemSort, itemOrder: row.itemOrder }];
}

export function homeTabLabel(tab: HomeCollectionTab, collection?: Item): string {
  return tab.label.trim() || collection?.Name || 'Collection';
}

export function homeCollectionKey(server: string, user: string): string {
  return `jellyfin-cinema.home-collections.v1:${encodeURIComponent(server)}:${encodeURIComponent(user)}`;
}

/** Ordering is local to a Home row; never mutate shared Jellyfin collection metadata. */
export function orderHomeItems(items: Item[], row: Pick<HomeCollectionRow, 'itemSort' | 'itemOrder'>): Item[] {
  if (row.itemSort === 'collection') return items.slice();
  const positions = new Map(row.itemOrder.map((id, index) => [id, index]));
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    let comparison = 0;
    if (row.itemSort === 'custom') comparison = (positions.get(a.item.Id) ?? Infinity) - (positions.get(b.item.Id) ?? Infinity);
    else if (row.itemSort === 'title' || row.itemSort === 'title-desc') comparison = a.item.Name.localeCompare(b.item.Name, undefined, { numeric: true, sensitivity: 'base' }) * (row.itemSort === 'title-desc' ? -1 : 1);
    else {
      const ay = a.item.ProductionYear, by = b.item.ProductionYear;
      comparison = ay == null ? by == null ? 0 : 1 : by == null ? -1 : (ay - by) * (row.itemSort === 'newest' ? -1 : 1);
    }
    return (Number.isNaN(comparison) ? 0 : comparison) || a.index - b.index;
  }).map(entry => entry.item);
}

// Outlined vector digits: artwork beside the poster, never a title prefix.
const digits = [
  'M42 5C15 5 5 27 5 70s10 65 37 65 37-22 37-65S69 5 42 5ZM42 31c9 0 12 12 12 39s-3 39-12 39-12-12-12-39 3-39 12-39Z',
  'M8 26 37 7h25v126H34V42L8 57Z',
  'M7 40C8 17 23 5 44 5c25 0 37 14 37 35 0 18-10 30-26 46l-21 22h48v25H5v-23l37-41c11-12 14-19 14-27 0-8-4-12-11-12-8 0-12 6-13 16Z',
  'M7 34C12 14 23 5 44 5c24 0 37 13 37 33 0 15-6 24-17 30 13 5 20 15 20 30 0 25-16 37-42 37-22 0-36-11-39-34l26-5c2 11 6 15 14 15 9 0 14-5 14-15 0-11-6-16-20-16h-8V57h8c13 0 18-5 18-15 0-8-4-13-12-13-7 0-11 5-13 13Z',
  'M43 7h31v77h12v25H74v24H48v-24H3V85Zm5 36L25 84h23Z',
  'M12 7h67v25H35l-2 22c5-3 10-4 16-4 22 0 35 16 35 42 0 27-16 43-41 43-23 0-37-12-40-34l27-5c1 10 6 15 13 15 10 0 15-7 15-19 0-12-5-19-14-19-6 0-11 3-14 9L7 76Z',
  'M74 15 62 36c-6-5-11-7-17-7-13 0-19 11-20 31 6-6 13-9 22-9 23 0 36 16 36 40 0 27-16 44-40 44C14 135 2 111 2 74 2 29 17 5 45 5c12 0 21 3 29 10ZM43 75c-10 0-15 6-15 17 0 12 5 18 15 18 9 0 14-6 14-18 0-11-5-17-14-17Z',
  'M4 7h79v22L42 133H13L54 33H4Z',
  'M43 5c24 0 38 13 38 33 0 13-6 23-16 29 13 7 20 17 20 31 0 23-17 37-42 37S1 121 1 98c0-14 7-24 20-31C11 61 5 51 5 38 5 18 19 5 43 5ZM43 29c-8 0-12 5-12 14s4 14 12 14 12-5 12-14-4-14-12-14ZM43 79c-10 0-15 6-15 16s5 16 15 16 15-6 15-16-5-16-15-16Z',
  'M12 125 24 104c6 5 11 7 17 7 13 0 19-11 20-31-6 6-13 9-22 9C16 89 3 73 3 49 3 22 19 5 43 5c29 0 41 24 41 61 0 45-15 69-43 69-12 0-21-3-29-10ZM43 29c-9 0-14 6-14 18 0 11 5 17 14 17 10 0 15-6 15-17 0-12-5-18-15-18Z'
];
export function rankImage(rank: number): string {
  const value = String(Math.max(1, Math.min(999, Math.floor(rank))));
  const paths = [...value].map((digit, index) => `<path transform="translate(${index * 87} 0)" d="${digits[Number(digit)]}"/>`).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${value.length * 87} 140"><g fill="#101116" stroke="#b8bbc6" stroke-width="2.5" fill-rule="evenodd" stroke-linejoin="round">${paths}</g></svg>`)}`;
}
