export type HomeAnchor = { key: string; label: string };
export type HomeAnchorNode = HomeAnchor & { element: HTMLElement };

/** Discover individual native rows, including each library within Latest media. */
export function nativeHomeRows(host: HTMLElement): HomeAnchorNode[] {
  const counts = new Map<string, number>();
  const candidates = Array.from(host.querySelectorAll<HTMLElement>('.verticalSection, .ec-root'));
  return candidates.filter(node => {
    if (node.closest('.tvl-home-collection-row') || node.querySelector('.verticalSection, .ec-root')) return false;
    for (let parent: HTMLElement | null = node; parent && parent !== host; parent = parent.parentElement) {
      if (parent.hidden || parent.classList.contains('hide')) return false;
    }
    return !!node.querySelector('.sectionTitle, h2, .homeLibraryButton') || node.classList.contains('ec-root');
  }).map(element => {
    const label = element.classList.contains('ec-root') ? 'Featured'
      : (element.querySelector('.sectionTitle, h2')?.textContent || element.getAttribute('aria-label') || 'My Media').trim().slice(0, 100);
    const base = label.toLocaleLowerCase().replace(/\s+/g, ' ');
    const occurrence = (counts.get(base) || 0) + 1; counts.set(base, occurrence);
    return { key: `native:${base}:${occurrence}`, label: occurrence > 1 ? `${label} (${occurrence})` : label, element };
  }).filter(({ element }) => {
    // Some Home plugins retain alternate native row variants with display:none.
    // Assign keys first so filtering those variants does not rename saved anchors.
    for (let parent: HTMLElement | null = element; parent && parent !== host; parent = parent.parentElement) {
      if (getComputedStyle(parent).display === 'none') return false;
    }
    return true;
  }).sort((a, b) => {
    // HomeScreen Sections can reorder native siblings with flex order. This also
    // works while Home is hidden behind the row editor (all rectangles are zero).
    const parent = a.element.parentElement;
    if (parent && parent === b.element.parentElement && /flex|grid/.test(getComputedStyle(parent).display)) {
      const order = Number(getComputedStyle(a.element).order) - Number(getComputedStyle(b.element).order);
      if (order) return order;
    }
    return a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top;
  });
}

export function cachedHomeRows(key: string): HomeAnchor[] {
  try {
    const value = JSON.parse(localStorage.getItem(`${key}:positions`) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(row => row && typeof row.key === 'string' && row.key.startsWith('native:') && row.key.length <= 240
      && typeof row.label === 'string' && row.label.length <= 120).slice(0, 100);
  } catch { return []; }
}

export function rememberHomeRows(key: string, anchors: HomeAnchor[]): void {
  if (!anchors.length) return;
  const value = JSON.stringify(anchors.map(({ key, label }) => ({ key, label })));
  try { if (localStorage.getItem(`${key}:positions`) !== value) localStorage.setItem(`${key}:positions`, value); } catch { /* Home remains usable without storage. */ }
}
