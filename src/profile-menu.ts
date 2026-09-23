import { button, el } from './dom';
import { attachRemote } from './remote';

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

  constructor() {
    document.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('command', this.onCommand, true);
    window.addEventListener('hashchange', this.onRoute);
    window.addEventListener('popstate', this.onRoute);
  }

  update(enabled: boolean, scope: string | null): void {
    if (this.disposed) return;
    if (!enabled || scope !== this.scope) this.close(false);
    this.enabled = enabled; this.scope = scope;
  }

  private avatar(node: EventTarget | null): HTMLElement | null {
    return node instanceof Element ? node.closest<HTMLElement>('.skinHeader .headerUserButton') : null;
  }

  private open(anchor: HTMLElement): boolean {
    if (!this.enabled || this.disposed || this.overlay || typeof dashboard()?.logout !== 'function') return false;
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
    panel.append(button('Switch profile', '', 'tvl-primary', () => {
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
    }), button('Close', '', '', () => this.close(true)), status);
    overlay.append(panel); this.overlay = overlay;
    overlay.addEventListener('click', event => { if (event.target === overlay) this.close(true); });
    document.body.append(overlay); document.body.classList.add('tvl-profile-open');
    this.detachRemote = attachRemote(panel, () => this.close(true));
    panel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return true;
  }

  private close(restore: boolean): void {
    this.detachRemote?.(); this.detachRemote = undefined;
    this.overlay?.remove(); this.overlay = undefined;
    if (document.body.classList.contains('tvl-profile-open')) document.body.classList.remove('tvl-profile-open');
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
  private onRoute = (): void => { this.close(false); };

  destroy(): void {
    if (this.disposed) return;
    this.close(true); this.disposed = true; this.enabled = false;
    document.removeEventListener('click', this.onClick, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('command', this.onCommand, true);
    window.removeEventListener('hashchange', this.onRoute);
    window.removeEventListener('popstate', this.onRoute);
  }
}
