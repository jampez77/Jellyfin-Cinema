/** The signed-out login page still has Jellyfin's device layout. Never require
 * an authenticated API or change the saved layout to enable the Cinema skin. */
export class NativeLoginTheme {
  private enabled = false;
  private disposed = false;

  constructor() {
    window.addEventListener('hashchange', this.refresh);
    window.addEventListener('popstate', this.refresh);
  }

  update(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    this.refresh();
  }

  private refresh = (): void => {
    if (this.disposed) return;
    const active = this.enabled && /^#\/?login\/?(?:\?|$)/i.test(location.hash);
    if (document.body.classList.contains('tvl-login-native') !== active) document.body.classList.toggle('tvl-login-native', active);
  };

  destroy(): void {
    if (this.disposed) return;
    this.update(false);
    this.disposed = true;
    window.removeEventListener('hashchange', this.refresh);
    window.removeEventListener('popstate', this.refresh);
  }
}
