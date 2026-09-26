import type { Page } from '@playwright/test';

/** Collection-row editing is available only in Jellyfin's desktop display mode. */
export async function useDesktopLayout(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const root of [document.documentElement, document.body]) root.classList.remove('layout-tv', 'layout-mobile');
    document.body.classList.add('layout-desktop');
  });
}
