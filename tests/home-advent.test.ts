import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adventDoorState, dailyAdvent } from '../src/home-advent';
import type { HomeCollectionRow } from '../src/home-collection-settings';

const row = (start = '12-01', end = '12-31'): HomeCollectionRow => ({ id: 'advent', kind: 'items', title: 'Advent', collectionIds: ['christmas'], ranked: false,
  placement: 'end', itemSort: 'custom', itemOrder: [], season: { start, end },
  appearance: { theme: 'christmas', background: 'none', expansion: 'none', frame: true, reveal: 'advent', adventUnlock: 'daily' } });

test('daily doors open on their numbered local date, including exact midnight and later visits', () => {
  const calendar = row();
  assert.equal(adventDoorState(calendar, 0, new Date(2026, 10, 30, 23, 59, 59)).locked, true);
  assert.equal(adventDoorState(calendar, 0, new Date(2026, 11, 1)).locked, false);
  assert.equal(adventDoorState(calendar, 1, new Date(2026, 11, 1, 23, 59, 59)).locked, true);
  assert.equal(adventDoorState(calendar, 1, new Date(2026, 11, 2)).locked, false);
  assert.equal(adventDoorState(calendar, 24, new Date(2026, 11, 24, 23, 59)).locked, true);
  assert.equal(adventDoorState(calendar, 24, new Date(2026, 11, 25)).locked, false);
  assert.equal(adventDoorState(calendar, 0, new Date(2027, 10, 30)).locked, true);
});

test('season starts, year boundaries and daylight changes use calendar dates', () => {
  let state = adventDoorState(row('12-15', '01-15'), 17, new Date(2027, 0, 1));
  assert.equal(state.locked, false); assert.equal(state.opens?.getFullYear(), 2027);
  assert.equal(state.opens?.getMonth(), 0); assert.equal(state.opens?.getDate(), 1);
  state = adventDoorState(row('12-15', '01-15'), 18, new Date(2027, 0, 1));
  assert.equal(state.locked, true);
  for (const start of ['03-28', '10-24']) {
    const date = new Date(2026, Number(start.slice(0, 2)) - 1, Number(start.slice(3)) + 2);
    state = adventDoorState(row(start, '12-31'), 2, date);
    assert.equal(state.locked, false); assert.equal(state.opens?.getHours(), 0); assert.equal(state.opens?.getDate(), date.getDate());
  }
});

test('focus mode and existing doors remain unrestricted; malformed daily dates fail closed', () => {
  const calendar = row();
  for (const unlock of [undefined, 'focus'] as const) {
    calendar.appearance!.adventUnlock = unlock;
    assert.equal(dailyAdvent(calendar), false);
    assert.equal(adventDoorState(calendar, 24, new Date(2026, 9, 3)).locked, false);
  }
  calendar.appearance!.adventUnlock = 'daily'; calendar.appearance!.reveal = 'doors';
  assert.equal(dailyAdvent(calendar), false);
  calendar.appearance!.reveal = 'advent';
  assert.equal(adventDoorState(calendar, 1, new Date(NaN)).locked, true);
  delete calendar.season;
  assert.equal(adventDoorState(calendar, 1).locked, true);
});
