import { button, el, replace } from './dom';
import { attachRemote } from './remote';
import { currentUserAccount, isCurrentUserAdministrator, sameUserAccount } from './current-user-policy';
import { openProfileLogin, profileImage, profileSession, profileSwitchPending, ProfileLoginRequired, publicProfiles, sameProfileServer, sameProfileSession, switchPublicProfile,
  type ProfileSession, type ProfileSwitchPhase, type PublicProfile } from './profile-auth';

type NativeDashboard = { logout(): void; navigate?(route: string): unknown };
const dashboard = () => (window as Window & { Dashboard?: NativeDashboard }).Dashboard;

/** Keep Jellyfin's avatar and authentication flow; offer a shorter TV path to
 * its native sign-in/user chooser. Desktop retains the native avatar handler. */
export class ProfileMenu {
  private enabled = false;
  private scope: string | null | undefined;
  private disposed = false;
  private overlay?: HTMLElement;
  private anchor?: HTMLElement;
  private expanded: string | null = null;
  private popup: string | null = null;
  private detachRemote?: () => void;
  private switching?: { cancel: () => void; remove: () => void; routeChanged: () => void };

  constructor() {
    document.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('command', this.onCommand, true);
    window.addEventListener('hashchange', this.onRoute);
    window.addEventListener('popstate', this.onRoute);
  }

  update(enabled: boolean, scope: string | null): void {
    if (this.disposed) return;
    if (!document.documentElement.classList.contains('layout-tv') && !document.body.classList.contains('layout-tv')) this.switching?.cancel();
    if (!enabled || scope !== this.scope) this.close(false);
    this.enabled = enabled; this.scope = scope;
  }

  private avatar(node: EventTarget | null): HTMLElement | null {
    return node instanceof Element ? node.closest<HTMLElement>('.skinHeader .headerUserButton') : null;
  }

