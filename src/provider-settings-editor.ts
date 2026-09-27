import { button, el, replace } from './dom';
import { attachRemote } from './remote';
import { providerBrand, providerBrands } from './provider-brands';
import { cloneProviderHomes, defaultProviderConfig, defaultCustomProvider, maxProviders, maxProviderRows, type ProviderId, type ProviderHomeConfig, type ProviderHomesSettings, type ProviderRow, type ProviderRowSource, type ProviderItemSort } from './provider-settings';
import { providerAppearance, providerLogo } from './provider-appearance';
import { providerHomeRow } from './provider-home';
import { createProviderHomesStore, ProviderHomesSyncError, type ProviderHomesStore } from './provider-settings-store';
import { cachedHomeRows, nativeHomeRows, type HomeAnchor } from './home-row-placement';
import { homeCollectionKey } from './home-collection-settings';
import { homeRowCard } from './home-row-card';
import type { Item, MediaApi } from './types';

type Options = { onBack: () => void; loadPreview: (provider: ProviderHomeConfig, row: ProviderRow) => Promise<Item[]> };
const sources: [ProviderRowSource, string][] = [['movies', 'Films'], ['shows', 'TV shows'], ['trending-movies', 'Trending films'], ['trending-shows', 'Trending TV shows'], ['collection', 'Collection']];
const sorts: [ProviderItemSort, string][] = [['collection', 'Source order'], ['title', 'Title A–Z'], ['title-desc', 'Title Z–A'], ['newest', 'Newest release first'], ['oldest', 'Oldest release first']];

/** One draft workspace for Home and its provider pages. Save is the only writer. */
export class ProviderSettingsEditor {
  readonly element = el('section', 'tvl-root tvl-provider-settings tvl-keyboard');
  private sidebar = el('nav', 'tvl-provider-settings-sidebar');
  private workspace = el('div', 'tvl-provider-settings-workspace');
  private status = el('p', 'tvl-provider-settings-status');
  private reloadButton: HTMLButtonElement;
  private saveButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private store: ProviderHomesStore;
  private draft: ProviderHomesSettings;
  private saved: ProviderHomesSettings;
  private selected: ProviderId | 'home' = 'home';
  private selectedRows = new Map<ProviderId, string>();
  private providerIdInputs = new Map<string, string>();
  private collections: Item[] = [];
  private anchors: HomeAnchor[] = [];
  private previewItems = new Map<string, Item[]>();
  private previewPending = new Map<string, Promise<Item[]>>();
  private ready = false;
  private saving = false;
  private loading = false;
  private disposed = false;
  private generation = 0;
  private previewGeneration = 0;
  private removeRemote: () => void;

