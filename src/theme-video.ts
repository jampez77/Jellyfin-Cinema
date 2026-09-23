/** Reveal Jellyfin's own background player without starting a second stream.
 * Jellyfin 10.11/12 marks theme playback with transparentDocument and uses the
 * regular HTML video container without its fullscreen/on-top class.
 */
export function observeThemeVideo(root: HTMLElement): () => void {
  let current: HTMLElement | null = null;
  let frame: number | undefined;
  let disposed = false;
  const events = ['playing', 'pause', 'ended', 'emptied', 'error', 'loadeddata', 'resize'];

  function sync(): void {
    frame = undefined;
    if (disposed) return;
    let next: HTMLElement | null = null;
    if (root.isConnected && ['Movie', 'Series'].includes(root.dataset.kind || '')
      && document.documentElement.classList.contains('transparentDocument')) {
      for (const player of Array.from(document.querySelectorAll<HTMLElement>('.videoPlayerContainer:not(.videoPlayerContainer-onTop)'))) {
        const video = player.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
        if (!video || video.paused || video.ended || video.error || video.readyState < 2
          || !video.videoWidth || !video.videoHeight || player.hidden || player.classList.contains('hide')) continue;
        const style = getComputedStyle(player);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        next = player;
        break;
      }
    }
    if (current !== next) {
      current?.classList.remove('tvl-theme-player');
      next?.classList.add('tvl-theme-player');
      current = next;
    }
    if (root.classList.contains('tvl-theme-video') !== !!next) root.classList.toggle('tvl-theme-video', !!next);
  }
  function schedule(): void {
    if (!disposed && frame === undefined) frame = requestAnimationFrame(sync);
  }
  // Native player creation, replacement and transparency changes are asynchronous
  // with item rendering. Media events are captured because they do not bubble.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-kind'] });
  for (const event of events) document.addEventListener(event, schedule, true);
  sync();
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const event of events) document.removeEventListener(event, schedule, true);
    current?.classList.remove('tvl-theme-player');
    root.classList.remove('tvl-theme-video');
  };
}
