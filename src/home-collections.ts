import type { Item, MediaApi } from './types';
import { button, el, replace } from './dom';
import { emptyHomeCollections, orderHomeItems, homeCollectionTabs, homeTabLabel, type HomeCollectionRow } from './home-collection-settings';
import { createHomeCollectionStore, type HomeCollectionStore } from './home-collection-store';
import { nativeHomeRows, rememberHomeRows } from './home-row-placement';
import { homeRowCard } from './home-row-card';
import { homeRowTabs } from './home-row-tabs';
import { HomeReadiness } from './home-readiness';

type RenderedRow = { row: HomeCollectionRow; element: HTMLElement; reconcileSource: () => Promise<void> };
type StagedRows = { revision: number; inputRevision: number; sourceRevision?: number; sections?: RenderedRow[]; error?: HTMLElement };

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
  private items = new Map<string, Promise<Item[]>>();

  constructor(private api: MediaApi, private navigate: (id: string) => void, private restoreFocus?: string) {
    this.store = createHomeCollectionStore(api); this.key = this.store.key; this.settings = this.store.cached;
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('command', this.onCommand, true);
    window.addEventListener('pointerdown', this.onPointer, true);
    this.observer = new MutationObserver(records => {
      // Native row order can change without replacing a node. Ignore scroller
      // transform updates so animated TV focus does not keep reattaching rows.
      if (records.some(record => record.attributeName !== 'style'
        || (record.target as Element).matches('.verticalSection, .ec-root, .homeSectionsContainer, #homeTab'))) this.attach();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    this.attach(); void this.render();
    if (this.store.synced) {
      window.addEventListener('focus', this.onVisible); document.addEventListener('visibilitychange', this.onVisible);
      this.syncTimer = window.setInterval(this.onVisible, 60_000); void this.refreshSettings(true);
    }
  }

  private onVisible = (): void => { if (document.visibilityState !== 'hidden') void this.refreshSettings(); };
  async refreshSettings(force = false): Promise<void> {
    if (this.disposed || !this.store.synced || this.syncing || !force && Date.now() - this.lastSync < 5_000) return;
    this.syncing = true; this.lastSync = Date.now();
    try {
      const settings = await this.store.load(); if (this.disposed) return;
      if (JSON.stringify(settings) !== JSON.stringify(this.settings)) {
        const active = document.activeElement as HTMLElement | null;
        if (this.owns(active)) this.restoreFocus = active?.dataset.focusId;
        this.settings = settings; await this.render();
      }
    } catch {
      // Background sync stays quiet on Home and preserves the last loaded rows.
      // The editor still reports load/save failures so unsaved edits are clear.
    } finally { this.syncing = false; }
  }

  private attach(): void {
    if (this.disposed) return;
    const host = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    if (!host || !this.readiness.update(host)) return;
    if (this.root.parentElement !== host) host.append(this.root);
    let staged = this.staged;
    if (staged?.sections && staged.sourceRevision !== this.sourceRevision) {
      void this.prepare(staged); staged = undefined;
    }
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
        this.sections.forEach(section => section.element.remove());
        this.sections = staged.sections; this.displayedRevision = staged.revision;
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
    }
    if (focusId || focusRow) {
      const target = this.sections.flatMap(section => Array.from(section.element.querySelectorAll<HTMLElement>('[data-focus-id]'))).find(node => node.dataset.focusId === focusId);
      const retainedRow = this.sections.find(section => section.row.id === focusRow)?.element;
      this.focus(target || retainedRow?.querySelector<HTMLElement>('[aria-selected="true"]') || retainedRow?.querySelector<HTMLElement>('button') || undefined);
    }
    else if (movedFocus?.isConnected) this.focus(movedFocus);
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
    this.inputRevision++;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const direction: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (direction[event.key] && this.move(direction[event.key])) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onCommand = (event: Event): void => {
    this.inputRevision++;
    const command = (event as CustomEvent).detail?.command?.toLowerCase();
    if (['left', 'right', 'up', 'down'].includes(command) && this.move(command)) { event.preventDefault(); event.stopImmediatePropagation(); }
    else if (this.owns(document.activeElement) && ['select', 'enter', 'ok'].includes(command)) {
      event.preventDefault(); event.stopImmediatePropagation(); (document.activeElement as HTMLElement).click();
    }
  };
  private onPointer = (): void => { this.inputRevision++; };
  private current(revision: number): boolean { return !this.disposed && (revision === this.revision || revision === this.displayedRevision); }
  private async render(): Promise<void> {
    const revision = ++this.revision;
    const inputRevision = this.inputRevision;
    this.staged = undefined;
    if (!this.settings.rows.length) { this.staged = { revision, inputRevision, sections: [] }; this.attach(); return; }
    try {
      const available = new Map((await this.api.getCollectionList()).map(item => [item.Id, item]));
      if (this.disposed || revision !== this.revision) return;
      const rendered = await Promise.all(this.settings.rows.map(row => this.section(row, available, revision)));
      if (this.disposed || revision !== this.revision) return;
      this.staged = { revision, inputRevision, sections: rendered }; this.attach();
    } catch {
      if (this.disposed || revision !== this.revision) return;
      const error = el('div', 'tvl-home-row-status'); error.setAttribute('role', 'status');
      error.append(el('p', '', 'Your collection rows could not be loaded.'), button('Retry collection rows', '', '', () => { void this.render(); }));
      this.staged = { revision, inputRevision, error }; this.attach();
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
        cards.append(el('p', 'tvl-home-row-status', 'No accessible collections selected. Choose a collection from Customize collection rows on the Collections page.')); return;
      }
      cards.setAttribute('aria-busy', 'true');
      cards.append(el('p', 'tvl-home-row-status', 'Loading collection…'));
      try {
        if (row.kind === 'items' && !this.items.has(collection!.Id)) {
          const id = collection!.Id;
          this.items.set(id, this.api.getCollectionItems(id).catch(error => { this.items.delete(id); throw error; }));
        }
        const items = row.kind === 'items' ? orderHomeItems(await this.items.get(collection!.Id)!, source) : chosen;
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
    await renderItems();
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
    this.disposed = true; this.revision++; this.observer.disconnect();
    this.staged = undefined; this.readiness.destroy();
    this.store.destroy(); window.clearInterval(this.syncTimer); window.removeEventListener('focus', this.onVisible);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('command', this.onCommand, true);
    window.removeEventListener('pointerdown', this.onPointer, true);
    this.sections.forEach(section => section.element.remove()); this.sections = []; this.root.remove();
  }
}
