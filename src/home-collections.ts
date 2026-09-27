import type { Item, MediaApi } from './types';
import { button, el, replace } from './dom';
import { emptyHomeCollections, orderHomeItems, homeCollectionTabs, homeTabLabel, type HomeCollectionRow } from './home-collection-settings';
import { createHomeCollectionStore, type HomeCollectionStore } from './home-collection-store';
import { nativeHomeRows, rememberHomeRows } from './home-row-placement';
import { homeRowCard } from './home-row-card';
import { homeRowTabs } from './home-row-tabs';
import { HomeReadiness } from './home-readiness';
import { createProviderHomesStore, type ProviderHomesStore } from './provider-settings-store';
import type { ProviderHomesSettings, ProviderId } from './provider-settings';
import { providerHomeRow } from './provider-home';
import { isDesktopLayout } from './layout';

type RenderedRow = { row: Pick<HomeCollectionRow, 'id' | 'placement'>; element: HTMLElement; reconcileSource: () => Promise<void> };
type StagedRows = { revision: number; inputRevision: number; sourceRevision?: number; sections?: RenderedRow[]; error?: HTMLElement; retry?: boolean };
type CollectionItems = { promise: Promise<Item[]>; fingerprint?: string; value?: Item[] };
type HomeSnapshot = { key: string; collections?: Item[]; items: Map<string, { value: Item[]; fingerprint: string }>; sources: Map<string, string> };
// Reuse successful data, never DOM handlers or promises owned by a disposed view.
// Only the last account is retained, in memory, until sign-out/server change.
let lastHome: HomeSnapshot | undefined;
export function clearHomeSession(): void { lastHome = undefined; }

// Native Home is DOM-cached. Its controller can attempt Back restoration while
// the initial row batch is masked, so remember its last native target by account.
const nativeReturnFocus = new WeakMap<HTMLElement, { key: string; element: HTMLElement }>();
type NativeScroller = HTMLElement & { getScrollPosition?(): number; scrollToPosition?(position: number, immediate: boolean): void };
type HomePosition = {
  vertical: { element: HTMLElement; top: number; left: number }[];
  rows: Map<string, { left: number; position?: number }[]>;
  focusId?: string; nativeFocus?: HTMLElement;
};
// Session-only, bounded and account-scoped. Native node references are checked
// again on return; custom rows are resolved by their stable saved identifiers.
const homePositions = new Map<string, HomePosition>();

function loadingCinema(): HTMLElement {
  const status = el('div', 'tvl-home-loading-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-label', 'Loading Home');
  const art = el('div', 'tvl-home-loading-projector'); art.setAttribute('aria-hidden', 'true');
  art.append(el('div', 'tvl-home-loading-beam'));
  for (const side of ['left', 'right']) {
    const reel = el('div', `tvl-home-loading-reel tvl-home-loading-reel-${side}`);
    for (let index = 0; index < 3; index++) reel.append(el('i'));
    art.append(reel);
  }
  art.append(el('div', 'tvl-home-loading-camera'), el('div', 'tvl-home-loading-lens'), el('div', 'tvl-home-loading-foot'));
  const copy = el('div', 'tvl-home-loading-copy');
  copy.append(el('span', 'tvl-home-loading-brand', 'JELLYFIN CINEMA'), el('span', 'tvl-home-loading-label', 'Preparing your cinema'));
  const dots = el('span', 'tvl-home-loading-dots'); dots.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index++) dots.append(el('i'));
  status.append(art, copy, dots); return status;
}

function showingHome(host = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab')): boolean {
  // Home and Favourites share a route/controller. A body-level status must
  // follow the actual selected tab, even while hidden Home rows keep loading.
  return host ? !host.closest('.hide,[hidden],[aria-hidden="true"]') && host.getClientRects().length > 0
    : new URLSearchParams(location.hash.split('?')[1] || '').get('tab') !== '1';
}

/** Insert owned rows between native Home rows without moving or rebuilding them. */
export class HomeCollections {
  private root = el('div', 'tvl-home-collections');
  private sections: RenderedRow[] = [];
  private staged?: StagedRows;
  private preparing?: StagedRows;
  private selectedSources = new Map<string, string>();
  private sourceRevision = 0;
  private displayedRevision = 0;
  private readiness = new HomeReadiness(() => this.attach());
  private settings = emptyHomeCollections();
  private key: string;
  private store: HomeCollectionStore;
  private syncing = false;
  private lastSync = 0;
  private syncTimer?: number;
  private observer: MutationObserver;
  private disposed = false;
  private revision = 0;
  private inputRevision = 0;
  private renderRetry = false;
  private items = new Map<string, CollectionItems>();
  private collections?: Item[];
  private collectionRequest?: Promise<Item[]>;
  private warmReturn = false;
  private providers: ProviderHomesSettings;
  private providerStore: ProviderHomesStore;
  private initialSettingsReady = false;
  private initialPaint = false;
  private loadingHost?: HTMLElement;
  private previousBusy: string | null = null;
  private loadingStatus = loadingCinema();
  private loadingTimer?: number;
  private restoreFrame?: number;
  private captureFrame?: number;
  private positionToRestore?: HomePosition;
  private nativePositionToRestore?: HomePosition;
  private lastPosition?: HomePosition;
  private accountIdentity: string;
  private providerSyncing = false;
  private providerLastSync = 0;
  private providerRefreshPending = false;

