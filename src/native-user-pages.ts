import { el } from './dom';
import { currentUserAccount, isCurrentUserAdministrator, sameUserAccount, type CurrentUserAccount } from './current-user-policy';

const preferences = /^(mypreferencesmenu|mypreferencesdisplay|mypreferenceshome|mypreferencesplayback|mypreferencessubtitles|mypreferencescontrols|userprofile|quickconnect)\/?$/i;

/** Theme native Search/Settings without replacing their controllers or forms. */
export class NativeUserPages {
  private enabled = false;
  private scope: string | null = null;
  private disposed = false;
  private context = '';
  private revision = 0;
  private account: CurrentUserAccount | null = null;
  private administrator = false;
  private section?: HTMLElement;
  private activating = false;
  private observer: MutationObserver;

  constructor() {
    this.observer = new MutationObserver(() => this.attachDashboard());
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    window.addEventListener('hashchange', this.onRoute);
    window.addEventListener('popstate', this.onRoute);
    document.addEventListener('viewshow', this.onShow, true);
  }

  update(enabled: boolean, scope: string | null): void {
    if (this.disposed) return;
    this.enabled = enabled; this.scope = scope; this.refresh();
  }

  private toggle(name: string, enabled: boolean): void {
    if (document.body.classList.contains(name) !== enabled) document.body.classList.toggle(name, enabled);
  }
  private path(): string { return location.hash.replace(/^#\/?/, '').split('?')[0]; }
  private ownSettings(account = this.account): boolean {
    if (!this.enabled || !this.scope || !/^mypreferencesmenu\/?$/i.test(this.path()) || !account) return false;
    const editedUser = new URLSearchParams(location.hash.split('?')[1] || '').get('userId');
    return !editedUser || editedUser === account.userId;
  }

  private refresh(): void {
    if (this.disposed) return;
    this.toggle('tvl-native-search', this.enabled && /^search\/?$/i.test(this.path()));
    this.toggle('tvl-native-settings', this.enabled && preferences.test(this.path()));
    const account = currentUserAccount();
    const context = this.ownSettings(account) ? JSON.stringify([this.scope, location.hash]) : '';
    if (context === this.context && (!context || sameUserAccount(this.account))) { this.attachDashboard(); return; }
    this.context = context; this.account = account; this.administrator = false; this.activating = false;
    this.section?.querySelector('a')?.removeAttribute('aria-busy');
    const revision = ++this.revision; this.removeDashboard();
    if (!context) return;
    void isCurrentUserAdministrator(account).then(allowed => {
      if (this.disposed || revision !== this.revision || !this.ownSettings(account) || !sameUserAccount(account)) return;
      this.administrator = allowed; this.attachDashboard();
    });
  }

  private removeDashboard(): void { this.section?.remove(); }
  private attachDashboard(): void {
    if (this.disposed || !this.administrator || !this.ownSettings() || !sameUserAccount(this.account)) { this.removeDashboard(); return; }
    const host = document.querySelector<HTMLElement>('#myPreferencesMenuPage .readOnlyContent');
    if (!host || host.closest('.hide,[hidden]') || !host.getClientRects().length) { this.removeDashboard(); return; }
    // A newer native client may already expose this action on TV.
    const native = host.querySelector<HTMLElement>('a[href="#/dashboard"]:not(.tvl-settings-dashboard)');
    if (native && !native.closest('.hide,[hidden]') && native.getClientRects().length) { this.removeDashboard(); return; }
    if (!this.section) {
      this.section = el('section', 'adminSection verticalSection tvl-settings-admin');
      this.section.append(el('h2', 'sectionTitle headerUsername', 'Administration'));
      const link = el('a', 'emby-button show-focus listItem-border tvl-settings-dashboard'); link.href = '#/dashboard';
      const item = el('div', 'listItem');
      const glyph = el('span', 'material-icons listItemIcon listItemIcon-transparent dashboard'); glyph.setAttribute('aria-hidden', 'true');
      const body = el('div', 'listItemBody'); body.append(el('div', 'listItemBodyText', 'Dashboard')); item.append(glyph, body); link.append(item);
      link.addEventListener('click', event => {
        event.preventDefault();
        if (this.activating) return;
        const account = this.account, revision = this.revision;
        this.activating = true; link.setAttribute('aria-busy', 'true');
        void isCurrentUserAdministrator(account).then(allowed => {
          if (this.disposed || revision !== this.revision || !this.ownSettings(account) || !sameUserAccount(account)) return;
          if (!allowed) { this.administrator = false; this.removeDashboard(); return; }
          const dashboard = (window as Window & { Dashboard?: { navigate?(path: string): unknown } }).Dashboard;
          if (typeof dashboard?.navigate === 'function') dashboard.navigate('dashboard');
          else location.hash = '/dashboard';
        }).finally(() => {
          if (revision === this.revision) { this.activating = false; link.removeAttribute('aria-busy'); }
        });
      });
      this.section.append(link);
    }
    const before = host.querySelector<HTMLElement>('.userSection');
    if (this.section.parentElement !== host || this.section.nextElementSibling !== before) host.insertBefore(this.section, before);
  }

  private onRoute = (): void => { this.context = ''; this.refresh(); };
  private onShow = (event: Event): void => {
    if ((event.target as HTMLElement)?.id === 'myPreferencesMenuPage') { this.context = ''; this.refresh(); }
  };

  destroy(): void {
    if (this.disposed) return;
    this.enabled = false; this.scope = null; this.refresh(); this.disposed = true; this.revision++;
    this.observer.disconnect(); this.removeDashboard(); this.section = undefined;
    window.removeEventListener('hashchange', this.onRoute); window.removeEventListener('popstate', this.onRoute);
    document.removeEventListener('viewshow', this.onShow, true);
  }
}
