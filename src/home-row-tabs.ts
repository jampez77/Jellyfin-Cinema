import { button, el } from './dom';

/** Shared switch appearance for a Home row and its editable preview. */
export function homeRowTabs(tabs: { id: string; label: string }[], selected: string, choose: (id: string) => void, idPrefix: string): HTMLElement {
  const strip = el('div', 'tvl-home-source-tabs focuscontainer-x');
  strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-label', 'Collection tabs');
  for (const tab of tabs) {
    const control = button(tab.label, '', 'tvl-home-source-tab', () => choose(tab.id));
    control.id = `${idPrefix}-tab-${encodeURIComponent(tab.id)}`;
    control.dataset.sourceTab = tab.id;
    control.setAttribute('role', 'tab'); control.setAttribute('aria-selected', String(tab.id === selected));
    control.setAttribute('aria-controls', `${idPrefix}-items`);
    control.tabIndex = tab.id === selected ? 0 : -1;
    strip.append(control);
  }
  return strip;
}