  constructor(private api: MediaApi, private navigate: (id: string) => void, private restoreFocus?: string,
    private openProvider?: (id: ProviderId) => void) {
    this.store = createHomeCollectionStore(api); this.key = this.store.key; this.settings = this.store.cached;
    this.providerStore = createProviderHomesStore(api); this.providers = this.providerStore.cached;
    const cached = lastHome?.key === this.key ? lastHome : undefined;
    if (cached) {
      this.warmReturn = true; this.collections = cached.collections || [];
      this.selectedSources = new Map(cached.sources);
      for (const [id, entry] of cached.items) this.items.set(id, { ...entry, promise: Promise.resolve(entry.value) });
    }
    this.initialSettingsReady = this.warmReturn || !this.store.synced && !this.providerStore.synced;
    this.accountIdentity = JSON.stringify([api.serverId, api.userId]);
    this.positionToRestore = homePositions.get(this.key);
    if (this.warmReturn) this.nativePositionToRestore = this.positionToRestore;
    if (!this.warmReturn) {
      if (showingHome()) document.body.append(this.loadingStatus);
      this.loadingTimer = window.setTimeout(() => { if (!this.loadingHost) this.loadingStatus.remove(); }, 3_500);
    }
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('command', this.onCommand, true);
    window.addEventListener('pointerdown', this.onPointer, true);
    window.addEventListener('focusin', this.rememberNativeFocus, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('click', this.rememberPosition, true);
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
    window.addEventListener('storage', this.onProviderStorage);
    window.addEventListener('tvl-provider-settings-changed', this.onProviderSaved);
    window.addEventListener('focus', this.onVisible); document.addEventListener('visibilitychange', this.onVisible);
    document.addEventListener('viewshow', this.onNativeShow, true);
    this.observer = new MutationObserver(records => {
      // Native row order can change without replacing a node. Ignore scroller
      // transform updates so animated TV focus does not keep reattaching rows.
      if (records.some(record => record.attributeName !== 'style'
        || (record.target as Element).matches('.verticalSection, .ec-root, .homeSectionsContainer, #homeTab'))) this.attach();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-busy'] });
    this.attach(); void this.render();
    if (this.store.synced || this.providerStore.synced) {
      this.syncTimer = window.setInterval(this.onVisible, 60_000);
    }
    if (this.warmReturn || this.store.synced || this.providerStore.synced) void this.loadInitialSettings();
  }

  /** Fetch both preferences in parallel and publish a single initial row set.
   * Cached members may already be loading, but cannot appear before a fresh
   * device knows which provider and collection rows belong to this account. */
  private async loadInitialSettings(): Promise<void> {
    this.syncing = this.store.synced; this.providerSyncing = this.providerStore.synced;
    this.lastSync = this.providerLastSync = Date.now();
    await Promise.all([
      this.store.synced ? this.store.load().then(settings => {
        if (this.disposed) return;
        const changed = JSON.stringify(settings) !== JSON.stringify(this.settings); this.settings = settings;
        if (changed) void this.render();
      }).catch(() => {}).finally(() => { this.syncing = false; }) : Promise.resolve(),
      this.providerStore.synced ? this.providerStore.load().then(settings => {
        if (this.disposed) return;
        const changed = JSON.stringify(settings) !== JSON.stringify(this.providers); this.providers = settings;
        if (changed) void this.render();
      }).catch(() => {}).finally(() => {
        this.providerSyncing = false;
        if (this.providerRefreshPending) return this.refreshProviders(true);
      }) : Promise.resolve(),
      this.warmReturn ? this.refreshCollectionData().then(changed => { if (changed && !this.disposed) void this.render(); }) : Promise.resolve()
    ]);
    if (this.disposed) return;
    this.initialSettingsReady = true; this.attach();
  }

  private holdInitialHome(host: HTMLElement): void {
    if (this.initialPaint || this.warmReturn) return;
    if (this.loadingHost !== host) {
      this.releaseInitialHome(); this.loadingHost = host; this.previousBusy = host.getAttribute('aria-busy');
      host.setAttribute('aria-busy', 'true');
    }
    if (!host.classList.contains('tvl-home-initial-loading')) host.classList.add('tvl-home-initial-loading');
    // A native page can be transformed or scrolled. Its fixed descendants are
    // not viewport-fixed, so the animation always belongs directly to body.
    if (!showingHome(host)) this.loadingStatus.remove();
    else if (this.loadingStatus.parentElement !== document.body) document.body.append(this.loadingStatus);
  }
  private releaseInitialHome(): void {
    const host = this.loadingHost;
    if (host) {
      host.classList.remove('tvl-home-initial-loading');
      if (host.getAttribute('aria-busy') === 'true') {
        if (this.previousBusy === null) host.removeAttribute('aria-busy'); else host.setAttribute('aria-busy', this.previousBusy);
      }
    }
    this.loadingStatus.remove(); this.loadingHost = undefined; window.clearTimeout(this.loadingTimer);
  }

  private rememberNativeFocus = (): void => {
    const host = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    const active = document.activeElement;
    if (host && active instanceof HTMLElement && host.contains(active)
      && !active.closest('.tvl-home-collection-row, .tvl-home-provider-row, .tvl-home-collections')) {
      nativeReturnFocus.set(host, { key: this.key, element: active });
    }
    this.rememberPosition();
  };

  private positionRows(host: HTMLElement): { key: string; elements: NativeScroller[] }[] {
    return [...nativeHomeRows(host).map(row => ({ key: row.key,
      elements: Array.from(row.element.querySelectorAll<NativeScroller>('.emby-scroller, .itemsContainer')) })),
    ...this.sections.map(section => ({ key: `owned:${section.row.id}`,
      elements: Array.from(section.element.querySelectorAll<NativeScroller>('.tvl-home-row-cards')) }))];
  }
  private rememberPosition = (): void => {
    const host = this.root.parentElement;
    if (this.disposed || !this.initialPaint || !host || !/^#\/?home(?:\/?\?|\/?$)/i.test(location.hash)
      || JSON.stringify([this.api.serverId, this.api.userId]) !== this.accountIdentity
      || this.api.homeCollections && !this.api.homeCollections.isCurrent() || this.api.providerHomes && !this.api.providerHomes.isCurrent()
      || host.closest('.hide,[hidden]') || !host.getClientRects().length || getComputedStyle(host).visibility === 'hidden') return;
    const owners = new Set<HTMLElement>();
    if (document.scrollingElement instanceof HTMLElement) owners.add(document.scrollingElement);
    for (let element: HTMLElement | null = host; element; element = element.parentElement) {
      if (element.scrollTop || /auto|scroll/.test(getComputedStyle(element).overflowY)) owners.add(element);
    }
    const active = document.activeElement as HTMLElement | null;
    this.lastPosition = {
      vertical: [...owners].map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })),
      rows: new Map(this.positionRows(host).map(({ key, elements }) => [key, elements.map(element => {
        const position = element.getScrollPosition?.(); return { left: element.scrollLeft, ...(Number.isFinite(position) ? { position } : {}) };
      })])),
      focusId: active && host.contains(active) ? active.dataset.focusId : undefined,
      nativeFocus: active && host.contains(active) && !this.owns(active) ? active : undefined
    };
  };
  private restorePosition(host: HTMLElement): void {
    const saved = this.positionToRestore;
    if (!saved || this.displayedRevision !== this.revision || !showingHome(host)) return;
    const active = document.activeElement;
    if (this.inputRevision || active !== document.body && !host.contains(active)) { this.positionToRestore = undefined; return; }
    this.positionToRestore = undefined;
    const target = saved.focusId ? Array.from(host.querySelectorAll<HTMLElement>('[data-focus-id]')).find(node => node.dataset.focusId === saved.focusId)
      : saved.nativeFocus?.isConnected && host.contains(saved.nativeFocus) ? saved.nativeFocus : undefined;
    if (target && !target.closest('.hide,[hidden]') && target.getClientRects().length
      && getComputedStyle(target).visibility !== 'hidden' && !target.matches(':disabled')) target.focus({ preventScroll: true });
    const apply = () => {
      for (const { key, elements } of this.positionRows(host)) elements.forEach((element, index) => {
        const position = saved.rows.get(key)?.[index]; if (!position) return;
        if (position.position !== undefined && element.scrollToPosition) element.scrollToPosition(position.position, true);
        element.scrollLeft = position.left;
      });
      for (const { element, top, left } of saved.vertical) if (element.isConnected) {
        // Defeat an optional native smooth-scroll rule for this one restoration.
        const behavior = element.style.scrollBehavior; element.style.scrollBehavior = 'auto';
        element.scrollTop = top; element.scrollLeft = left; element.style.scrollBehavior = behavior;
      }
    };
    apply();
    // Native focus centering may finish in the next animation frame. Restore
    // once more, then leave scrolling entirely to the user/native controllers.
    const inputRevision = this.inputRevision;
    this.restoreFrame = requestAnimationFrame(() => {
      this.restoreFrame = undefined;
      if (!this.disposed && inputRevision === this.inputRevision && (document.activeElement === document.body || host.contains(document.activeElement))) apply();
    });
  }
  private onScroll = (): void => {
    if (this.captureFrame !== undefined) return;
    this.captureFrame = requestAnimationFrame(() => { this.captureFrame = undefined; this.rememberPosition(); });
  };
  private onNativeShow = (event: Event): void => {
    const host = this.root.parentElement, page = event.target;
    if (!this.nativePositionToRestore || !host || !(page instanceof HTMLElement) || !page.contains(host)) return;
    const saved = this.nativePositionToRestore; this.nativePositionToRestore = undefined;
    // Jellyfin unhides its cached view, then auto-focuses it before viewshow.
    // Restore once after that native step; real input always takes priority.
    if (!this.inputRevision && showingHome(host)) { this.positionToRestore = saved; this.restorePosition(host); }
  };
  private onWheel = (): void => { this.inputRevision++; this.positionToRestore = undefined; };

