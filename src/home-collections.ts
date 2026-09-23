import type { Item, MediaApi } from './types';
import { button, el, picture, replace } from './dom';
import { attachRemote } from './remote';
import { emptyHomeCollections, homeCollectionKey, parseHomeCollections, rankImage, type HomeCollectionRow, type HomeCollectionSettings } from './home-collection-settings';

/** Add owned rows to native Home without replacing its sections or Featured. */
export class HomeCollections {
  private root = el('div', 'tvl-home-collections');
  private rows = el('div', 'tvl-home-custom-rows');
  private launcher = button('Customize collection rows', 'grid', 'tvl-home-customize', () => { void this.edit(); });
  private settings = emptyHomeCollections();
  private key: string;
  private observer: MutationObserver;
  private disposed = false;
  private revision = 0;
  private dialog: HTMLElement | null = null;
  private removeModalRemote: (() => void) | undefined;
  
  constructor(private api: MediaApi, private navigate: (id: string) => void, private restoreFocus?: string) {
    this.key = homeCollectionKey(api.serverId || location.origin, api.userId || (window.TvItemLayoutDemo ? 'demo' : 'anonymous'));
    try { this.settings = parseHomeCollections(JSON.parse(localStorage.getItem(this.key) || 'null')); } catch { /* Defaults remain usable if storage is unavailable. */ }
    this.launcher.dataset.focusId = 'home:customize';
    const toolbar=el('div','tvl-home-row-toolbar focuscontainer-x');toolbar.append(this.launcher);this.root.append(this.rows, toolbar);
    this.root.addEventListener('keydown', this.onKey, true);
    window.addEventListener('command', this.onCommand, true);
    this.observer = new MutationObserver(() => this.attach());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.attach();
    void this.render();
  }

  private attach(): void {
    if (this.disposed) return;
    const host = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    if (host && this.root.parentElement !== host) host.append(this.root);
  }

