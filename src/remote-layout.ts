/** Keep off-screen rows navigable, but ignore controls that cannot receive focus. */
export function remoteControls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], a[href]'))
    .filter(node => !node.closest('.hide,[hidden],[inert]') && node.getClientRects().length > 0
      && !['hidden', 'collapse'].includes(getComputedStyle(node).visibility));
}

/** Use row tops, not card centres: captions can give siblings different heights. */
export function remoteRows(nodes: HTMLElement[]): HTMLElement[][] {
  const rows: { top: number; nodes: HTMLElement[] }[] = [];
  for (const node of [...nodes].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
    const top = node.getBoundingClientRect().top;
    // Focus treatments can lift a card by a couple of pixels.
    const row = rows.find(row => Math.abs(row.top - top) <= 6);
    if (row) row.nodes.push(node);
    else rows.push({ top, nodes: [node] });
  }
  return rows.map(row => row.nodes.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left));
}

export function remoteCenter(node: HTMLElement): number {
  const box = (node.querySelector('.tvl-home-row-art') || node).getBoundingClientRect();
  return box.left + box.width / 2;
}

export function nearestRemoteControl(nodes: HTMLElement[], x: number): HTMLElement | undefined {
  return [...nodes].sort((a, b) => Math.abs(remoteCenter(a) - x) - Math.abs(remoteCenter(b) - x))[0];
}