  private onVisible = (event?: Event): void => {
    // Returning to an open Home must not be skipped by the polling throttle.
    if (document.visibilityState !== 'hidden') void this.refreshSettings(!!event);
  };
  private onProviderStorage = (event: StorageEvent): void => {
    if (event.storageArea === localStorage && event.key === this.providerStore.key) void this.refreshProviders(true);
  };
  private onProviderSaved = (event: Event): void => {
    const account = (event as CustomEvent).detail;
    if (account && account.serverId === this.api.serverId && account.userId === this.api.userId) void this.refreshProviders(true);
  };
  private async refreshProviders(force: boolean): Promise<void> {
    if (this.disposed || JSON.stringify([this.api.serverId, this.api.userId]) !== this.accountIdentity
      || !force && (!this.providerStore.synced || Date.now() - this.providerLastSync < 5_000)) return;
    // A save may finish while the initial/polling read is still in flight.
    // Queue another read so that older response cannot swallow the notification.
    if (this.providerSyncing) { this.providerRefreshPending ||= force; return; }
    this.providerRefreshPending = false;
    this.providerSyncing = true; this.providerLastSync = Date.now();
    let changed = false;
    try {
      const settings = await this.providerStore.load();
      if (this.disposed) return;
      changed ||= JSON.stringify(settings) !== JSON.stringify(this.providers);
      this.providers = settings;
    } catch { /* Home keeps its account-scoped cache when sync is unavailable. */ }
    finally { this.providerSyncing = false; }
    if (this.disposed) return;
    // Do not leave a confirmed save waiting behind collection artwork fetches.
    if (this.providerRefreshPending) void this.refreshProviders(true);
    if (changed) await this.render();
  }
  async refreshSettings(force = false): Promise<void> {
    void this.refreshProviders(force);
    if (this.disposed || !this.store.synced || this.syncing || !force && Date.now() - this.lastSync < 5_000) return;
    this.syncing = true; this.lastSync = Date.now();
    try {
      const settings = await this.store.load(); if (this.disposed) return;
      const settingsChanged = JSON.stringify(settings) !== JSON.stringify(this.settings);
      this.settings = settings;
      const membersChanged = await this.refreshItems();
      if (this.disposed || !this.api.homeCollections?.isCurrent()) return;
      if (settingsChanged || membersChanged || this.renderRetry) {
        const active = document.activeElement as HTMLElement | null;
        if (this.owns(active)) this.restoreFocus = active?.dataset.focusId;
        await this.render(true);
      }
    } catch {
      // Background sync stays quiet on Home and preserves the last loaded rows.
      // The editor still reports load/save failures so unsaved edits are clear.
    } finally { this.syncing = false; }
  }

