import { validSeasonDate, type HomeCollectionRow } from './home-collection-settings';

export function dailyAdvent(row: HomeCollectionRow): boolean {
  return row.kind === 'items' && row.appearance?.theme === 'christmas'
    && row.appearance.reveal === 'advent' && row.appearance.adventUnlock === 'daily';
}

/** Door positions use local calendar days, not elapsed 24-hour periods. */
export function adventDoorState(row: HomeCollectionRow, index: number, date = new Date()): { day: number; locked: boolean; opens?: Date } {
  const day = Number.isFinite(index) ? Math.max(1, Math.floor(index) + 1) : 1;
  if (!dailyAdvent(row)) return { day, locked: false };
  const season = row.season;
  if (!season || !validSeasonDate(season.start) || !validSeasonDate(season.end) || !Number.isFinite(date.getTime())) return { day, locked: true };
  const today = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  // January belongs to the preceding December when the season spans New Year.
  const year = date.getFullYear() - (season.start > season.end && today <= season.end ? 1 : 0);
  const [month, start] = season.start.split('-').map(Number);
  const opens = new Date(year, month - 1, start + day - 1);
  return { day, opens, locked: date.getTime() < opens.getTime() };
}
