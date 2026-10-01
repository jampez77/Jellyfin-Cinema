export const homeLibraryExcludedClass = 'tvl-home-library-excluded';

function libraryId(value: string): string | undefined {
  return /^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(value)
    ? value.replace(/-/g, '').toLowerCase() : undefined;
}

/** Home Screen Sections creates RecentlyAddedInLibrary rows independently of
 * Jellyfin's LatestItemsExcludes and MyMediaExcludes preferences. Match its IDs,
 * including on TV where the heading has no library link, without changing the
 * plugin's configuration or hiding deliberately selected collection rows. */
export class HomeLibraryVisibility {
  private exclusions = new Set<string>();
  private hidden = new Set<HTMLElement>();

  setExclusions(ids: readonly string[]): void {
    this.exclusions = new Set(ids.map(libraryId).filter((id): id is string => !!id));
  }

  sync(host: HTMLElement): void {
    const excluded = new Set<HTMLElement>();
    for (const row of Array.from(host.querySelectorAll<HTMLElement>('.verticalSection'))) {
      if (row.closest('.tvl-home-collection-row, .tvl-home-provider-row')) continue;
      const id = Array.from(row.classList).map(name => name.startsWith('RecentlyAddedInLibrary-')
        ? libraryId(name.slice('RecentlyAddedInLibrary-'.length)) : undefined).find(Boolean);
      if (id && this.exclusions.has(id)) excluded.add(row);
    }
    for (const row of this.hidden) if (!excluded.has(row)) row.classList.remove(homeLibraryExcludedClass);
    for (const row of excluded) if (!row.classList.contains(homeLibraryExcludedClass)) row.classList.add(homeLibraryExcludedClass);
    this.hidden = excluded;
  }

  destroy(): void {
    // Leave the owner's hide class, hidden attribute and inline styles intact.
    for (const row of this.hidden) row.classList.remove(homeLibraryExcludedClass);
    this.hidden.clear();
  }
}