  private collectionItems(id: string): Promise<Item[]> {
    let cached = this.items.get(id);
    if (!cached) {
      const entry: CollectionItems = { promise: this.api.getCollectionItems(id).then(items => {
        entry.fingerprint = JSON.stringify(items); entry.value = items; return items;
      }).catch(error => { if (this.items.get(id) === entry) this.items.delete(id); throw error; }) };
      this.items.set(id, entry); cached = entry;
    }
    return cached.promise;
  }

  private collectionList(refresh = false): Promise<Item[]> {
    if (!refresh && this.collections) return Promise.resolve(this.collections);
    if (this.collectionRequest) return this.collectionRequest;
    const request = Promise.resolve().then(() => this.api.getCollectionList()).then(items => {
      if (!this.disposed) this.collections = items;
      return items;
    }).finally(() => { if (this.collectionRequest === request) this.collectionRequest = undefined; });
    this.collectionRequest = request; return request;
  }
  private async refreshCollectionData(): Promise<boolean> {
    const before = JSON.stringify(this.collections);
    const [listChanged, membersChanged] = await Promise.all([
      // A first row may have been added on another device while Home was away.
      // Fetch alongside preferences even when the old settings had no rows.
      this.collectionList(true).then(items => JSON.stringify(items) !== before).catch(() => false),
      this.refreshItems()
    ]);
    return listChanged && this.settings.rows.length > 0 || membersChanged;
  }