  private open(anchor: HTMLElement): boolean {
    if (!this.enabled || this.disposed || this.overlay || this.switching || profileSwitchPending() || typeof dashboard()?.logout !== 'function') return false;
    // Do not compete with an existing native or Cinema modal.
    if (Array.from(document.querySelectorAll<HTMLElement>('.dialogContainer .dialog.opened, dialog[open], [role="dialog"][aria-modal="true"]'))
      .some(node => !node.closest('.hide,[hidden]') && !!node.getClientRects().length)) return false;
    this.anchor = anchor; this.expanded = anchor.getAttribute('aria-expanded'); this.popup = anchor.getAttribute('aria-haspopup');
    anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-haspopup', 'dialog');
    const overlay = el('div', 'tvl-profile-overlay');
    const panel = el('section', 'tvl-profile-menu'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Profile options');
    panel.append(el('h2', '', 'Profile'));
    const name = anchor.title || anchor.getAttribute('aria-label');
    if (name) panel.append(el('p', 'tvl-profile-name', name));
    const status = el('p', 'tvl-profile-status'); status.setAttribute('role', 'status'); status.hidden = true;
    const close = button('Close', '', '', () => this.close(true));
    panel.append(button('Switch profile', '', 'tvl-primary', () => {
      const session = profileSession();
      if (session) { void this.chooseProfile(panel, overlay, session); return; }
      try {
        const native = dashboard();
        if (typeof native?.logout !== 'function') throw new Error('Native profile switching is unavailable');
        // Dashboard.logout also clears Jellyfin's view/query caches and chooses
        // the appropriate native login/server page. Do not bypass that cleanup.
        native.logout(); this.close(false);
      } catch {
        status.hidden = false; status.textContent = 'Could not switch profile. Please try again.';
      }
    }), button('Settings', '', '', () => {
      this.close(false);
      const native = dashboard();
      if (typeof native?.navigate === 'function') native.navigate('mypreferencesmenu');
      else location.hash = '/mypreferencesmenu';
    }), close, status);
    overlay.append(panel); this.overlay = overlay;
    overlay.addEventListener('click', event => { if (event.target === overlay) this.close(true); });
    document.body.append(overlay); document.body.classList.add('tvl-profile-open');
    this.detachRemote = attachRemote(panel, () => this.close(true));
    panel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    void this.addDashboard(panel, overlay, close, status);
    return true;
  }

  private async addDashboard(panel: HTMLElement, overlay: HTMLElement, before: HTMLElement, status: HTMLElement): Promise<void> {
    const account = currentUserAccount();
    const current = () => this.overlay === overlay && panel.contains(before) && sameUserAccount(account);
    if (!await isCurrentUserAdministrator(account) || !current()) return;
    const action = button('Dashboard', '', '', () => {
      if (action.disabled) return;
      action.disabled = true;
      void isCurrentUserAdministrator(account).then(allowed => {
        if (!current()) return;
        if (!allowed) {
          action.remove(); status.hidden = false;
          status.textContent = 'Dashboard access is no longer available.';
          before.focus({ preventScroll: true }); return;
        }
        this.close(false);
        const native = dashboard();
        if (typeof native?.navigate === 'function') native.navigate('dashboard');
        else location.hash = '/dashboard';
      }).finally(() => { action.disabled = false; });
    });
    panel.insertBefore(action, before);
  }

  private async chooseProfile(panel: HTMLElement, overlay: HTMLElement, session: ProfileSession): Promise<void> {
    panel.classList.add('tvl-profile-chooser'); panel.setAttribute('aria-label', 'Choose profile');
    const description = el('p', 'tvl-profile-explanation', 'Profiles without a password open directly. Password-protected profiles use Jellyfin’s login screen.');
    const grid = el('div', 'tvl-profile-grid');
    const status = el('p', 'tvl-profile-status', 'Loading profiles…'); status.setAttribute('role', 'status');
    const login = button('Use login screen', '', '', () => {
      if (!current() || profileSwitchPending()) { this.close(false); return; }
      login.disabled = true;
      status.textContent = 'Closing the current session…';
      void openProfileLogin(session).then(() => this.close(false)).catch(() => {
        if (current()) { status.textContent = 'Could not open the login screen. Please try again.'; login.disabled = false; }
      });
    });
    const back = button('Back', '', '', () => this.close(true));
    replace(panel, el('h2', '', 'Choose profile'), description, grid, status, login, back);
    back.focus({ preventScroll: true });
    const current = () => this.overlay === overlay && panel.contains(grid) && sameProfileSession(session);
    try {
      const profiles = await publicProfiles(session);
      if (!current()) return;
      status.textContent = profiles.length ? '' : 'No public profiles are available. Use the login screen for a hidden account.';
      for (const profile of profiles) {
        const selected = profile.Id.replace(/-/g, '').toLowerCase() === session.userId.replace(/-/g, '').toLowerCase();
        const control = button('', '', 'tvl-profile-card', () => {
          if (profile.HasPassword) { login.click(); return; }
          this.startSwitch(session, profile);
        });
        control.disabled = selected;
        control.setAttribute('aria-label', `${profile.Name}, ${selected ? 'current profile' : profile.HasPassword ? 'password required' : 'switch profile'}`);
        const fallback = el('span', 'tvl-profile-avatar', profile.Name.slice(0, 1).toLocaleUpperCase()); fallback.setAttribute('aria-hidden', 'true');
        const url = profileImage(session, profile);
        if (url) {
          const image = el('img', 'tvl-profile-avatar'); image.src = url; image.alt = '';
          image.addEventListener('error', () => image.replaceWith(fallback), { once: true }); control.append(image);
        } else control.append(fallback);
        control.append(el('span', 'tvl-profile-card-name', profile.Name),
          el('span', 'tvl-profile-card-note', selected ? 'Current profile' : profile.HasPassword ? 'Password required' : 'Open profile'));
        grid.append(control);
      }
      if (document.activeElement === back) (grid.querySelector<HTMLElement>('button:not(:disabled)') || login).focus({ preventScroll: true });
    } catch {
      if (current()) status.textContent = 'Could not load profiles. Try again or use the login screen.';
    }
  }

  private startSwitch(session: ProfileSession, profile: PublicProfile): void {
    if (this.switching || profileSwitchPending() || !sameProfileSession(session)) return;
    this.close(false);
    const controller = new AbortController();
    const start = location.hash;
    let phase: ProfileSwitchPhase = 'checking';
    const overlay = el('div', 'tvl-profile-overlay tvl-profile-switching');
    const panel = el('section', 'tvl-profile-menu'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Switching profile');
    const status = el('p', 'tvl-profile-status', 'Checking profile…'); status.setAttribute('role', 'status');
    let adopting = false;
    const cancel = () => { if (!adopting) { controller.abort(); remove(); } };
    const cancelButton = button('Cancel', '', '', cancel);
    panel.append(el('h2', '', `Opening ${profile.Name}`), status, cancelButton); overlay.append(panel);
    document.body.append(overlay); document.body.classList.add('tvl-profile-open');
    const detach = attachRemote(panel, cancel);
    const remove = () => {
      detach(); overlay.remove();
      if (this.switching?.remove === remove) this.switching = undefined;
      if (!this.overlay && document.body.classList.contains('tvl-profile-open')) document.body.classList.remove('tvl-profile-open');
    };
    const forceCancel = () => { controller.abort(); remove(); };
    this.switching = { cancel: forceCancel, remove, routeChanged: () => {
      const login = /^#\/?(?:login|selectserver)\/?(?:\?|$)/i.test(location.hash);
      if (phase === 'checking' ? location.hash !== start : phase === 'signing-out' ? location.hash !== start && !login
        : phase === 'signing-in' ? !login : !login && !/^#\/?home\/?(?:\?|$)/i.test(location.hash)) forceCancel();
    } }; cancelButton.focus({ preventScroll: true });
    void switchPublicProfile(session, profile.Id, controller.signal, next => {
      phase = next; adopting = phase === 'opening' || phase === 'signing-out'; cancelButton.disabled = adopting;
      status.textContent = phase === 'checking' ? 'Checking profile…' : phase === 'signing-out' ? 'Closing the current session…'
        : phase === 'signing-in' ? 'Signing in…' : 'Opening your Home page…';
    }).then(remove).catch(error => {
      if (controller.signal.aborted || this.disposed || error?.name === 'AbortError') { remove(); return; }
      adopting = false; cancelButton.remove();
      const needsLogin = error instanceof ProfileLoginRequired || !session.client.getCurrentUserId();
      const failedUser = session.client.getCurrentUserId();
      status.textContent = error instanceof ProfileLoginRequired ? error.message
        : needsLogin ? 'Could not sign in to that profile. Continue with Jellyfin’s login screen.' : 'Could not switch profile. Your current session is still open.';
      const action = button(needsLogin ? 'Continue to login' : 'Close', '', 'tvl-primary', () => {
        remove();
        if (needsLogin && sameProfileServer(session) && session.client.getCurrentUserId() === failedUser) {
          if (session.client.getCurrentUserId()) void openProfileLogin(session).catch(() => {});
          else session.dashboard.navigate(`login?serverid=${encodeURIComponent(session.serverId)}`);
        }
      });
      panel.append(action); action.focus({ preventScroll: true });
    });
  }

  private close(restore: boolean): void {
    this.detachRemote?.(); this.detachRemote = undefined;
    this.overlay?.remove(); this.overlay = undefined;
    if (!this.switching && document.body.classList.contains('tvl-profile-open')) document.body.classList.remove('tvl-profile-open');
    const anchor = this.anchor; this.anchor = undefined;
    if (!anchor) return;
    for (const [name, value] of [['aria-expanded', this.expanded], ['aria-haspopup', this.popup]] as const) {
      if (value === null) anchor.removeAttribute(name); else anchor.setAttribute(name, value);
    }
    if (restore && anchor.isConnected && anchor.getClientRects().length) anchor.focus({ preventScroll: true });
  }

  private onClick = (event: MouseEvent): void => {
    if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const anchor = this.avatar(event.target);
    if (anchor && this.open(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['Enter', ' ', 'Spacebar'].includes(event.key) && event.keyCode !== 13) return;
    const anchor = this.avatar(document.activeElement);
    if (anchor && this.open(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onCommand = (event: Event): void => {
    const command = (event as CustomEvent).detail?.command?.toLowerCase();
    if (!['select', 'enter', 'ok'].includes(command)) return;
    const anchor = this.avatar(document.activeElement);
    if (anchor && this.open(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private onRoute = (): void => { this.close(false); this.switching?.routeChanged(); };

  destroy(): void {
    if (this.disposed) return;
    this.switching?.cancel(); this.switching?.remove();
    this.close(true); this.disposed = true; this.enabled = false;
    document.removeEventListener('click', this.onClick, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('command', this.onCommand, true);
    window.removeEventListener('hashchange', this.onRoute);
    window.removeEventListener('popstate', this.onRoute);
  }
}
