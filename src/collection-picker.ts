import type { Item, MediaApi } from './types';
import { el, button, replace } from './dom';
import { attachRemote } from './remote';

const sameId = (id: string) => id.replace(/-/g, '').toLowerCase();

/** A separate remote scope keeps background detail actions out of this dialog. */
export class CollectionPicker {
  readonly element = el('div', 'tvl-collection-picker tvl-keyboard');
  private panel = el('section', 'tvl-collection-picker-panel');
  private body = el('div', 'tvl-collection-picker-body');
  private message = el('p', 'tvl-collection-picker-message');
  private cancel: HTMLButtonElement;
  private removeRemote: () => void;
  private disposed = false;
  private pending = false;
  private creating = false;
  private collections: Item[] = [];
  private membership = new Set<string>();

  constructor(private api: MediaApi, private item: Item, private options: {
    close: () => void; saved: (collection: Item) => void; pending: (value: boolean) => void;
  }) {
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Add to collection');
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.cancel = button('Cancel', 'close', '', () => this.options.close());
    const header = el('header', 'tvl-collection-picker-header');
    header.append(el('h2', '', 'Add to collection'), this.cancel);
    this.panel.append(header, el('p', 'tvl-collection-picker-title', item.Name), this.body, this.message);
    this.element.append(this.panel);
    this.removeRemote = attachRemote(this.element, () => {
      if (this.creating && !this.pending) this.renderList();
      else this.options.close();
    });
  }

  async load(): Promise<void> {
    replace(this.body, el('p', 'tvl-loading', 'Loading collections…'));
    this.message.textContent = '';
    this.cancel.focus({ preventScroll: true });
    try {
      const allowed = await this.api.canManageCollections!();
      if (this.disposed) return;
      if (!allowed) {
        replace(this.body, el('p', '', 'This account is not allowed to manage collections.'));
        return;
      }
      const [collections, membership] = await Promise.all([
        this.api.getCollectionList(), this.api.getCollections(this.item.Id)
      ]);
      if (this.disposed) return;
      this.collections = collections;
      this.membership = new Set(membership.map(item => sameId(item.Id)));
      this.renderList();
    } catch (error) {
      if (this.disposed) return;
      const retry = button('Try again', '', '', () => void this.load());
      replace(this.body, el('p', '', 'Collections could not be loaded.'), retry);
      this.showError(error);
      retry.focus({ preventScroll: true });
    }
  }

  private renderList(): void {
    this.creating = false;
    this.message.textContent = '';
    const create = button('Create new collection', 'grid', 'tvl-primary', () => this.renderCreate());
    const search = el('input', 'tvl-collection-picker-input');
    search.type = 'search'; search.placeholder = 'Find a collection';
    search.setAttribute('aria-label', 'Find a collection');
    const list = el('div', 'tvl-collection-picker-list');
    const update = () => {
      replace(list);
      const matches = this.collections.filter(item => item.Name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
      for (const collection of matches) {
        const added = this.membership.has(sameId(collection.Id));
        const choice = button(collection.Name, added ? 'check' : 'grid', 'tvl-collection-choice', () => {
          void this.save(() => this.api.addToCollection!(collection.Id, this.item.Id).then(() => collection));
        });
        choice.setAttribute('aria-label', added ? `${collection.Name}, already in collection` : `Add to ${collection.Name}`);
        choice.disabled = added;
        if (added) choice.append(el('small', '', 'Already added'));
        list.append(choice);
      }
      if (!matches.length) list.append(el('p', 'tvl-collection-picker-empty', this.collections.length ? 'No matching collections.' : 'No collections yet. Create one to get started.'));
    };
    search.addEventListener('input', update);
    replace(this.body, create, search, list);
    update();
    (list.querySelector<HTMLButtonElement>('button:not(:disabled)') || create).focus({ preventScroll: true });
  }

  private renderCreate(): void {
    this.creating = true;
    this.message.textContent = '';
    const form = el('form', 'tvl-collection-create-form');
    const label = el('label', '', 'Collection name');
    const name = el('input', 'tvl-collection-picker-input');
    name.id = 'tvl-collection-name'; name.name = 'collectionName'; name.required = true;
    name.autocomplete = 'off'; label.htmlFor = name.id;
    const submit = button('Create collection', '', 'tvl-primary', () => {});
    submit.type = 'submit';
    form.append(label, name, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!name.value.trim()) { this.message.textContent = 'Enter a collection name.'; name.focus(); return; }
      void this.save(() => this.api.createCollection!(name.value.trim(), this.item.Id));
    });
    replace(this.body, button('Choose an existing collection', 'back', '', () => this.renderList()), form);
    name.focus({ preventScroll: true });
  }

  private async save(action: () => Promise<Item>): Promise<void> {
    if (this.pending || this.disposed) return;
    this.pending = true;
    this.options.pending(true);
    const focused = document.activeElement as HTMLElement;
    const enabled = Array.from(this.body.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input:not(:disabled), button:not(:disabled)'));
    enabled.forEach(node => { node.disabled = true; });
    this.body.setAttribute('aria-busy', 'true');
    this.message.textContent = this.creating ? 'Creating collection…' : 'Adding to collection…';
    this.cancel.querySelector('span')!.textContent = 'Close';
    this.cancel.focus({ preventScroll: true });
    try {
      const collection = await action();
      // A submitted write may finish after Close. Let the owning detail page
      // refresh membership, but never reopen the dismissed picker.
      this.options.saved(collection);
    } catch (error) {
      if (this.disposed) return;
      this.showError(error);
      enabled.forEach(node => { node.disabled = false; });
      if (focused.isConnected) focused.focus({ preventScroll: true });
    } finally {
      this.pending = false;
      this.options.pending(false);
      this.body.removeAttribute('aria-busy');
      this.cancel.querySelector('span')!.textContent = 'Cancel';
    }
  }

  private showError(error: unknown): void {
    this.message.textContent = error instanceof Error ? error.message : 'Could not save the collection. Please try again.';
  }

  destroy(): void { this.disposed = true; this.removeRemote(); this.element.remove(); }
}