  constructor(private api: MediaApi, private options: Options) {
    this.store = createProviderHomesStore(api); this.draft = this.store.cached; this.saved = cloneProviderHomes(this.draft);
    this.element.setAttribute('aria-label', 'Streaming service settings');
    this.sidebar.setAttribute('aria-label', 'Streaming service pages');
    this.status.setAttribute('role', 'status');
    const home = document.querySelector<HTMLElement>('#indexPage #homeTab, #homeTab');
    const native = home ? nativeHomeRows(home).filter(anchor => !anchor.element.closest('.tvl-provider-row')) : [];
    const cache = cachedHomeRows(this.store.key);
    const collectionCache = cachedHomeRows(homeCollectionKey(api.serverId || location.origin, api.userId || (window.TvItemLayoutDemo ? 'demo' : 'anonymous')));
    const unique = new Map<string, HomeAnchor>();
    for (const anchor of [...native, ...cache, ...collectionCache]) if (!unique.has(anchor.key)) unique.set(anchor.key, anchor);
    this.anchors = Array.from(unique.values());
    const panel = el('div', 'tvl-provider-settings-panel');
    const header = el('header', 'tvl-provider-settings-header');
    const heading = el('div'); heading.append(el('p', 'tvl-provider-settings-eyebrow', 'PERSONALISE CINEMA'), el('h1', '', 'Streaming services'));
    const actions = el('div', 'tvl-provider-settings-actions');
    actions.append(this.control('Back to settings', 'back', () => this.options.onBack(), 'back'));
    this.cancelButton = this.control('Cancel changes', 'cancel', () => this.cancel()); this.cancelButton.disabled = true; actions.append(this.cancelButton);
    this.saveButton = this.control('Save changes', 'save', () => { void this.save(); }, 'check', 'tvl-primary');
    this.saveButton.disabled = true; actions.append(this.saveButton); header.append(heading, actions);
    this.reloadButton = this.control('Reload saved settings', 'reload', () => { void this.load(); }); this.reloadButton.hidden = true;
    const message = el('div', 'tvl-provider-settings-message'); message.append(this.status, this.reloadButton);
    const layout = el('div', 'tvl-provider-settings-layout'); layout.append(this.sidebar, this.workspace);
    panel.append(header, el('p', 'tvl-provider-settings-intro', this.store.synced ? 'Your choices follow this Jellyfin account across your devices.' : 'This preview saves choices on this device.'), message, layout);
    this.element.append(panel);
    // Native selects need their Up/Down and Enter behaviour. Register before the
    // shared remote listener so choosing an option cannot leave the field.
    window.addEventListener('keydown', this.selectKeys, true);
    window.addEventListener('keyup', this.selectKeys, true);
    window.addEventListener('command', this.selectCommand, true);
    this.removeRemote = attachRemote(this.element, () => this.options.onBack());
  }
  private selectKeys = (event: KeyboardEvent) => {
    const active = document.activeElement;
    if (!this.disposed && active instanceof HTMLInputElement && active.type === 'range' && this.element.contains(active)
      && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      event.stopImmediatePropagation(); return;
    }
    if (!this.disposed && active instanceof HTMLInputElement && active.type === 'checkbox' && this.element.contains(active) && event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === 'keydown' && !event.repeat) active.click();
      return;
    }
    if (!this.disposed && active instanceof HTMLSelectElement && this.element.contains(active)
      && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopImmediatePropagation();
  };
  private selectCommand = (event: Event) => {
    const active = document.activeElement;
    const command = (event as CustomEvent).detail?.command?.toLowerCase();
    if (active instanceof HTMLInputElement && active.type === 'range' && this.element.contains(active) && ['left', 'right'].includes(command)) {
      event.preventDefault(); event.stopImmediatePropagation();
      active.value = String(Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + (command === 'right' ? 1 : -1))));
      active.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    if (!(active instanceof HTMLSelectElement) || !this.element.contains(active) || !['up', 'down', 'left', 'right', 'select', 'enter', 'ok'].includes(command)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (['up', 'down', 'left', 'right'].includes(command)) {
      const direction = command === 'up' || command === 'left' ? -1 : 1;
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + direction)); active.dispatchEvent(new Event('change', { bubbles: true }));
    } else active.click();
  };
  private control(label: string, focus: string, action: () => void, glyph = '', classes = ''): HTMLButtonElement {
    const node = button(label, glyph, classes, action); node.dataset.providerSettingsFocus = focus; return node;
  }
  private restoreFocus(key?: string): void {
    if (!key) return;
    const target = Array.from(this.element.querySelectorAll<HTMLElement>('[data-provider-settings-focus]')).find(node => node.dataset.providerSettingsFocus === key);
    target?.focus({ preventScroll: true });
  }
  async load(): Promise<void> {
    if (this.disposed || this.loading || this.saving) return;
    const generation = ++this.generation; this.previewGeneration++;
    this.loading = true; this.ready = false; this.saveButton.disabled = true; this.cancelButton.disabled = true; this.reloadButton.hidden = true;
    this.status.textContent = 'Loading saved streaming services…';
    this.setControlsDisabled(true);
    try {
      const [settings, collections] = await Promise.allSettled([this.store.load(), this.api.getCollectionList()]);
      if (this.disposed || generation !== this.generation) return;
      if (settings.status === 'rejected') throw settings.reason;
      this.draft = settings.value; this.saved = cloneProviderHomes(this.draft); this.providerIdInputs.clear(); this.ready = true;
      this.collections = collections.status === 'fulfilled' ? collections.value : [];
      this.status.textContent = collections.status === 'rejected' ? 'Collection choices could not load. Automatic film and TV rows are still available.' : '';
      if (this.selected !== 'home' && !this.draft.providers.some(provider => provider.id === this.selected)) this.selected = 'home';
      this.previewItems.clear(); this.render();
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.status.textContent = error instanceof ProviderHomesSyncError ? error.message : 'Saved streaming services could not be loaded. Check your connection and try again.';
      this.reloadButton.hidden = false;
    } finally {
      if (!this.disposed && generation === this.generation) { this.loading = false; this.saveButton.disabled = !this.ready; this.cancelButton.disabled = !this.ready; this.setControlsDisabled(!this.ready); }
    }
  }
  private setControlsDisabled(disabled: boolean): void {
    for (const region of [this.sidebar, this.workspace]) region.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach(control => {
      if (disabled) { control.dataset.providerDisabled = String(control.disabled); control.disabled = true; }
      else if (control.dataset.providerDisabled !== undefined) { control.disabled = control.dataset.providerDisabled === 'true'; delete control.dataset.providerDisabled; }
    });
  }
  private changed(): void { this.status.textContent = 'Unsaved changes'; }
  private cancel(): void {
    if (this.disposed || !this.ready || this.loading || this.saving) return;
    this.draft = cloneProviderHomes(this.saved); this.providerIdInputs.clear(); this.previewItems.clear();
    if (this.selected !== 'home' && !this.draft.providers.some(provider => provider.id === this.selected)) this.selected = 'home';
    this.render(); this.status.textContent = 'Changes discarded.'; this.reloadButton.hidden = true;
  }
  private render(focus?: string): void {
    if (this.disposed) return;
    const restore = focus || (document.activeElement as HTMLElement | null)?.dataset.providerSettingsFocus;
    this.previewGeneration++;
    this.renderSidebar(); replace(this.workspace);
    if (this.selected === 'home') this.renderHome();
    else {
      const provider = this.draft.providers.find(provider => provider.id === this.selected);
      if (provider) this.renderProvider(provider);
    }
    this.restoreFocus(restore);
  }
  private renderSidebar(): void {
    replace(this.sidebar);
    const home = this.control('Home row', 'page:home', () => { this.selected = 'home'; this.render('page:home'); });
    home.setAttribute('aria-pressed', String(this.selected === 'home')); this.sidebar.append(home);
    for (const provider of this.draft.providers) {
      const brand = providerAppearance(provider);
      const choice = this.control(brand.name, `page:${provider.id}`, () => { this.selected = provider.id; this.render(`page:${provider.id}`); });
      choice.setAttribute('aria-pressed', String(this.selected === provider.id));
      const logo = providerLogo(provider, 'tvl-provider-sidebar-logo'); logo.setAttribute('aria-hidden', 'true'); choice.prepend(logo);
      if (!provider.enabled) choice.append(el('small', '', 'Hidden'));
      this.sidebar.append(choice);
    }
    const add = this.control('Add service', 'add-service', () => {
      const provider = defaultCustomProvider(`custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      this.draft.providers.push(provider); this.selected = provider.id; this.changed(); this.render('provider:name');
    }); add.disabled = this.draft.providers.length >= maxProviders; this.sidebar.append(add);
  }
  private field(label: string, focus: string, value: string, change: (value: string) => void, max = 80): HTMLElement {
    const wrap = el('label', 'tvl-provider-field', label), input = el('input'); input.type = 'text'; input.maxLength = max; input.value = value;
    input.dataset.providerSettingsFocus = focus; input.addEventListener('input', () => { change(input.value); this.changed(); }); wrap.append(input); return wrap;
  }
  private checkbox(label: string, focus: string, value: boolean, change: (value: boolean) => void): HTMLElement {
    const wrap = el('label', 'tvl-provider-toggle'), input = el('input'); input.type = 'checkbox'; input.checked = value; input.dataset.providerSettingsFocus = focus;
    input.addEventListener('change', () => { change(input.checked); this.changed(); }); wrap.append(input, el('span', '', label)); return wrap;
  }
  private select(label: string, focus: string, value: string, choices: [string, string][], change: (value: string) => void): HTMLElement {
    const wrap = el('label', 'tvl-provider-field', label), select = el('select'); select.dataset.providerSettingsFocus = focus;
    for (const [id, text] of choices) { const option = el('option', '', text); option.value = id; select.append(option); }
    select.value = value; select.addEventListener('change', () => { change(select.value); this.changed(); }); wrap.append(select); return wrap;
  }
  private renderHome(): void {
    this.workspace.append(el('h2', '', 'The streaming services row'), el('p', 'tvl-provider-help', 'Choose which services appear on Home and where the row belongs.'));
    this.workspace.append(this.checkbox('Show streaming services on Home', 'home:enabled', this.draft.enabled, value => { this.draft.enabled = value; this.renderHomePreview(); }));
    this.workspace.append(this.field('Row title', 'home:title', this.draft.title, value => { this.draft.title = value; this.renderHomePreview(); }));
    const positions: [string, string][] = [['start', 'Before the first Home row'], ...this.anchors.map(anchor => [anchor.key, `Before ${anchor.label}`] as [string, string]), ['end', 'After the last Home row']];
    if (!positions.some(([key]) => key === this.draft.placement)) positions.splice(positions.length - 1, 0, [this.draft.placement, 'Saved Home position (currently unavailable)']);
    this.workspace.append(this.select('Home position', 'home:placement', this.draft.placement, positions, value => { this.draft.placement = value; }));
    const size = el('label', 'tvl-provider-field tvl-provider-size'), range = el('input'), amount = el('output', '', `${this.draft.tileScale}%`);
    range.type = 'range'; range.min = '70'; range.max = '150'; range.step = '1'; range.value = String(this.draft.tileScale);
    range.setAttribute('aria-label', 'Tile size'); range.setAttribute('aria-valuetext', `${range.value}%`); range.dataset.providerSettingsFocus = 'home:tile-size'; amount.setAttribute('aria-hidden', 'true');
    range.addEventListener('input', () => { this.draft.tileScale = Number(range.value); amount.textContent = `${range.value}%`; range.setAttribute('aria-valuetext', `${range.value}%`); this.changed(); this.renderHomePreview(); });
    size.append(el('span', '', 'Tile size'), amount, range); this.workspace.append(size);
    this.workspace.append(this.checkbox('Show service names', 'home:show-names', this.draft.showNames, value => { this.draft.showNames = value; this.renderHomePreview(); }));
    const preview = el('aside', 'tvl-provider-home-preview'); preview.setAttribute('aria-label', 'Home services row preview'); this.workspace.append(preview); this.renderHomePreview();
    const list = el('ol', 'tvl-provider-service-order'); list.setAttribute('aria-label', 'Home service order');
    for (const [index, provider] of this.draft.providers.entries()) {
      const brand = providerAppearance(provider), entry = el('li');
      entry.append(this.checkbox(`Show ${brand.name}`, `enabled:${provider.id}`, provider.enabled, value => { provider.enabled = value; this.render(`enabled:${provider.id}`); }));
      const actions = el('div', 'tvl-provider-order-actions');
      const earlier = this.control(`Move ${brand.name} earlier`, `earlier:${provider.id}`, () => this.moveProvider(provider, -1), '', 'tvl-provider-order-button'); earlier.disabled = index === 0;
      const later = this.control(`Move ${brand.name} later`, `later:${provider.id}`, () => this.moveProvider(provider, 1), '', 'tvl-provider-order-button'); later.disabled = index === this.draft.providers.length - 1;
      actions.append(earlier, later); entry.append(actions); list.append(entry);
    }
    this.workspace.append(list);
    for (const brand of providerBrands.filter(brand => !this.draft.providers.some(provider => provider.id === brand.id))) {
      const add = this.control(`Add ${brand.name}`, `add-provider:${brand.id}`, () => {
        this.draft.providers.push(defaultProviderConfig(brand.id)); this.changed(); this.render(`page:${brand.id}`);
      }); add.disabled = this.draft.providers.length >= maxProviders; this.workspace.append(add);
    }
  }
  private renderHomePreview(): void {
    const preview = this.workspace.querySelector<HTMLElement>('.tvl-provider-home-preview'); if (!preview) return;
    replace(preview, el('span', 'tvl-provider-preview-label', 'HOME PREVIEW'));
    if (!this.draft.enabled) { preview.append(el('p', 'tvl-provider-help', 'This row is hidden on Home.')); return; }
    const row = providerHomeRow(this.draft, id => { this.selected = id; this.render(`page:${id}`); });
    if (row) preview.append(row); else preview.append(el('p', 'tvl-provider-help', 'No services are enabled.'));
  }
  private moveProvider(provider: ProviderHomeConfig, direction: number): void {
    const index = this.draft.providers.indexOf(provider), next = index + direction;
    if (next < 0 || next >= this.draft.providers.length) return;
    this.draft.providers.splice(index, 1); this.draft.providers.splice(next, 0, provider); this.changed(); this.render(`enabled:${provider.id}`);
  }
  private renderProvider(provider: ProviderHomeConfig): void {
    const brand = providerAppearance(provider), header = el('div', 'tvl-provider-editor-brand');
    header.style.setProperty('--provider-accent', brand.accent); header.append(providerLogo(provider), el('h2', '', `${brand.name} Home`)); this.workspace.append(header);
    const options = el('div', 'tvl-provider-page-options');
    options.append(this.checkbox(`Show ${brand.name} on Home`, 'provider:enabled', provider.enabled, value => { provider.enabled = value; this.render('provider:enabled'); }),
      this.checkbox('Show featured artwork', 'provider:hero', provider.hero, value => { provider.hero = value; })); this.workspace.append(options);
    const appearance = el('div', 'tvl-provider-appearance'), fields = el('div');
    fields.append(this.serviceField(provider, 'Service name', 'name', provider.name, value => { provider.name = value; this.updateAppearance(provider); }, value => value.trim() ? '' : 'Enter a service name.'));
    fields.append(this.serviceField(provider, 'Logo URL', 'logo', provider.logoUrl, value => { provider.logoUrl = value.trim(); this.updateAppearance(provider); }, value => this.logoError(value), 2048));
    fields.append(el('p', 'tvl-provider-help', providerBrand(provider.id) ? 'Leave the logo URL empty to use the original service logo.' : 'Use an HTTP or HTTPS image URL, or leave it empty for an initial badge.'));
    fields.append(this.serviceField(provider, 'Accent colour', 'accent', provider.accent, value => { provider.accent = value; this.updateAppearance(provider); }, value => /^#[\da-f]{6}$/i.test(value) ? '' : 'Use a six-digit colour such as #9fb8a8.', 7));
    const tilePreview = el('aside', 'tvl-provider-appearance-preview'); tilePreview.setAttribute('aria-label', 'Service tile preview');
    appearance.append(fields, tilePreview); this.workspace.append(appearance); this.updateAppearance(provider);
    const advanced = el('details', 'tvl-provider-advanced'), summary = el('summary', '', 'Catalogue sources'); summary.tabIndex = 0;
    const sourceHelp = el('p', 'tvl-provider-help', 'Optional TMDB provider IDs match titles in your Jellyfin library to this service’s UK catalogue. Collection rows work without these IDs. Separate multiple IDs with commas.');
    const reference = el('a', '', 'TMDB provider reference'); reference.href = 'https://developer.themoviedb.org/reference/watch-providers-movie-list'; reference.target = '_blank'; reference.rel = 'noopener noreferrer'; sourceHelp.append(document.createTextNode(' '), reference);
    advanced.append(summary, sourceHelp);
    for (const [key, label] of [['movieProviderIds', 'Film provider IDs'], ['showProviderIds', 'TV provider IDs']] as const) {
      const value = this.providerIdInputs.get(`${provider.id}:${key}`) ?? provider[key].join(', ');
      advanced.append(this.serviceField(provider, label, key, value, value => {
        this.providerIdInputs.set(`${provider.id}:${key}`, value); const parsed = this.readProviderIds(value);
        if (parsed.ids) provider[key] = parsed.ids;
        this.refreshSelectedPreview(provider);
      }, value => this.readProviderIds(value).error, 180));
    }
    const offers = el('fieldset', 'tvl-provider-offers'); offers.append(el('legend', '', 'UK catalogue availability'));
    for (const [type, label] of [['flatrate', 'Include subscription titles'], ['free', 'Include free titles'], ['ads', 'Include ad-supported titles']] as const) {
      offers.append(this.checkbox(label, `provider:offer-${type}`, provider.offerTypes.includes(type), checked => {
        provider.offerTypes = checked ? [...provider.offerTypes, type] : provider.offerTypes.filter(value => value !== type);
        this.refreshSelectedPreview(provider); const error = offers.querySelector<HTMLElement>('.tvl-provider-field-error')!;
        error.textContent = provider.offerTypes.length ? '' : 'Choose at least one availability type.'; error.hidden = !!provider.offerTypes.length;
      }));
    }
    const offerError = el('p', 'tvl-provider-field-error', provider.offerTypes.length ? '' : 'Choose at least one availability type.'); offerError.hidden = !!provider.offerTypes.length; offers.append(offerError); advanced.append(offers); this.workspace.append(advanced);
    const rowList = el('div', 'tvl-provider-row-list'); rowList.setAttribute('aria-label', `${brand.name} rows`);
    let selected = provider.rows.find(row => row.id === this.selectedRows.get(provider.id)) || provider.rows[0];
    if (selected) this.selectedRows.set(provider.id, selected.id);
    for (const [index, row] of provider.rows.entries()) {
      const entry = el('div', 'tvl-provider-row-choice');
      const choose = this.control(row.title || sources.find(([source]) => source === row.source)![1], `row:${row.id}`, () => { this.selectedRows.set(provider.id, row.id); this.render(`row:${row.id}`); });
      choose.setAttribute('aria-pressed', String(row === selected)); if (!row.enabled) choose.append(el('small', '', 'Hidden'));
      const up = this.control(`Move ${row.title || 'row'} up`, `up:${row.id}`, () => this.moveRow(provider, row, -1), '', 'tvl-provider-order-button'); up.disabled = index === 0;
      const down = this.control(`Move ${row.title || 'row'} down`, `down:${row.id}`, () => this.moveRow(provider, row, 1), '', 'tvl-provider-order-button'); down.disabled = index === provider.rows.length - 1;
      const arrows = el('div', 'tvl-provider-order-actions'); arrows.append(up, down); entry.append(choose, arrows); rowList.append(entry);
    }
    const add = this.control('Add row', 'add-row', () => {
      const row: ProviderRow = { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: 'Collection', source: 'collection', collectionId: '', enabled: true, ranked: false, itemSort: 'collection' };
      provider.rows.push(row); this.selectedRows.set(provider.id, row.id); this.changed(); this.render('row:title');
    }); add.disabled = provider.rows.length >= maxProviderRows;
    this.workspace.append(el('h3', '', 'Page rows'), rowList, add);
    if (selected) this.renderRow(provider, selected);
    else this.workspace.append(el('p', 'tvl-provider-help', 'This provider page has no rows.'));
    const credits = el('p', 'tvl-provider-credits'); credits.append(document.createTextNode('UK streaming availability: '));
    for (const [index, [name, href]] of [['TMDB', 'https://www.themoviedb.org/'], ['JustWatch', 'https://www.justwatch.com/uk']].entries()) {
      if (index) credits.append(document.createTextNode(' / '));
      const link = el('a', '', name); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; credits.append(link);
    }
    this.workspace.append(credits);
    const manage = el('div', 'tvl-provider-manage');
    const builtin = providerBrand(provider.id);
    if (builtin) manage.append(this.control('Restore defaults', 'provider:restore', () => {
      const index = this.draft.providers.indexOf(provider); this.draft.providers[index] = defaultProviderConfig(builtin.id);
      this.clearProviderInputs(provider.id); this.changed(); this.render('provider:name');
    }));
    manage.append(this.control('Remove service', 'provider:remove', () => {
      this.draft.providers = this.draft.providers.filter(value => value !== provider); this.clearProviderInputs(provider.id);
      this.selected = 'home'; this.changed(); this.render('page:home');
    }, '', 'tvl-provider-remove'));
    this.workspace.append(manage);
  }
  private serviceField(provider: ProviderHomeConfig, label: string, focus: string, value: string, change: (value: string) => void, validate: (value: string) => string, max = 80): HTMLElement {
    const wrap = this.field(label, `provider:${focus}`, value, change, max), input = wrap.querySelector('input')!;
    input.setAttribute('aria-label', label);
    const error = el('span', 'tvl-provider-field-error'); error.id = `provider-field-${provider.id}-${focus}`; input.setAttribute('aria-describedby', error.id);
    const check = () => { const message = validate(input.value); error.textContent = message; error.hidden = !message; input.setAttribute('aria-invalid', String(!!message)); };
    input.addEventListener('input', check); wrap.append(error); check(); return wrap;
  }
  private logoError(value: string): string {
    if (!value.trim()) return '';
    try { const url = new URL(value.trim()); if (/^https?:\/\//i.test(value.trim()) && !/\s/.test(value.trim()) && url.hostname && !url.username && !url.password && value.trim().length <= 2048) return ''; } catch { /* Show a field-level error below. */ }
    return 'Use an HTTP or HTTPS image URL without a username or password.';
  }
  private readProviderIds(value: string): { ids?: number[]; error: string } {
    if (!value.trim()) return { ids: [], error: '' };
    const pieces = value.split(',').map(part => part.trim());
    if (pieces.length > 20) return { error: 'Use no more than 20 provider IDs.' };
    if (pieces.some(part => !/^\d+$/.test(part) || Number(part) < 1 || Number(part) > 1_000_000)) return { error: 'Use comma-separated whole numbers from 1 to 1000000.' };
    const ids = pieces.map(Number); if (new Set(ids).size !== ids.length) return { error: 'Use each provider ID only once.' };
    return { ids, error: '' };
  }
  private clearProviderInputs(id: ProviderId): void {
    this.providerIdInputs.delete(`${id}:movieProviderIds`); this.providerIdInputs.delete(`${id}:showProviderIds`);
    this.previewItems.clear();
  }
  private updateAppearance(provider: ProviderHomeConfig): void {
    const appearance = providerAppearance(provider), header = this.workspace.querySelector<HTMLElement>('.tvl-provider-editor-brand');
    if (header) { header.style.setProperty('--provider-accent', appearance.accent); replace(header, providerLogo(provider), el('h2', '', `${appearance.name} Home`)); }
    const toggle = this.workspace.querySelector<HTMLElement>('[data-provider-settings-focus="provider:enabled"]')?.parentElement?.querySelector('span');
    if (toggle) toggle.textContent = `Show ${appearance.name} on Home`;
    this.workspace.querySelector('.tvl-provider-row-list')?.setAttribute('aria-label', `${appearance.name} rows`);
    const preview = this.workspace.querySelector<HTMLElement>('.tvl-provider-appearance-preview');
    if (preview) {
      replace(preview, el('span', 'tvl-provider-preview-label', 'SERVICE PREVIEW'));
      const row = providerHomeRow({ ...this.draft, enabled: true, title: '', providers: [{ ...provider, enabled: true }] }, () => {});
      if (row) preview.append(row);
    }
    this.renderSidebar();
  }
  private refreshSelectedPreview(provider: ProviderHomeConfig): void {
    const row = provider.rows.find(row => row.id === this.selectedRows.get(provider.id)) || provider.rows[0];
    const preview = this.workspace.querySelector<HTMLElement>('.tvl-provider-row-preview');
    if (row && preview) void this.renderRowPreview(provider, row, preview);
  }
  private providerError(provider: ProviderHomeConfig): { focus: string; message: string } | undefined {
    if (!provider.name.trim()) return { focus: 'name', message: 'Enter a service name.' };
    const logo = this.logoError(provider.logoUrl); if (logo) return { focus: 'logo', message: logo };
    if (!/^#[\da-f]{6}$/i.test(provider.accent)) return { focus: 'accent', message: 'Use a six-digit colour such as #9fb8a8.' };
    for (const key of ['movieProviderIds', 'showProviderIds'] as const) {
      const parsed = this.readProviderIds(this.providerIdInputs.get(`${provider.id}:${key}`) ?? provider[key].join(', '));
      if (parsed.error) return { focus: key, message: parsed.error };
    }
    if (!provider.offerTypes.length) return { focus: 'offer-flatrate', message: 'Choose at least one availability type.' };
  }
  private moveRow(provider: ProviderHomeConfig, row: ProviderRow, direction: number): void {
    const index = provider.rows.indexOf(row), next = index + direction; if (next < 0 || next >= provider.rows.length) return;
    provider.rows.splice(index, 1); provider.rows.splice(next, 0, row); this.changed(); this.render(`row:${row.id}`);
  }
  private updateRowSummary(row: ProviderRow): void {
    const controls = Array.from(this.workspace.querySelectorAll<HTMLElement>('[data-provider-settings-focus]'));
    const choice = controls.find(node => node.dataset.providerSettingsFocus === `row:${row.id}`);
    const label = choice?.querySelector('span'); if (label) label.textContent = row.title || sources.find(([source]) => source === row.source)![1];
    const hidden = choice?.querySelector('small');
    if (row.enabled) hidden?.remove(); else if (choice && !hidden) choice.append(el('small', '', 'Hidden'));
    for (const direction of ['up', 'down']) {
      const move = controls.find(node => node.dataset.providerSettingsFocus === `${direction}:${row.id}`);
      const text = `Move ${row.title || 'row'} ${direction}`;
      const span = move?.querySelector('span'); if (span) span.textContent = text;
      move?.setAttribute('aria-label', text);
    }
  }
  private renderRow(provider: ProviderHomeConfig, row: ProviderRow): void {
    const editor = el('div', 'tvl-provider-row-editor'), fields = el('div', 'tvl-provider-row-fields');
    const preview = el('aside', 'tvl-provider-row-preview'); preview.setAttribute('aria-label', 'Provider Home row preview');
    const refresh = () => { void this.renderRowPreview(provider, row, preview); };
    fields.append(this.field('Row title', 'row:title', row.title, value => {
      row.title = value; this.updateRowSummary(row); refresh();
    }), this.checkbox('Show this row', 'row:enabled', row.enabled, value => { row.enabled = value; this.updateRowSummary(row); refresh(); }),
    this.select('Content', 'row:source', row.source, sources, value => { row.source = value as ProviderRowSource; row.collectionId = ''; this.render('row:source'); }));
    const collections: [string, string][] = [[ '', row.source === 'collection' ? 'Choose a collection' : 'Automatic' ], ...this.collections.map(item => [item.Id, item.Name] as [string, string])];
    if (row.collectionId && !collections.some(([id]) => id === row.collectionId)) collections.push([row.collectionId, 'Saved collection (currently unavailable)']);
    fields.append(this.select(row.source === 'collection' ? 'Collection' : 'Collection override', 'row:collection', row.collectionId, collections, value => {
      row.collectionId = value; fields.querySelector('[aria-invalid]')?.removeAttribute('aria-invalid'); refresh();
    }),
      this.select('Item order', 'row:sort', row.itemSort, sorts, value => { row.itemSort = value as ProviderItemSort; refresh(); }),
      this.checkbox('Show rank artwork', 'row:ranked', row.ranked, value => { row.ranked = value; refresh(); }),
      this.control('Remove row', 'remove-row', () => {
        const index = provider.rows.indexOf(row); provider.rows.splice(index, 1); this.selectedRows.set(provider.id, provider.rows[Math.min(index, provider.rows.length - 1)]?.id || '');
        this.changed(); this.render('add-row');
      }, '', 'tvl-provider-remove'));
    fields.append(el('p', 'tvl-provider-help', row.source.startsWith('trending') ? 'Trending uses the matching chart collection and its source order. Choose a collection override if no matching chart is available.'
      : row.source === 'collection' ? 'Only titles visible to this Jellyfin account can appear.' : 'Automatic shows titles in your Jellyfin library available with this service in the UK. A collection override uses your chosen collection instead.'));
    editor.append(fields, preview); this.workspace.append(editor); refresh();
  }
  private async renderRowPreview(provider: ProviderHomeConfig, row: ProviderRow, preview: HTMLElement): Promise<void> {
    const generation = ++this.previewGeneration;
    replace(preview, el('span', 'tvl-provider-preview-label', 'HOME ROW PREVIEW'), el('h3', '', row.title || 'Collection'));
    const status = el('p', 'tvl-provider-help'); preview.append(status);
    if (!row.enabled) { status.textContent = 'This row is hidden on the provider page.'; return; }
    if (row.source === 'collection' && !row.collectionId) { status.textContent = 'Choose a collection to preview this row.'; return; }
    const key = JSON.stringify([provider.id, provider.name, provider.movieProviderIds, provider.showProviderIds, provider.offerTypes, row.source, row.collectionId, row.itemSort]);
    try {
      let items = this.previewItems.get(key);
      if (!items) {
        status.textContent = 'Loading preview…';
        let request = this.previewPending.get(key);
        if (!request) {
          request = this.options.loadPreview({ ...provider, movieProviderIds: [...provider.movieProviderIds], showProviderIds: [...provider.showProviderIds], offerTypes: [...provider.offerTypes], rows: provider.rows.map(row => ({ ...row })) }, { ...row }); this.previewPending.set(key, request);
          void request.then(value => { if (!this.disposed) this.previewItems.set(key, value); }, () => undefined).then(() => { if (this.previewPending.get(key) === request) this.previewPending.delete(key); });
        }
        items = await request;
      }
      if (this.disposed || generation !== this.previewGeneration) return;
      status.textContent = items.length ? '' : 'No matching titles are available in this account’s library yet.';
      const cards = el('div', 'tvl-home-row-cards');
      items.slice(0, 8).forEach((item, index) => {
        const entry = el('div', 'tvl-home-row-entry'); entry.append(homeRowCard(this.api, item, row.ranked ? index + 1 : undefined)); cards.append(entry);
      }); preview.append(cards);
    } catch (error) {
      if (this.disposed || generation !== this.previewGeneration) return;
      status.textContent = error instanceof Error ? error.message : 'This preview could not load. Your draft is unchanged.';
      preview.append(this.control('Retry preview', 'retry-preview', () => { void this.renderRowPreview(provider, row, preview); }));
    }
  }
  private async save(): Promise<void> {
    if (this.disposed || !this.ready || this.saving || this.loading) return;
    for (const provider of this.draft.providers) {
      const invalid = this.providerError(provider);
      if (invalid) {
        this.selected = provider.id; this.render();
        if (invalid.focus.endsWith('ProviderIds') || invalid.focus.startsWith('offer-')) this.workspace.querySelector('details')!.open = true;
        this.restoreFocus(`provider:${invalid.focus}`); this.status.textContent = invalid.message; return;
      }
      const row = provider.rows.find(row => row.enabled && row.source === 'collection' && !row.collectionId);
      if (!row) continue;
      this.selected = provider.id; this.selectedRows.set(provider.id, row.id); this.render('row:collection');
      const collection = Array.from(this.workspace.querySelectorAll<HTMLElement>('[data-provider-settings-focus]')).find(node => node.dataset.providerSettingsFocus === 'row:collection');
      collection?.setAttribute('aria-invalid', 'true');
      this.status.textContent = `Choose a collection for “${row.title || 'Collection'}” before saving.`;
      return;
    }
    this.saving = true; this.saveButton.disabled = true; this.cancelButton.disabled = true; this.setControlsDisabled(true); this.status.textContent = 'Saving streaming services…';
    try {
      const saved = await this.store.save(cloneProviderHomes(this.draft)); if (this.disposed) return;
      this.draft = saved; this.saved = cloneProviderHomes(saved); this.providerIdInputs.clear(); this.render(); this.status.textContent = this.store.synced ? 'Saved to your Jellyfin account.' : 'Saved on this device.';
      this.reloadButton.hidden = true;
      window.dispatchEvent(new CustomEvent('tvl-provider-settings-changed', { detail: { serverId: this.api.serverId, userId: this.api.userId } }));
    } catch (error) {
      if (this.disposed) return;
      this.status.textContent = error instanceof ProviderHomesSyncError ? error.message : 'Streaming services could not be saved. Your draft is still here.';
      if (error instanceof ProviderHomesSyncError && (error.kind === 'conflict' || error.kind === 'stale')) {
        this.ready = false; this.reloadButton.hidden = error.kind === 'stale';
      }
    } finally {
      if (!this.disposed) { this.saving = false; this.saveButton.disabled = !this.ready; this.cancelButton.disabled = !this.ready; this.setControlsDisabled(false); }
    }
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.previewGeneration++; this.store.destroy(); this.removeRemote();
    window.removeEventListener('keydown', this.selectKeys, true); window.removeEventListener('keyup', this.selectKeys, true); window.removeEventListener('command', this.selectCommand, true);
    this.previewItems.clear(); this.previewPending.clear(); this.element.remove();
  }
}
