import type { Item, MediaApi } from './types';
import { button, el, picture, replace } from './dom';
import { attachRemote } from './remote';
import { emptyHomeCollections, homeCollectionKey, parseHomeCollections, orderHomeItems, type HomeCollectionRow, type HomeItemSort } from './home-collection-settings';
import { cachedHomeRows, nativeHomeRows, type HomeAnchor } from './home-row-placement';

type OrderEntry = { row: HomeCollectionRow } | { anchor: HomeAnchor };
export function combinedHomeOrder(rows: HomeCollectionRow[], anchors: HomeAnchor[]): OrderEntry[] {
  const known = new Set(anchors.map(anchor => anchor.key));
  return [
    ...rows.filter(row => row.placement === 'start').map(row => ({ row })),
    ...anchors.flatMap(anchor => [...rows.filter(row => row.placement === anchor.key).map(row => ({ row })), { anchor }] as OrderEntry[]),
    ...rows.filter(row => row.placement !== 'start' && !known.has(row.placement)).map(row => ({ row })),
  ];
}

/** A single editor beside a compact row list; edits are a local draft until saved. */
export class HomeCollectionEditor {
  readonly element = el('section', 'tvl-home-editor tvl-keyboard');
  private sidebar = el('nav', 'tvl-home-editor-sidebar');
  private workspace = el('div', 'tvl-home-editor-workspace');
  private status = el('p', 'tvl-home-editor-status');
  private saveButton: HTMLButtonElement;
  private draft = emptyHomeCollections();
  private key: string;
  private anchors: HomeAnchor[];
  private collections: Item[] = [];
  private selectedId = '';
  private tab: 'content' | 'order' | 'position' = 'content';
  private search = '';
  private items = new Map<string, Item[]>();
  private loading = new Set<string>();
  private errors = new Set<string>();
  private visibleItems = 60;
  private disposed = false;
  private ready = false;
  private removeRemote: () => void;

