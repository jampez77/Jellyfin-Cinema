import test from 'node:test';
import assert from 'node:assert/strict';
import { episodeCode, isLive, playable, programmeProgress, progress, runtime, seasonName, time } from '../src/utils';
import type { Item } from '../src/types';

const item = (extra: Partial<Item> = {}): Item => ({ Id: 'item', Name: '', ...extra });

test('duration labels cover unknown, minute, and hour runtimes', () => {
  assert.equal(runtime(), '');
  assert.equal(runtime(-1), '');
  assert.equal(runtime(45 * 600_000_000), '45m');
  assert.equal(runtime(60 * 600_000_000), '1h');
  assert.equal(runtime(125 * 600_000_000), '2h 5m');
});

test('watch progress is bounded and watched items remain complete', () => {
  assert.equal(progress(item()), 0);
  assert.equal(progress(item({ RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 25 } })), 25);
  assert.equal(progress(item({ RunTimeTicks: 100, UserData: { PlaybackPositionTicks: -5 } })), 0);
  assert.equal(progress(item({ RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 150 } })), 100);
  assert.equal(progress(item({ UserData: { Played: true } })), 100);
});

test('specials and descriptive season names stay distinct from generic labels', () => {
  assert.equal(seasonName(item({ Name: 'Series 0', IndexNumber: 0 })), 'Specials');
  assert.equal(seasonName(item({ Name: ' Chapter 2 ', IndexNumber: 2 })), 'Season 2');
  assert.equal(seasonName(item({ Name: 'The Northern Passage', IndexNumber: 2 })), 'The Northern Passage');
  assert.equal(seasonName(item()), 'Episodes');
});

test('episode labels preserve zero and gracefully omit unknown numbering', () => {
  assert.equal(episodeCode(item({ ParentIndexNumber: 0, IndexNumber: 1 })), 'S0 · E1');
  assert.equal(episodeCode(item({ IndexNumber: 4 })), 'E4');
  assert.equal(episodeCode(item()), '');
});

test('live status and guide progress agree at programme boundaries', () => {
  const programme = item({ StartDate: '2026-09-22T12:00:00Z', EndDate: '2026-09-22T13:00:00Z' });
  const start = Date.parse(programme.StartDate!);
  const end = Date.parse(programme.EndDate!);
  assert.equal(isLive(programme, start - 1), false);
  assert.equal(isLive(programme, start), true);
  assert.equal(isLive(programme, end - 1), true);
  assert.equal(isLive(programme, end), false);
  assert.equal(programmeProgress(programme, start - 1), 0);
  assert.equal(programmeProgress(programme, (start + end) / 2), 50);
  assert.equal(programmeProgress(programme, end + 1), 100);
  assert.equal(programmeProgress(item()), 0);
  assert.equal(isLive(item(), start), false);
  assert.equal(programmeProgress(item({ StartDate: programme.EndDate, EndDate: programme.StartDate })), 0);
});

test('unavailable media cannot expose a working playback action', () => {
  assert.equal(playable(item()), true);
  for (const restriction of [{ Id: '' }, { PlayAccess: 'None' }, { IsMissing: true }, { IsVirtualItem: true }, { IsPlaceHolder: true }, { LocationType: 'Virtual' }]) {
    assert.equal(playable(item(restriction)), false);
  }
});

test('invalid schedule dates do not leak Invalid Date into the interface', () => {
  assert.equal(time(), '');
  assert.equal(time('not-a-date'), '');
  assert.ok(time('2026-09-22T13:00:00Z').length > 0);
});
