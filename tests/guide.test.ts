import test from 'node:test';
import assert from 'node:assert/strict';
import { guideSlots, nearestGuideSlot } from '../src/guide-layout';
import type { Item } from '../src/types';

const at = Date.parse('2026-09-22T12:00:00Z');
const minute = 60_000;
const programme = (id: string, start: number, end: number): Item => ({Id: id, Name: id, StartDate: new Date(at + start * minute).toISOString(), EndDate: new Date(at + end * minute).toISOString()});

test('guide cells share broadcast-time coordinates and preserve relative duration', () => {
  const slots = guideSlots([programme('long', 60, 120), programme('short', 0, 30)], at, 180 * minute);
  assert.deepEqual(slots.map(slot => slot.item.Id), ['short', 'long']);
  assert.equal(slots[1]!.width, slots[0]!.width * 2);
  assert.ok(Math.abs(slots[1]!.left - 100 / 3) < 1e-10);
});

test('guide clips programmes across window edges and omits invalid, duplicate, or outside slots', () => {
  const slots = guideSlots([
    programme('current', -30, 30), programme('current', -30, 30), programme('late', 150, 210),
    programme('ended', -60, 0), programme('tomorrow', 180, 240), programme('reversed', 90, 30),
    {Id: 'missing', Name: 'No schedule'}
  ], at, 180 * minute);
  assert.equal(slots.length, 2);
  assert.equal(slots[0]!.left, 0);
  assert.ok(Math.abs(slots[0]!.width - 100 / 6) < 1e-10);
  assert.equal(slots[1]!.left + slots[1]!.width, 100);
});

test('vertical guide navigation retains the broadcast time rather than programme index', () => {
  const slots = guideSlots([programme('news', 0, 15), programme('film', 15, 120), programme('sport', 150, 180)], at);
  assert.equal(nearestGuideSlot(slots, at + 60 * minute)?.item.Id, 'film');
  assert.equal(nearestGuideSlot(slots, at + 15 * minute)?.item.Id, 'film');
  assert.equal(nearestGuideSlot(slots, at + 145 * minute)?.item.Id, 'sport');
  assert.equal(nearestGuideSlot([], at), undefined);
});