  constructor(private api: MediaApi, private onClose: (restore: boolean) => void) {
    this.key = homeCollectionKey(api.serverId || location.origin, api.userId || (window.TvItemLayoutDemo ? 'demo' : 'anonymous'));
    try { this.draft = parseHomeCollections(JSON.parse(localStorage.getItem(this.key) || 'null')); } catch { /* Defaults. */ }
    const home = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    const native = home ? nativeHomeRows(home) : [];
    this.anchors = native.length ? native.map(({ key, label }) => ({ key, label })) : cachedHomeRows(this.key);
    this.selectedId = this.draft.rows[0]?.id || '';
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Customize collection rows');
    this.sidebar.setAttribute('aria-label', 'Your Home collection rows');
    const panel = el('div', 'tvl-home-editor-panel');
    const header = el('header', 'tvl-home-editor-header');
    const title = el('div'); title.append(el('p', 'tvl-home-editor-eyebrow', 'PERSONALISE HOME'), el('h1', '', 'Your collection rows'));
    const actions = el('div', 'tvl-home-editor-actions');
    const cancel = button('Cancel', 'close', '', () => this.close()); cancel.dataset.editorFocus = 'cancel';
    this.saveButton = button('Save rows', 'check', 'tvl-primary', () => this.save()); this.saveButton.disabled = true; this.saveButton.dataset.editorFocus = 'save';
    actions.append(cancel, this.saveButton); header.append(title, actions);
    this.status.setAttribute('role', 'status'); this.status.textContent = 'Loading collections…';
    const layout = el('div', 'tvl-home-editor-layout'); layout.append(this.sidebar, this.workspace);
    panel.append(header, el('p', 'tvl-home-editor-intro', 'Choose a row on the left to edit it. Your choices apply to this account on this device.'), this.status, layout);
    this.element.append(panel); document.body.append(this.element);
    this.removeRemote = attachRemote(this.element, () => this.close()); cancel.focus();
    void this.loadCollections();
  }
  private async loadCollections(): Promise<void> {
    try {
      const collections = await this.api.getCollectionList(); if (this.disposed) return;
      this.collections = collections; this.ready = true; this.saveButton.disabled = false;
      this.status.textContent = collections.length ? '' : 'No collections are available for this account yet.'; this.redraw();
    } catch {
      if (this.disposed) return;
      replace(this.workspace, button('Retry collections', '', 'tvl-primary', () => { void this.loadCollections(); }));
      this.status.textContent = 'Collections could not be loaded. Check your connection and try again.';
    }
  }
  private control(label: string, focus: string, action: () => void, className = ''): HTMLButtonElement {
    const control = button(label, '', className, action); control.dataset.editorFocus = focus; return control;
  }
  private name(row: HomeCollectionRow): string {
    return row.title || (row.kind === 'collections' ? 'Collections' : this.collections.find(item => item.Id === row.collectionIds[0])?.Name || 'New collection row');
  }
  private redraw(focus?: string): void {
    const restore = focus || (document.activeElement as HTMLElement)?.dataset.editorFocus;
    replace(this.sidebar); replace(this.workspace);
    for (const row of this.draft.rows) {
      const entry = this.control(this.name(row), `row:${row.id}`, () => { this.selectedId = row.id; this.search = ''; this.visibleItems = 60; this.redraw(`row:${row.id}`); }, 'tvl-home-row-choice');
      entry.setAttribute('aria-pressed', String(row.id === this.selectedId));
      entry.append(el('small', '', row.kind === 'collections' ? `${row.collectionIds.length} selected collections` : `${row.ranked ? 'Ranked' : 'Poster'} item row`)); this.sidebar.append(entry);
    }
    const add = el('div', 'tvl-home-editor-add');
    for (const kind of ['collections', 'items'] as const) {
      const control = this.control(kind === 'collections' ? 'Add Collections row' : 'Add collection items row', `add:${kind}`, () => {
        const row: HomeCollectionRow = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, title: kind === 'collections' ? 'Collections' : '', collectionIds: [], ranked: false, placement: 'end', itemSort: 'collection', itemOrder: [] };
        this.draft.rows.push(row); this.selectedId = row.id; this.tab = 'content'; this.search = ''; this.redraw('title');
      }); control.disabled = this.draft.rows.length >= 12; add.append(control);
    }
    this.sidebar.append(add);
    const row = this.draft.rows.find(row => row.id === this.selectedId);
    if (!row) this.workspace.append(el('h2', '', 'Make Home your own'), el('p', '', 'Add a row of favourite collections, or show the titles in one collection as their own row.'));
    else {
      const heading = el('div', 'tvl-home-editor-heading');
      heading.append(el('h2', '', this.name(row)), this.control('Remove row', 'remove', () => {
        const index = this.draft.rows.indexOf(row); this.draft.rows.splice(index, 1); this.selectedId = this.draft.rows[Math.min(index, this.draft.rows.length - 1)]?.id || ''; this.redraw(this.selectedId ? `row:${this.selectedId}` : 'add:collections');
      }));
      const tabs = el('nav', 'tvl-home-editor-tabs'); tabs.setAttribute('aria-label', 'Row settings');
      for (const [tab, label] of [['content', 'Content'], ['order', 'Item order'], ['position', 'Home position']] as const) {
        const control = this.control(label, `tab:${tab}`, () => { this.tab = tab; this.redraw(`tab:${tab}`); }); control.setAttribute('aria-pressed', String(this.tab === tab)); tabs.append(control);
      }
      const content = el('div', 'tvl-home-editor-row'); content.setAttribute('role', 'group'); content.setAttribute('aria-label', row.kind === 'collections' ? 'Collections row' : 'Collection items row');
      this.workspace.append(heading, tabs, content);
      if (this.tab === 'content') this.renderContent(row, content);
      else if (this.tab === 'order') this.renderOrder(row, content);
      else this.renderPosition(row, content);
    }
    if (restore) {
      const target = Array.from(this.element.querySelectorAll<HTMLElement>('[data-editor-focus]')).find(node => node.dataset.editorFocus === restore && !node.hasAttribute('disabled'))
        || this.workspace.querySelector<HTMLElement>('.tvl-home-editor-tabs [aria-pressed="true"]') || this.sidebar.querySelector<HTMLElement>('button:not(:disabled)');
      target?.focus({ preventScroll: true });
    }
  }
  private renderContent(row: HomeCollectionRow, content: HTMLElement): void {
    const label = el('label', '', 'Row title'); const title = el('input'); title.type = 'text'; title.maxLength = 80;
    title.value = row.title; title.placeholder = row.kind === 'collections' ? 'Collections' : 'Collection name'; title.dataset.editorFocus = 'title';
    title.addEventListener('input', () => { row.title = title.value; }); label.append(title); content.append(label);
    if (row.kind === 'items') {
      const rank = this.control('Ranked artwork', 'ranked', () => { row.ranked = !row.ranked; rank.setAttribute('aria-pressed', String(row.ranked)); });
      rank.setAttribute('aria-pressed', String(row.ranked)); content.append(rank, el('p', 'tvl-home-editor-help', 'Large number images beside the posters, following your chosen item order.'));
    }
    content.append(el('h3', '', row.kind === 'collections' ? 'Choose collections' : 'Choose one collection'));
    const search = el('input'); search.type = 'search'; search.placeholder = 'Find collections'; search.setAttribute('aria-label', 'Find collections'); search.value = this.search; search.dataset.editorFocus = 'collection-search';
    const choices = el('div', 'tvl-home-collection-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', row.kind === 'collections' ? 'Choose collections' : 'Choose one collection');
    const drawChoices = () => {
      replace(choices);
      for (const collection of this.collections.filter(item => item.Name.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()))) {
        const selected = row.collectionIds.includes(collection.Id);
        const choice = this.control(collection.Name, `choose:${collection.Id}`, () => {
          if (row.kind === 'items') {
            if (row.collectionIds[0] !== collection.Id) { row.collectionIds = [collection.Id]; row.itemOrder = []; }
          }
          else if (selected) row.collectionIds = row.collectionIds.filter(id => id !== collection.Id);
          else if (row.collectionIds.length < 40) row.collectionIds.push(collection.Id);
          this.redraw(`choose:${collection.Id}`);
        }, 'tvl-home-collection-choice'); choice.setAttribute('aria-pressed', String(selected));
        choice.prepend(picture(this.api.image(collection, 'thumb'), 'tvl-home-choice-art')); choices.append(choice);
      }
      if (!choices.childElementCount) choices.append(el('p', '', 'No matching collections.'));
    };
    search.addEventListener('input', () => { this.search = search.value; drawChoices(); }); drawChoices(); content.append(search, choices);
  }
  private async loadItems(id: string): Promise<void> {
    if (this.loading.has(id)) return;
    this.loading.add(id); this.errors.delete(id);
    try { const items = await this.api.getCollectionItems(id); if (!this.disposed) this.items.set(id, items); }
    catch { if (!this.disposed) this.errors.add(id); }
    finally { this.loading.delete(id); if (!this.disposed && this.tab === 'order' && this.draft.rows.find(row => row.id === this.selectedId)?.collectionIds[0] === id) this.redraw(); }
  }
  private renderOrder(row: HomeCollectionRow, content: HTMLElement): void {
    content.append(el('p', 'tvl-home-editor-help', 'This changes the order in this Home row only. Other collection views keep their existing order.'));
    let items: Item[];
    if (row.kind === 'collections') items = row.collectionIds.map(id => this.collections.find(item => item.Id === id)).filter((item): item is Item => !!item);
    else {
      const id = row.collectionIds[0];
      if (!id || !this.collections.some(item => item.Id === id)) { content.append(el('p', '', 'Choose an accessible collection in Content first.')); return; }
      const sorts: [HomeItemSort, string][] = [['collection', 'Collection order'], ['title', 'Title A–Z'], ['title-desc', 'Title Z–A'], ['newest', 'Newest year first'], ['oldest', 'Oldest year first'], ['custom', 'Custom order']];
      const options = el('div', 'tvl-home-sort-options'); options.setAttribute('role', 'group'); options.setAttribute('aria-label', 'Sort items');
      for (const [sort, label] of sorts) {
        const control = this.control(label, `sort:${sort}`, () => { row.itemSort = sort; this.redraw(`sort:${sort}`); }); control.setAttribute('aria-pressed', String(row.itemSort === sort)); options.append(control);
      }
      content.append(options);
      if (this.errors.has(id)) { content.append(this.control('Retry collection items', 'retry-items', () => { void this.loadItems(id); this.redraw('tab:order'); })); return; }
      if (!this.items.has(id)) { content.append(el('p', '', 'Loading collection items…')); void this.loadItems(id); return; }
      items = orderHomeItems(this.items.get(id)!, row);
    }
    if (!items.length) { content.append(el('p', '', 'No items to arrange yet.')); return; }
    const list = el('ol', 'tvl-home-item-order'); list.setAttribute('aria-label', 'Items in display order');
    items.slice(0, this.visibleItems).forEach((item, index) => {
      const line = el('li'); line.dataset.orderedItem = item.Id;
      line.append(el('span', 'tvl-home-item-number', String(index + 1)), picture(this.api.image(item, 'thumb'), 'tvl-home-order-art'), el('span', 'tvl-home-order-name', item.Name));
      const actions = el('div', 'tvl-home-editor-actions');
      for (const [delta, direction] of [[-1, 'earlier'], [1, 'later']] as const) {
        const control = this.control(`Move ${item.Name} ${direction}`, `move:${item.Id}:${direction}`, () => {
          const ordered = items.map(item => item.Id); [ordered[index], ordered[index + delta]] = [ordered[index + delta], ordered[index]];
          if (row.kind === 'collections') row.collectionIds = ordered; else { row.itemSort = 'custom'; row.itemOrder = ordered.slice(0, 2000); }
          this.visibleItems = Math.max(this.visibleItems, index + delta + 1);
          const focusDirection = index + delta === 0 ? 'later' : index + delta === items.length - 1 ? 'earlier' : direction;
          this.redraw(`move:${item.Id}:${focusDirection}`);
        }, 'tvl-home-move-item'); control.setAttribute('aria-label', `Move ${item.Name} ${direction}`); control.querySelector('span')!.textContent = delta < 0 ? '↑' : '↓';
        control.disabled = index + delta < 0 || index + delta >= Math.min(items.length, 2000); actions.append(control);
      }
      line.append(actions); list.append(line);
    }); content.append(list);
    if (items.length > this.visibleItems) content.append(this.control('Show more items', 'more-items', () => {
      const firstNew = items[this.visibleItems]; this.visibleItems += 60;
      this.redraw(firstNew ? `move:${firstNew.Id}:earlier` : 'tab:order');
    }));
  }
  private renderPosition(row: HomeCollectionRow, content: HTMLElement): void {
    content.append(el('p', 'tvl-home-editor-help', 'Move this row between your existing Home sections. Jellyfin and Featured keep control of their own rows.'));
    if (!this.anchors.length) content.append(el('p', '', 'Visit Home once to see its available sections here.'));
    const quick = el('div', 'tvl-home-editor-actions');
    quick.append(this.control('Move to top', 'position:top', () => { row.placement = 'start'; this.draft.rows = [row, ...this.draft.rows.filter(item => item !== row)]; this.redraw('position:top'); }),
      this.control('Move to bottom', 'position:bottom', () => { row.placement = 'end'; this.draft.rows = [...this.draft.rows.filter(item => item !== row), row]; this.redraw('position:bottom'); })); content.append(quick);
    const sequence = combinedHomeOrder(this.draft.rows, this.anchors);
    const list = el('ol', 'tvl-home-position-order'); list.setAttribute('aria-label', 'Home row order');
    sequence.forEach((entry, index) => {
      const line = el('li');
      if ('anchor' in entry) { line.className = 'tvl-home-native-position'; line.append(el('span', '', entry.anchor.label), el('small', '', 'Existing Home row')); }
      else {
        line.dataset.positionRow = entry.row.id; line.classList.toggle('tvl-home-position-selected', entry.row === row);
        line.append(this.control(this.name(entry.row), `position:${entry.row.id}`, () => { this.selectedId = entry.row.id; this.redraw(`position:${entry.row.id}`); }));
        if (entry.row === row) {
          for (const [delta, label] of [[-1, 'Move row up'], [1, 'Move row down']] as const) {
            const control = this.control(label, `position:move:${delta}`, () => {
              [sequence[index], sequence[index + delta]] = [sequence[index + delta], sequence[index]];
              sequence.forEach((entry, i) => { if ('row' in entry) entry.row.placement = sequence.slice(i + 1).find((next): next is {anchor: HomeAnchor} => 'anchor' in next)?.anchor.key || 'end'; });
              this.draft.rows = sequence.flatMap(entry => 'row' in entry ? [entry.row] : []); this.redraw(index + delta === 0 ? 'position:move:1' : index + delta === sequence.length - 1 ? 'position:move:-1' : `position:move:${delta}`);
            }); control.disabled = index + delta < 0 || index + delta >= sequence.length; line.append(control);
          }
        }
      }
      list.append(line);
    }); content.append(list);
  }
  private save(): void {
    if (!this.ready || this.disposed) return;
    const next = parseHomeCollections(this.draft);
    const invalid = next.rows.find(row => !row.collectionIds.length);
    if (invalid) { this.status.textContent = 'Choose at least one collection for each row, or remove the empty row.'; this.selectedId = invalid.id; this.tab = 'content'; this.redraw('title'); return; }
    try { localStorage.setItem(this.key, JSON.stringify(next)); }
    catch { this.status.textContent = 'These settings could not be saved on this device. Check that browser storage is available.'; return; }
    this.close();
  }
  private close(restore = true): void {
    if (this.disposed) return;
    this.disposed = true; this.removeRemote(); this.element.remove(); this.onClose(restore);
  }
  destroy(): void { this.close(false); }
}