  private async refreshItems(): Promise<boolean> {
    // Membership and source order can change without a settings revision (for
    // example after SmartLists refreshes). Revalidate visited sources quietly;
    // keep successful data during failures and leave unchanged DOM/focus alone.
    const sources = new Set(this.settings.rows.filter(row => row.kind === 'items').flatMap(row => homeCollectionTabs(row).map(tab => tab.collectionId)));
    let changed = false;
    await Promise.all(Array.from(this.items, async ([id, entry]) => {
      if (!sources.has(id)) { this.items.delete(id); return; }
      if (entry.fingerprint === undefined) return;
      try {
        const items = await this.api.getCollectionItems(id);
        if (this.disposed || this.api.homeCollections && !this.api.homeCollections.isCurrent() || this.items.get(id) !== entry) return;
        const fingerprint = JSON.stringify(items);
        if (fingerprint === entry.fingerprint) return;
        this.items.set(id, { promise: Promise.resolve(items), fingerprint, value: items }); changed = true;
      } catch { /* Keep the last successfully loaded members until a later poll. */ }
    }));
    return changed;
  }

  private attach(): void {
    if (this.disposed) return;
    const host = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    if (!host) return;
    this.holdInitialHome(host);
    let staged = this.staged;
    if (staged?.sections && staged.sourceRevision !== this.sourceRevision) {
      void this.prepare(staged); staged = undefined;
    }
    const initialRowsReady = this.initialSettingsReady && !!staged && staged.revision === this.revision;
    if (this.warmReturn ? !this.initialPaint && !initialRowsReady : !this.readiness.update(host, this.initialPaint || initialRowsReady)) return;
    if (this.root.parentElement !== host) host.append(this.root);
    let focusId: string | undefined;
    let focusRow: string | undefined;
    let movedFocus: HTMLElement | undefined;
    if (staged && staged.revision === this.revision) {
      this.staged = undefined;
      if (staged.sections) {
        const active = document.activeElement as HTMLElement | null;
        focusId = this.owns(active) ? active?.dataset.focusId : staged.inputRevision === this.inputRevision ? this.restoreFocus : undefined;
        if (this.owns(active)) focusRow = active?.closest<HTMLElement>('[data-home-row]')?.dataset.homeRow;
        this.restoreFocus = undefined;
        const positions = new Map(this.sections.map(section => [section.row.id, section.element.querySelector<HTMLElement>('.tvl-home-row-cards')?.scrollLeft || 0]));
        this.sections.forEach(section => section.element.remove());
        this.sections = staged.sections; this.displayedRevision = staged.revision;
        this.renderRetry = !!staged.retry;
        for (const section of this.sections) {
          const cards = section.element.querySelector<HTMLElement>('.tvl-home-row-cards');
          if (cards) cards.dataset.restoreScroll = String(positions.get(section.row.id) || 0);
        }
        const ids = new Set(this.sections.map(section => section.row.id));
        for (const id of this.selectedSources.keys()) if (!ids.has(id)) this.selectedSources.delete(id);
      }
      // An error keeps the mounted rows, including focused end-position rows.
      // Only replace status children; clearing root would detach those rows.
      for (const child of Array.from(this.root.children)) if (!this.sections.some(section => section.element === child)) child.remove();
      if (staged.error) this.root.append(staged.error);
    }
    const anchors = nativeHomeRows(host);
    rememberHomeRows(this.key, anchors);
    // Process backwards so rows that share an insertion point keep their order.
    const nextAt = new Map<HTMLElement, HTMLElement>();
    for (const { row, element } of this.sections.slice().reverse()) {
      const anchor = row.placement === 'start' ? anchors[0] : anchors.find(anchor => anchor.key === row.placement);
      const point = anchor?.element || this.root;
      const target = nextAt.get(point) || anchor?.element;
      const parent = target?.parentElement || this.root;
      // DOM adjacency alone is insufficient in a CSS-ordered native Home.
      // Share the anchor's order so insertBefore is also visually before it.
      const order = anchor ? getComputedStyle(anchor.element).order : '';
      if (element.style.order !== order) element.style.order = order;
      if (target) {
        if (element.parentElement !== parent || element.nextElementSibling !== target) {
          if (element.contains(document.activeElement)) movedFocus = document.activeElement as HTMLElement;
          parent.insertBefore(element, target);
        }
      } else if (element.parentElement !== parent || element !== parent.lastElementChild) {
        if (element.contains(document.activeElement)) movedFocus = document.activeElement as HTMLElement;
        parent.append(element);
      }
      nextAt.set(point, element);
      const cards = element.querySelector<HTMLElement>('.tvl-home-row-cards');
      if (cards?.dataset.restoreScroll !== undefined) { cards.scrollLeft = Number(cards.dataset.restoreScroll); delete cards.dataset.restoreScroll; }
    }
    // Commit and position every owned row before revealing either row family.
    // Readiness has a bounded fallback, so an unavailable source cannot trap Home.
    const firstPaint = !this.initialPaint;
    this.initialPaint = true; this.releaseInitialHome();
    if (focusId || focusRow) {
      const target = this.sections.flatMap(section => Array.from(section.element.querySelectorAll<HTMLElement>('[data-focus-id]'))).find(node => node.dataset.focusId === focusId);
      const retainedRow = this.sections.find(section => section.row.id === focusRow)?.element;
      const nearby = Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'))
        .filter(node => !node.closest('.hide, [hidden]') && node.getClientRects().length > 0);
      this.focus(target || retainedRow?.querySelector<HTMLElement>('[aria-selected="true"]') || retainedRow?.querySelector<HTMLElement>('button')
        || nearby.find(node => !retainedRow || !!(retainedRow.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) || nearby[nearby.length - 1]);
    }
    else if (movedFocus?.isConnected) this.focus(movedFocus);
    else if (firstPaint && !this.inputRevision && document.activeElement === document.body) {
      const saved = nativeReturnFocus.get(host);
      const usable = (node: HTMLElement): boolean => !node.closest('.hide,[hidden]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
      const target = saved?.key === this.key && saved.element.isConnected && host.contains(saved.element) && usable(saved.element)
        ? saved.element : undefined;
      // Preserve native Back restoration before TV's first-control fallback;
      // neither path takes focus from a header control or subsequent user input.
      const first = !target && !isDesktopLayout() ? Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')).find(usable) : undefined;
      (target || first)?.focus({ preventScroll: true });
    }
    this.restorePosition(host);
  }

  private async prepare(staged: StagedRows): Promise<void> {
    if (this.preparing === staged) return;
    this.preparing = staged;
    try {
      // The old rows stay usable while members for a newly selected source load.
      // Reconcile again if the user changes tabs during that asynchronous work.
      while (!this.disposed && this.staged === staged && staged.revision === this.revision) {
        const sourceRevision = this.sourceRevision;
        await Promise.all(staged.sections!.map(section => section.reconcileSource()));
        if (this.disposed || this.staged !== staged || staged.revision !== this.revision) return;
        if (sourceRevision === this.sourceRevision) {
          staged.sourceRevision = sourceRevision; this.attach(); return;
        }
      }
    } finally { if (this.preparing === staged) this.preparing = undefined; }
  }

  private focus(node?: HTMLElement): void {
    node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  private owns(node: Element | null): boolean { return !!node && this.sections.some(section => section.element.contains(node)); }
  private move(direction: string): boolean {
    const active = document.activeElement as HTMLElement;
    const host = this.root.parentElement;
    if (!host?.contains(active) || active.matches('input,textarea,select') || active.closest('.ec-root')) return false;
    const controls = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]'))
      .filter(node => !node.closest('.hide,[hidden]') && node.getClientRects().length > 0);
    const groups = Array.from(host.querySelectorAll<HTMLElement>('.focuscontainer-x, .ec-root'))
      .filter(group => !group.querySelector('.focuscontainer-x') && controls(group).length > 0)
      // Native navigation uses screen geometry. Follow that same row order at
      // custom/native boundaries even when another plugin reorders native DOM.
      .map(group => ({ group, top: group.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top).map(({ group }) => group);
    const groupIndex = groups.findIndex(group => controls(group).includes(active));
    if (groupIndex < 0) return false;
    const current = controls(groups[groupIndex]), index = current.indexOf(active);
    if (direction === 'left' || direction === 'right') {
      if (!this.owns(active)) return false;
      this.focus(current[index + (direction === 'right' ? 1 : -1)]); return true;
    }
    const next = groups[groupIndex + (direction === 'down' ? 1 : -1)];
    if (!this.owns(active) && !this.owns(next)) return false;
    if (next) {
      const sameRow = active.closest('.tvl-home-collection-row') === next.closest('.tvl-home-collection-row');
      this.focus(sameRow && next.classList.contains('tvl-home-source-tabs') ? next.querySelector<HTMLElement>('[aria-selected="true"]') || undefined
        : controls(next)[sameRow && groups[groupIndex].classList.contains('tvl-home-source-tabs') ? 0 : Math.min(index, controls(next).length - 1)]);
    }
    return !!next;
  }
  private onKey = (event: KeyboardEvent): void => {
    this.rememberPosition();
    this.inputRevision++;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const direction: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (direction[event.key] && this.move(direction[event.key])) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onCommand = (event: Event): void => {
    this.rememberPosition();
    this.inputRevision++;
    const command = (event as CustomEvent).detail?.command?.toLowerCase();
    if (['left', 'right', 'up', 'down'].includes(command) && this.move(command)) { event.preventDefault(); event.stopImmediatePropagation(); }
    else if (this.owns(document.activeElement) && ['select', 'enter', 'ok'].includes(command)) {
      event.preventDefault(); event.stopImmediatePropagation(); (document.activeElement as HTMLElement).click();
    }
  };
  private onPointer = (): void => { this.rememberPosition(); this.inputRevision++; };
  private current(revision: number): boolean { return !this.disposed && (revision === this.revision || revision === this.displayedRevision); }
  private async render(refreshList = false): Promise<void> {
    const revision = ++this.revision;
    const inputRevision = this.inputRevision;
    this.staged = undefined;
    const providerElement = this.openProvider ? providerHomeRow(this.providers, this.openProvider) : null;
    const providerRows: RenderedRow[] = providerElement ? [{ row: { id: 'provider-homes:brands', placement: this.providers.placement },
      element: providerElement, reconcileSource: async () => {} }] : [];
    if (!this.settings.rows.length) { this.staged = { revision, inputRevision, sections: providerRows }; this.attach(); return; }
    try {
      const available = new Map((await this.collectionList(refreshList)).map(item => [item.Id, item]));
      if (this.disposed || revision !== this.revision) return;
      const rendered = await Promise.all(this.settings.rows.map(row => this.section(row, available, revision)));
      if (this.disposed || revision !== this.revision) return;
      this.staged = { revision, inputRevision, sections: [...providerRows, ...rendered] }; this.attach();
    } catch {
      if (this.disposed || revision !== this.revision) return;
      this.renderRetry = true;
      const error = el('div', 'tvl-home-row-status'); error.setAttribute('role', 'status');
      error.append(el('p', '', 'Your collection rows could not be loaded.'), button('Retry collection rows', '', '', () => { void this.render(true); }));
      this.staged = { revision, inputRevision, error, retry: true,
        sections: [...providerRows, ...this.sections.filter(section => !section.element.classList.contains('tvl-home-provider-row'))] }; this.attach();
    }
  }

  private async section(row: HomeCollectionRow, available: Map<string, Item>, revision: number): Promise<RenderedRow> {
    const chosen = row.collectionIds.map(id => available.get(id)).filter((item): item is Item => !!item);
    const title = row.title || (row.kind === 'collections' ? 'Collections' : chosen[0]?.Name || 'Collection');
    const section = el('section', 'verticalSection tvl-home-collection-row');section.dataset.homeRow = row.id;
    section.setAttribute('aria-label', title);section.append(el('h2', 'tvl-home-row-title', title));
    const cards = el('div', 'tvl-home-row-cards focuscontainer-x');cards.setAttribute('role', 'list');
    const tabs = homeCollectionTabs(row);
    const tabbed = row.kind === 'items' && !!row.tabs?.length;
    const prefix = `tvl-home-${encodeURIComponent(row.id)}`;
    const focusPrefix = (tabId: string) => `home-tab:${encodeURIComponent(row.id)}:${encodeURIComponent(tabId)}:`;
    const tabFocusId = (tabId: string) => `home-source:${encodeURIComponent(row.id)}:${encodeURIComponent(tabId)}`;
    let selected = tabs.find(tab => tab.id === this.selectedSources.get(row.id))
      || tabs.find(tab => this.restoreFocus?.startsWith(focusPrefix(tab.id)) || this.restoreFocus === tabFocusId(tab.id)) || tabs[0];
    this.selectedSources.set(row.id, selected.id);
    let sourceRevision = 0;
    let strip: HTMLElement | undefined;
    const panel = el('div');
    if (tabbed) {
      strip = homeRowTabs(tabs.map(tab => ({ id: tab.id, label: homeTabLabel(tab, available.get(tab.collectionId)) })), selected.id, id => {
        const tab = tabs.find(tab => tab.id === id); if (!tab || !this.current(revision)) return;
        this.selectedSources.set(row.id, id); this.sourceRevision++;
        selected = tab;
        strip!.querySelectorAll<HTMLElement>('[data-source-tab]').forEach(control => {
          const active = control.dataset.sourceTab === id; control.setAttribute('aria-selected', String(active)); control.tabIndex = active ? 0 : -1;
        });
        void renderItems();
      }, prefix);
      strip.querySelectorAll<HTMLElement>('[data-source-tab]').forEach(control => { control.dataset.focusId = tabFocusId(control.dataset.sourceTab!); });
      section.append(strip);
      panel.id = `${prefix}-items`; panel.setAttribute('role', 'tabpanel');
    }
    panel.append(cards); section.append(panel);
    const renderItems = async (): Promise<void> => {
      const currentSource = ++sourceRevision, source = selected;
      const collection = available.get(source.collectionId);
      replace(cards); cards.scrollLeft = 0; cards.removeAttribute('aria-busy');
      if (tabbed) panel.setAttribute('aria-labelledby', `${prefix}-tab-${encodeURIComponent(source.id)}`);
      if (row.kind === 'items' ? !collection : !chosen.length) {
        cards.append(el('p', 'tvl-home-row-status', 'No accessible collections selected.')); return;
      }
      cards.setAttribute('aria-busy', 'true');
      cards.append(el('p', 'tvl-home-row-status', 'Loading collection…'));
      try {
        const items = row.kind === 'items' ? orderHomeItems(await this.collectionItems(collection!.Id), source) : chosen;
        if (!this.current(revision) || currentSource !== sourceRevision) return;
        replace(cards);
      for (const [index, item] of items.slice(0, 60).entries()) {
        const entry = el('div', 'tvl-home-row-entry');entry.setAttribute('role', 'listitem');
        const card = homeRowCard(this.api, item, row.ranked ? index + 1 : undefined, () => { if (!this.disposed) this.navigate(item.Id); });
        card.dataset.focusId = tabbed ? `${focusPrefix(source.id)}${encodeURIComponent(item.Id)}` : `home:${row.id}:${item.Id}`;
        entry.append(card);cards.append(entry);
      }
      if (!items.length) cards.append(el('p', 'tvl-home-row-status', 'This collection is empty.'));
        if (row.kind === 'items' && items.length > 60) {
          const full = button('View full collection', 'grid', '', () => this.navigate(collection!.Id));
          if (tabbed) full.dataset.focusId = `${focusPrefix(source.id)}full-collection`;
          cards.append(full);
        }
      } catch {
        if (!this.current(revision) || currentSource !== sourceRevision) return;
        replace(cards, el('p', 'tvl-home-row-status', 'This collection could not be loaded.'), button('Retry collection', '', '', () => {
          const focused = cards.contains(document.activeElement);
          const inputRevision = this.inputRevision;
          const pending = renderItems(), retrySource = sourceRevision;
          void pending.then(() => {
            if (focused && this.current(revision) && retrySource === sourceRevision && inputRevision === this.inputRevision && document.activeElement === document.body)
              this.focus(cards.querySelector<HTMLElement>('button') || strip?.querySelector<HTMLElement>('[aria-selected="true"]') || undefined);
          });
        }));
      } finally {
        if (this.current(revision) && currentSource === sourceRevision) cards.removeAttribute('aria-busy');
      }
    };
    // A newly added source must not block the already-loaded rows on return.
    const pending = renderItems();
    if (!this.warmReturn || this.initialPaint || row.kind !== 'items' || this.items.get(selected.collectionId)?.value) await pending;
    return { row, element: section, reconcileSource: async () => {
      const source = tabs.find(tab => tab.id === this.selectedSources.get(row.id)) || tabs[0];
      if (source.id === selected.id) return;
      selected = source;
      strip?.querySelectorAll<HTMLElement>('[data-source-tab]').forEach(control => {
        const active = control.dataset.sourceTab === source.id; control.setAttribute('aria-selected', String(active)); control.tabIndex = active ? 0 : -1;
      });
      await renderItems();
    } };
  }

  destroy(): void {
    if (this.initialPaint && this.displayedRevision > 0 && JSON.stringify([this.api.serverId, this.api.userId]) === this.accountIdentity
      && (!this.api.homeCollections || this.api.homeCollections.isCurrent()) && (!this.api.providerHomes || this.api.providerHomes.isCurrent())) {
      const items: HomeSnapshot['items'] = new Map();
      for (const [id, entry] of this.items) if (entry.value && entry.fingerprint !== undefined) items.set(id, { value: entry.value, fingerprint: entry.fingerprint });
      lastHome = { key: this.key, collections: this.collections, items, sources: new Map(this.selectedSources) };
    }
    this.rememberPosition();
    if (this.lastPosition) {
      homePositions.set(this.key, this.lastPosition);
      if (homePositions.size > 20) homePositions.delete(homePositions.keys().next().value!);
    }
    this.rememberNativeFocus();
    this.disposed = true; this.revision++; this.observer.disconnect();
    this.staged = undefined; this.readiness.destroy(); this.releaseInitialHome();
    this.store.destroy(); this.providerStore.destroy(); window.clearInterval(this.syncTimer); window.removeEventListener('focus', this.onVisible);
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('viewshow', this.onNativeShow, true);
    window.removeEventListener('storage', this.onProviderStorage);
    window.removeEventListener('tvl-provider-settings-changed', this.onProviderSaved);
    window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('command', this.onCommand, true);
    window.removeEventListener('pointerdown', this.onPointer, true);
    window.removeEventListener('focusin', this.rememberNativeFocus, true);
    window.removeEventListener('scroll', this.onScroll, true); window.removeEventListener('click', this.rememberPosition, true);
    window.removeEventListener('wheel', this.onWheel, true); if (this.restoreFrame !== undefined) cancelAnimationFrame(this.restoreFrame);
    if (this.captureFrame !== undefined) cancelAnimationFrame(this.captureFrame);
    this.sections.forEach(section => section.element.remove()); this.sections = []; this.root.remove();
  }
}
