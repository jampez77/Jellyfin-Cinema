// Remote key coverage follows InPlayerEpisodePreview-TV (MIT).
const keyCommands: Record<string, string> = {
  ArrowDown:'down', ArrowUp:'up', ArrowLeft:'left', ArrowRight:'right', Enter:'select',
  Escape:'back', Backspace:'back', BrowserBack:'back', GoBack:'back'
};
const remoteCodes: Record<number, string> = {13:'select',37:'left',38:'up',39:'right',40:'down',8:'back',27:'back',461:'back',10009:'back'};
export function attachRemote(root: HTMLElement, back: () => void, moveWithinPane?: (direction:string)=>boolean): () => void {
  let lastFocus: HTMLElement | null = null;
  const held = new Set<string>();
  const controls = () => Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"], a[href]'))
    .filter(node => !node.closest('[hidden]') && node.getClientRects().length > 0);
  const foreignDialog = () => Array.from(document.querySelectorAll<HTMLElement>('.dialogContainer .dialog.opened, dialog[open], [role="dialog"][aria-modal="true"]'))
    .some(node => node !== root && !root.contains(node) && !node.closest('.hide, [hidden]') && !!node.getClientRects().length);
  const focus = (node?: HTMLElement) => { if (!node) return; node.focus({preventScroll:true}); node.scrollIntoView({block:'nearest',inline:'nearest'}); lastFocus = node; };
  function move(direction: string) {
    if (moveWithinPane?.(direction)) return;
    const nodes = controls();
    const current = document.activeElement as HTMLElement;
    if (!root.contains(current)) {focus(lastFocus?.isConnected ? lastFocus : nodes[0]); return;}
    const box = current.getBoundingClientRect();
    const cx = box.left + box.width/2, cy = box.top + box.height/2;
    const horizontal = direction === 'left' || direction === 'right';
    const sign = direction === 'right' || direction === 'down' ? 1 : -1;
    const candidates = nodes.filter(node => node !== current).map(node => {
      const b = node.getBoundingClientRect();
      const dx = b.left + b.width/2-cx, dy = b.top + b.height/2-cy;
      const along = (horizontal ? dx : dy)*sign;
      const across = Math.abs(horizontal ? dy : dx);
      const overlap = horizontal ? b.bottom > box.top && b.top < box.bottom : b.right > box.left && b.left < box.right;
      return {node, along, score: along + across * 2.5 + (overlap ? 0 : 500)};
    }).filter(x => x.along > 4).sort((a,b) => a.score-b.score);
    focus(candidates[0]?.node);
  }
  function act(command: string) {
    if (command === 'back') back();
    else if (command === 'select') {
      const active = document.activeElement as HTMLElement;
      if (root.contains(active)) active.click?.();
      else focus(controls()[0]);
    }
    else move(command);
  }
  const keydown = (event: KeyboardEvent) => {
    if (foreignDialog() || event.altKey || event.ctrlKey || event.metaKey) return;
    const command = keyCommands[event.key] || remoteCodes[event.keyCode];
    if (!command && event.key !== 'Tab') return;
    event.preventDefault(); event.stopImmediatePropagation();
    root.classList.add('tvl-keyboard');
    if (event.key === 'Tab') {
      const nodes = controls(); const index = nodes.indexOf(document.activeElement as HTMLElement);
      focus(nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]); return;
    }
    // Some TV remotes omit keyup. A new non-repeating keydown is still a
    // fresh press; repeated keydown must never start playback twice.
    if (!event.repeat) held.delete(command);
    if ((command === 'select' || command === 'back') && (event.repeat || held.has(command))) return;
    held.add(command); act(command);
  };
  const keyup = (event: KeyboardEvent) => {
    const command = keyCommands[event.key] || remoteCodes[event.keyCode];
    held.delete(command);
    if (command && !foreignDialog()) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const command = (event: Event) => {
    if (foreignDialog()) return;
    const value = (event as CustomEvent).detail?.command?.toLowerCase();
    const translated = value === 'enter' || value === 'ok' ? 'select' : value;
    if (!['select','back','left','right','up','down'].includes(translated)) return;
    event.preventDefault(); event.stopImmediatePropagation(); act(translated);
  };
  const onFocus = (event: FocusEvent) => {
    if (foreignDialog()) return;
    if (root.contains(event.target as Node)) lastFocus = event.target as HTMLElement;
    else focus(lastFocus?.isConnected ? lastFocus : controls()[0]);
  };
  const clear = () => held.clear();
  window.addEventListener('keydown',keydown,true);
  window.addEventListener('keyup',keyup,true);
  window.addEventListener('command',command,true);
  window.addEventListener('blur',clear);
  document.addEventListener('focusin',onFocus,true);
  return () => {
    window.removeEventListener('keydown',keydown,true); window.removeEventListener('keyup',keyup,true);
    window.removeEventListener('command',command,true);window.removeEventListener('blur',clear);
    document.removeEventListener('focusin',onFocus,true);
  };
}
