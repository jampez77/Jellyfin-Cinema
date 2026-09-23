import type { Item } from './types';

export const GUIDE_MINUTE = 60_000;
export const GUIDE_DURATION = 24 * 60 * GUIDE_MINUTE;
export type GuideSlot = { item: Item; start: number; end: number; left: number; width: number };

/** All channels share these coordinates; a programme crossing the window is clipped. */
export function guideSlots(items: Item[], windowStart: number, duration = GUIDE_DURATION): GuideSlot[] {
  const windowEnd = windowStart + duration;
  const seen = new Set<string>();
  return items.flatMap(item => {
    const start = Date.parse(item.StartDate || '');
    const end = Date.parse(item.EndDate || '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= windowStart || start >= windowEnd || seen.has(item.Id)) return [];
    seen.add(item.Id);
    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    return [{item, start, end, left: (clippedStart - windowStart) / duration * 100, width: (clippedEnd - clippedStart) / duration * 100}];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Up/down retains broadcast time, including unequal programme lengths and gaps. */
export function nearestGuideSlot(slots: GuideSlot[], at: number): GuideSlot | undefined {
  return slots.reduce<GuideSlot | undefined>((best, slot) => {
    const distance = at < slot.start ? slot.start - at : at >= slot.end ? at - slot.end + 1 : 0;
    if (!best) return slot;
    const bestDistance = at < best.start ? best.start - at : at >= best.end ? at - best.end + 1 : 0;
    return distance < bestDistance ? slot : best;
  }, undefined);
}