  private focus(node?: HTMLElement): void {
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private move(direction: string): boolean {
    const active = document.activeElement as HTMLElement;
    if (!this.root.contains(active) || this.dialog) return false;
    const controls = (group: HTMLElement) => (group === this.launcher.parentElement ? [this.launcher] : Array.from(group.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]'))).filter(node=>node.getClientRects().length>0);
    const groups = [...Array.from(this.rows.querySelectorAll<HTMLElement>('.tvl-home-row-cards')), this.launcher.parentElement!].filter(group=>controls(group).length>0);
    const groupIndex = groups.findIndex(group => controls(group).includes(active));
    if (groupIndex < 0) return false;
    const current = controls(groups[groupIndex]);
    const index = current.indexOf(active);
    if (direction === 'left' || direction === 'right') this.focus(current[index + (direction === 'right' ? 1 : -1)]);
    else {
      const next = groups[groupIndex + (direction === 'down' ? 1 : -1)];
      if (next) this.focus(controls(next)[Math.min(index, controls(next).length - 1)]);
      else if (direction === 'up') {
        const host = this.root.parentElement;
        const native = Array.from(host?.querySelectorAll<HTMLElement>('button,a[href],[tabindex="0"]') || []).filter(node => !this.root.contains(node) && !node.closest('.hide,[hidden]') && node.getClientRects().length);
        this.focus(native[native.length - 1]);
      }
    }
    return true;
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || this.dialog) return;
    const direction: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (direction[event.key] && this.move(direction[event.key])) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onCommand = (event: Event): void => {
    if (this.dialog || !this.root.contains(document.activeElement)) return;
    const command = (event as CustomEvent).detail?.command?.toLowerCase();
    if (['left', 'right', 'up', 'down'].includes(command) && this.move(command)) { event.preventDefault(); event.stopImmediatePropagation(); }
    else if (['select', 'enter', 'ok'].includes(command)) { event.preventDefault(); event.stopImmediatePropagation(); (document.activeElement as HTMLElement).click(); }
  };

  private current(revision: number): boolean { return !this.disposed && revision === this.revision; }
  private async render(): Promise<void> {
    const revision = ++this.revision;
    if (!this.settings.rows.length) { replace(this.rows); return; }
    replace(this.rows, el('p', 'tvl-home-row-status', 'Loading your collection rows…'));
    try {
      const available = new Map((await this.api.getCollectionList()).map(item => [item.Id, item]));
      if (!this.current(revision)) return;
      const sections = this.settings.rows.map(row => this.section(row, available, revision));
      const rendered = await Promise.all(sections);
      if (!this.current(revision)) return;
      replace(this.rows, ...rendered);
      if(this.restoreFocus && !this.dialog){const target=Array.from(this.root.querySelectorAll<HTMLElement>('[data-focus-id]')).find(node=>node.dataset.focusId===this.restoreFocus);this.restoreFocus=undefined;this.focus(target);}
    } catch {
      if (!this.current(revision)) return;
      const error = el('div', 'tvl-home-row-status');error.setAttribute('role', 'status');
      error.append(el('p', '', 'Your collection rows could not be loaded.'), button('Retry collection rows', '', '', () => { void this.render(); }));
      replace(this.rows, error);
    }
  }

  private async section(row: HomeCollectionRow, available: Map<string, Item>, revision: number): Promise<HTMLElement> {
    const chosen = row.collectionIds.map(id => available.get(id)).filter((item): item is Item => !!item);
    const title = row.title || (row.kind === 'collections' ? 'Collections' : chosen[0]?.Name || 'Collection');
    const section = el('section', 'tvl-home-collection-row');section.dataset.homeRow = row.id;
    section.setAttribute('aria-label', title);section.append(el('h2', 'tvl-home-row-title', title));
    const cards = el('div', 'tvl-home-row-cards focuscontainer-x');cards.setAttribute('role', 'list');section.append(cards);
    if (!chosen.length) { cards.append(el('p', 'tvl-home-row-status', 'No accessible collections selected. Customize this row to choose a collection.'));return section; }
    try {
      const items = row.kind === 'items' ? await this.api.getCollectionItems(chosen[0].Id) : chosen;
      if (!this.current(revision)) return section;
      for (const [index, item] of items.slice(0, 60).entries()) {
        const entry = el('div', 'tvl-home-row-entry');entry.setAttribute('role', 'listitem');
        const card = el('button', `tvl-home-row-card${row.ranked ? ' tvl-home-ranked' : ''}`);card.type = 'button';
        card.dataset.focusId = `home:${row.id}:${item.Id}`;card.dataset.itemId = item.Id;
        card.setAttribute('aria-label', row.ranked ? `Rank ${index + 1}: ${item.Name}` : item.Name);
        if (row.ranked) { const rank = el('img', 'tvl-home-rank');rank.src = rankImage(index + 1);rank.alt = '';rank.setAttribute('aria-hidden', 'true');card.append(rank); }
        const cover = el('div', 'tvl-home-row-cover');
        cover.append(picture(this.api.image(item, 'poster'), 'tvl-home-row-art'), el('span', 'tvl-home-row-caption', item.Name));
        card.append(cover);card.addEventListener('click', () => { if (!this.disposed) this.navigate(item.Id); });
        entry.append(card);cards.append(entry);
      }
      if (!items.length) cards.append(el('p', 'tvl-home-row-status', 'This collection is empty.'));
      if (row.kind === 'items' && items.length > 60) cards.append(button('View full collection', 'grid', '', () => this.navigate(chosen[0].Id)));
    } catch {
      cards.append(el('p', 'tvl-home-row-status', 'This collection could not be loaded.'), button('Retry collection', '', '', () => { void this.render(); }));
    }
    return section;
  }

  private closeEditor(restore = true): void {
    this.removeModalRemote?.();this.removeModalRemote = undefined;
    this.dialog?.remove();this.dialog = null;
    if (restore && !this.disposed) this.focus(this.launcher);
  }

  private async edit(): Promise<void> {
    if (this.dialog || this.disposed) return;
    const draft = parseHomeCollections(this.settings);
    const dialog = el('section', 'tvl-home-editor tvl-keyboard');this.dialog = dialog;
    dialog.setAttribute('role', 'dialog');dialog.setAttribute('aria-modal', 'true');dialog.setAttribute('aria-label', 'Customize collection rows');
    const panel = el('div', 'tvl-home-editor-panel');
    const cancel = button('Cancel', 'close', '', () => this.closeEditor());
    const header = el('header');header.append(el('h1', '', 'Your collection rows'), cancel);
    const status = el('p', 'tvl-home-editor-status', 'Loading collections…');status.setAttribute('role', 'status');
    const body = el('div', 'tvl-home-editor-rows');
    panel.append(header, el('p', '', 'Choose collections for a row, or display the items in one collection. Saved for this account on this device.'), status, body);dialog.append(panel);document.body.append(dialog);
    this.removeModalRemote = attachRemote(dialog, () => this.closeEditor());cancel.focus();
    let collections: Item[];
    try { collections = await this.api.getCollectionList(); }
    catch { if (this.dialog === dialog) status.textContent = 'Collections could not be loaded. Close this window and try again.';return; }
    if (this.disposed || this.dialog !== dialog) return;
    status.textContent = collections.length ? '' : 'No collections are available for this account yet.';
    const redraw = (focus?: string) => {
      replace(body);
      for (const [index, row] of draft.rows.entries()) {
        const field = el('fieldset', 'tvl-home-editor-row');field.append(el('legend', '', row.kind === 'collections' ? 'Collections row' : 'Collection items row'));
        const titleLabel = el('label', '', 'Row title');const title = el('input');title.type = 'text';title.maxLength = 80;title.value = row.title;title.placeholder = row.kind === 'collections' ? 'Collections' : 'Collection name';title.dataset.editorFocus = `${row.id}:title`;
        title.addEventListener('input', () => { row.title = title.value; });titleLabel.append(title);field.append(titleLabel);
        if (row.kind === 'collections') {
          const choices = el('div', 'tvl-home-collection-choices');
          for (const collection of collections) {
            const selected = row.collectionIds.includes(collection.Id);
            const choice = button(collection.Name, selected ? 'check' : '', 'tvl-home-collection-choice', () => {
              if (selected) row.collectionIds = row.collectionIds.filter(id => id !== collection.Id);
              else if (row.collectionIds.length < 40) row.collectionIds.push(collection.Id);
              redraw(`${row.id}:choose:${collection.Id}`);
            });choice.setAttribute('aria-pressed', String(selected));choice.dataset.editorFocus = `${row.id}:choose:${collection.Id}`;choices.append(choice);
          }
          field.append(choices);
          if (row.collectionIds.length > 1) {
            const order = el('div', 'tvl-home-selected-order');order.append(el('p', '', 'Selected collections appear in this order:'));
            row.collectionIds.forEach((id, position) => {
              const item = collections.find(item => item.Id === id);if (!item) return;
              const line = el('div');line.append(el('span', '', item.Name));
              const earlier = button(`Move ${item.Name} left`, '', '', () => { [row.collectionIds[position - 1], row.collectionIds[position]] = [id, row.collectionIds[position - 1]];redraw(`${row.id}:title`); });earlier.disabled = position === 0;
              const later = button(`Move ${item.Name} right`, '', '', () => { [row.collectionIds[position + 1], row.collectionIds[position]] = [id, row.collectionIds[position + 1]];redraw(`${row.id}:title`); });later.disabled = position === row.collectionIds.length - 1;line.append(earlier, later);order.append(line);
            });field.append(order);
          }
        } else {
          field.append(el('p', '', 'Choose one collection:'));
          const choices=el('div','tvl-home-collection-choices');choices.setAttribute('role','group');choices.setAttribute('aria-label','Choose one collection');
          for(const collection of collections){
            const choice=button(collection.Name,row.collectionIds[0]===collection.Id?'check':'','tvl-home-collection-choice',()=>{row.collectionIds=[collection.Id];redraw(`${row.id}:choose:${collection.Id}`);});
            choice.setAttribute('aria-pressed',String(row.collectionIds[0]===collection.Id));choice.dataset.editorFocus=`${row.id}:choose:${collection.Id}`;choices.append(choice);
          }
          field.append(choices);
          const rank = button('Ranked artwork', '', '', () => { row.ranked = !row.ranked;rank.setAttribute('aria-pressed', String(row.ranked)); });rank.setAttribute('aria-pressed', String(row.ranked));field.append(rank);
          field.append(el('p', 'tvl-home-editor-help', 'Show large number images beside the posters. Numbers follow the collection’s item order; they do not calculate popularity.'));
        }
        const actions = el('div', 'tvl-home-editor-actions');
        const up = button('Move row up', '', '', () => { [draft.rows[index - 1], draft.rows[index]] = [row, draft.rows[index - 1]];redraw(`${row.id}:title`); });up.disabled = index === 0;
        const down = button('Move row down', '', '', () => { [draft.rows[index + 1], draft.rows[index]] = [row, draft.rows[index + 1]];redraw(`${row.id}:title`); });down.disabled = index === draft.rows.length - 1;
        actions.append(up, down, button('Remove row', '', '', () => { draft.rows.splice(index, 1);redraw('add:collections'); }));field.append(actions);body.append(field);
      }
      const actions = el('div', 'tvl-home-editor-actions');
      for (const kind of ['collections', 'items'] as const) {
        const add = button(kind === 'collections' ? 'Add Collections row' : 'Add collection items row', 'grid', '', () => {
          const row: HomeCollectionRow = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, title: kind === 'collections' ? 'Collections' : '', collectionIds: [], ranked: false };
          draft.rows.push(row);redraw(`${row.id}:title`);
        });add.disabled = draft.rows.length >= 12;add.dataset.editorFocus = `add:${kind}`;actions.append(add);
      }
      const save = button('Save rows', 'check', 'tvl-primary', () => {
        const next = parseHomeCollections(draft);
        if (next.rows.some(row => !row.collectionIds.length)) { status.textContent = 'Choose at least one collection for each row, or remove the empty row.';return; }
        try { localStorage.setItem(this.key, JSON.stringify(next)); }
        catch { status.textContent = 'These settings could not be saved on this device. Check that browser storage is available.';return; }
        this.settings = next;this.closeEditor();void this.render();
      });actions.append(save);body.append(actions);
      if (focus) { const target = Array.from(body.querySelectorAll<HTMLElement>('[data-editor-focus]')).find(node => node.dataset.editorFocus === focus);target?.focus({ preventScroll: true }); }
    };
    redraw();
  }

  destroy(): void {
    this.disposed = true;this.revision++;this.observer.disconnect();this.closeEditor(false);
    this.root.removeEventListener('keydown', this.onKey, true);window.removeEventListener('command', this.onCommand, true);this.root.remove();
  }
}
