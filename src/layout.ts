/** Follow Jellyfin's chosen display mode without changing its native controls. */
export function isCinemaLayout(): boolean {
  const roots = [document.documentElement, document.body];
  return !roots.some(node => node.classList.contains('layout-mobile'))
    && roots.some(node => node.classList.contains('layout-tv') || node.classList.contains('layout-desktop'));
}

export function isDesktopLayout(): boolean {
  return isCinemaLayout()
    && ![document.documentElement, document.body].some(node => node.classList.contains('layout-tv'));
}
