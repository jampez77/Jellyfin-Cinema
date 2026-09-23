import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

// Exercise the real upstream client without vendoring it or executing its npm
// scripts. Audited against spkesDE/jellyfin-featured-plugin @ 2cb03c5360cc39836bc0f7c283752c9398eb50b9.
// To run elsewhere, clone that revision and set TVL_FEATURED_SOURCE to its root.
const source = process.env.TVL_FEATURED_SOURCE || '/tmp/tvl-featured-audit';
const sourceAvailable = existsSync(resolve(source, 'src/main.ts'));
const bundle = sourceAvailable ? buildSync({
  stdin: { contents: `import {createFeaturedResponseDefaults} from ${JSON.stringify(resolve(source, 'src/config/libs/defaults.ts'))};
    import ${JSON.stringify(resolve(source, 'src/main.ts'))};
    window.__featuredDefaults=createFeaturedResponseDefaults();`, loader: 'ts', resolveDir: source },
  bundle: true, format: 'iife', target: 'chrome79', loader: { '.css': 'text' }, write: false, logLevel: 'silent'
}).outputFiles[0].text : '';

test.skip(!sourceAvailable, 'Set TVL_FEATURED_SOURCE to a checkout of spkesDE/jellyfin-featured-plugin to run the actual-client integration tests.');

const featured = (page: Page) => page.locator('#indexPage #homeTab.is-active .homeSectionsContainer > .ec-root.ec-ready');
const activeSlide = (page: Page) => featured(page).locator('.ec-slide.is-active');
type FixtureOptions = { config?: Record<string, unknown>; feed?: Record<string, unknown>; trailer?: boolean };

async function setup(page: Page, options: FixtureOptions = {}) {
  await page.route('**/Items/**/Images/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="800"><rect width="1440" height="800" fill="#253c31"/><circle cx="1100" cy="240" r="180" fill="#527760"/></svg>' }));
  await page.goto('/?featured=0#/home');
  await expect(page.locator('#indexPage #homeTab.is-active .homeSectionsContainer')).toBeVisible();
  await page.evaluate(async options => {
    // Jellyfin puts the TV layout marker on html; the general demo also
    // accepts a body marker, which this upstream plugin deliberately ignores.
    document.documentElement.classList.add('layout-tv');
    const win = window as any;
    win.__featuredCalls = [];
    win.__nativeHomeHost = document.querySelector('#indexPage #homeTab .homeSectionsContainer');
    win.__nativeHomeChildren = [...win.__nativeHomeHost.children];
    const nativeHeader = document.createElement('nav'); nativeHeader.id = 'featured-test-account-menu';
    nativeHeader.innerHTML = '<ul role="menu"><li><a href="#/mypreferencesmenu"><span class="MuiListItemText-primary">Settings</span></a></li></ul>';
    document.body.append(nativeHeader);
    win.JellyfinFeaturedPluginConfig = { hideOnTvLayout: false, useHeroLayout: false, heroHeightMode: 'custom', bannerHeight: 430,
      heading: 'Chosen for this account', personalizationEnabled: true, ...options.config };
    win.__featuredFeed = { autoplay: false, infiniteLoading: false, hasMore: false, trackDisplayedItems: false,
      personalizationEnabled: true, hideOnTvLayout: false, useHeroLayout: false, heroHeightMode: 'custom', bannerHeight: 430,
      showDescription: true, showYear: false, showRating: false, titleDisplayMode: 'title', showControlsOnHoverOnly: false,
      showNavigationArrows: true, showPaginationDots: false, showSlidePosition: true, interactOnWholeBanner: true,
      showPlayButton: false, showSecondaryButton: true, secondaryButtonText: 'Explore this title',
      showFavoriteButton: false, showPlaystateButton: false, enableBackgroundTrailers: false,
      heading: 'Chosen for this account', heroTextPosition: 'left', heroBackdropPosition: '70% 40%',
      items: [
        { id: 'movie-tide', name: 'Personal pick: After the Tide', mediaType: 'Movie', hasImage: true, hasLogo: false, imageType: 'Backdrop', isFavorite: false, isPlayed: false, overview: 'A selection made by Featured for the current account.', productionYear: 2025 },
        { id: 'movie-blue', name: 'Personal pick: A Kind of Blue', mediaType: 'Movie', hasImage: true, hasLogo: false, imageType: 'Backdrop', isFavorite: false, isPlayed: false, overview: 'A second personalized selection.', productionYear: 2024 }
      ], ...options.feed };
    const display = { enableBackgroundTrailers: true, showDescription: true, showRating: true, showYear: true, showRuntime: true, showFavoriteButton: true, showPlaystateButton: true };
    const effective = { sourceEnabled: {}, sourceWeights: {}, display, preferredGenres: [], excludedGenres: [], unplayedBoost: 0, favouriteBoost: 0, inProgressSeriesBoost: 0, repeatCooldownDays: 0, repeatCooldownHours: 0 };
    win.__featuredPreferences = {
      current: { hasOverrides: false, preferences: { sourceEnabled: {}, sourceWeights: {}, display: {}, preferredGenres: null, excludedGenres: null, unplayedBoost: null, favouriteBoost: null, inProgressSeriesBoost: null, repeatCooldownDays: null, repeatCooldownHours: null }, effective, defaults: effective },
      options: { policy: { enabled: true, allowSourceSelection: false, allowSourceWeights: false, allowPreferredGenres: true, allowUnplayedBoost: false, allowFavouriteBoost: false, allowInProgressSeriesBoost: false, allowRepeatCooldown: false }, sources: [], genres: ['Drama', 'Comedy'] }
    };
    win.ApiClient = {
      getCurrentUserId: () => 'featured-user', serverId: () => 'featured-server', deviceId: () => 'featured-browser', accessToken: () => 'fixture-token',
      getUrl: (path: string, query?: Record<string, unknown>) => {
        const url = new URL('/' + path.replace(/^\//, ''), location.origin);
        for (const [key, value] of Object.entries(query || {})) if (value != null) url.searchParams.set(key, String(value));
        return url.href;
      },
      ajax: async (request: { url: string; type?: string; data?: string }) => {
        const path = new URL(request.url, location.origin).pathname;
        win.__featuredCalls.push({ path, method: request.type || 'GET', data: request.data ? JSON.parse(request.data) : undefined });
        if (path === '/featured/items') return JSON.parse(JSON.stringify({ ...win.__featuredDefaults, ...win.__featuredFeed }));
        if (path === '/featured/preferences/bootstrap') return JSON.parse(JSON.stringify(win.__featuredPreferences));
        if (path === '/featured/preferences' && request.type === 'PUT') {
          const value = JSON.parse(request.data!);
          win.__featuredSaved = value;
          if (value.preferences?.display?.showDescription === false) win.__featuredFeed.showDescription = false;
          return {};
        }
        if (path.startsWith('/UserFavoriteItems/')) return { IsFavorite: request.type === 'POST' };
        if (path === '/featured/favorites/changed' || path === '/featured/items/displayed') return {};
        throw new Error('Unexpected Featured endpoint: ' + path);
      }
    };
    win.Emby = { Page: { showItem: (id: string) => { location.hash = '/details?id=' + encodeURIComponent(id); } } };
    if (options.trailer) {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const drawing = canvas.getContext('2d')!;
      const stream = canvas.captureStream(20);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const recorded = new Promise<Blob>(resolve => recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })));
      recorder.start();
      for (let index = 0; index < 10; index++) {
        drawing.fillStyle = index % 2 ? '#4d795e' : '#2f5e46'; drawing.fillRect(0, 0, 320, 180);
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      recorder.stop(); const blob = await recorded; stream.getTracks().forEach(track => track.stop());
      win.__featuredFeed.items[0].trailer = { type: 'remote', provider: 'direct', url: URL.createObjectURL(blob) };
      Object.assign(win.__featuredFeed, { enableBackgroundTrailers: true, startTrailersMuted: true, showTrailerControls: true,
        trailerDelayMilliseconds: 0, trailerStartOffsetSeconds: 0, trailerEndOffsetSeconds: 0, waitForTrailerToFinish: false, allowTrailersOnMobile: true });
    }
  }, options);
}
async function start(page: Page) { await page.addScriptTag({ content: bundle }); }

test('real Featured mounts into the unmasked native Home and retains configured display choices', async ({ page }) => {
  await setup(page); await start(page);
  await expect(featured(page)).toBeVisible();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await expect(page.locator('#indexPage')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#indexPage')).not.toHaveClass(/tvl-native-hidden/);
  await expect(activeSlide(page).getByRole('heading')).toHaveText('Personal pick: After the Tide');
  await expect(activeSlide(page).getByRole('button', { name: 'Explore this title', exact: true })).toBeVisible();
  await expect(activeSlide(page).locator('.ec-overview')).toHaveText('A selection made by Featured for the current account.');
  await expect(activeSlide(page).locator('.ec-meta')).toHaveCount(0);
  expect(await featured(page).evaluate(element => (element as HTMLElement).style.getPropertyValue('--ec-height'))).toBe('430px');
  expect(await featured(page).locator('.ec-viewport').evaluate(element => element.getBoundingClientRect().height)).toBe(430);
  expect(await page.evaluate(() => {
    const win = window as any;
    return win.__nativeHomeHost === document.querySelector('#indexPage #homeTab .homeSectionsContainer')
      && win.__nativeHomeChildren.every((node: Element) => node.parentElement === win.__nativeHomeHost);
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('featured-native-home.png') });
});

test('Featured uses the cinematic Home palette without changing its theme elsewhere', async ({ page }) => {
  await setup(page, { feed: { showPlayButton: true } }); await start(page);
  const slide = activeSlide(page);
  const play = slide.locator('.ec-button:not(.ec-button-secondary)');
  const details = slide.getByRole('button', { name: 'Explore this title', exact: true });
  await expect(slide.locator('.ec-title')).toHaveCSS('font-weight', '900');
  await expect(slide.locator('.ec-title')).toHaveCSS('text-transform', 'uppercase');
  await expect(slide.locator('.ec-overview')).toHaveCSS('color', 'rgb(185, 196, 189)');
  await expect(play).toHaveCSS('background-color', 'rgb(246, 246, 243)');
  await expect(play).toHaveCSS('color', 'rgb(16, 17, 18)');
  await expect(play).toHaveCSS('border-radius', '7px');
  await expect(details).toHaveCSS('background-color', 'rgba(38, 52, 44, 0.9)');
  await details.focus();
  await expect(details).toHaveCSS('outline-color', 'rgb(211, 231, 222)');
  await expect(details).toHaveCSS('background-color', 'rgb(53, 69, 58)');
  // Featured also uses these tokens outside Home (including preferences).
  // A sibling instance must still inherit the plugin's Jellyfin theme.
  await page.evaluate(() => {
    const sibling = document.createElement('div'); sibling.id = 'outside-home-featured'; sibling.className = 'ec-root';
    sibling.innerHTML = '<button class="ec-button">Outside Home</button>'; document.body.append(sibling);
  });
  await expect(page.locator('#outside-home-featured .ec-button')).toHaveCSS('background-color', 'rgb(0, 164, 220)');
  await expect(page.locator('#outside-home-featured .ec-button')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: test.info().outputPath('featured-cinematic-home.png') });
});

test('Featured keyboard navigation reaches our item details and Home return restores one real carousel', async ({ page }) => {
  await setup(page); await start(page); await expect(featured(page)).toBeVisible();
  await activeSlide(page).focus(); await page.keyboard.press('ArrowRight');
  await expect(activeSlide(page).getByRole('heading')).toHaveText('Personal pick: A Kind of Blue');
  await expect(activeSlide(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(activeSlide(page).getByRole('heading')).toHaveText('Personal pick: After the Tide');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/details\?id=movie-tide$/);
  await expect(page.locator('#tv-layout')).toBeVisible();
  await expect(page.locator('.ec-root.ec-ready')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(featured(page)).toHaveCount(1); await expect(featured(page)).toBeVisible();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
});

test('Featured hero geometry, fade configuration and clearance remain controlled by the plugin', async ({ page }) => {
  const hero = { useHeroLayout: true, heroHeightMode: 'custom', bannerHeight: 620, mediaPadding: 24,
    heroGradientStrength: 62, heroFadeStart: 35, heroFadeEnd: 88, heroFadeCurve: 'soft' };
  await setup(page, { config: hero, feed: hero }); await start(page);
  await expect(featured(page)).toHaveClass(/ec-hero/);
  await expect(page.locator('#homeTab')).toHaveClass(/ec-hero-page/);
  expect(await featured(page).evaluate(element => {
    const style = (element as HTMLElement).style;
    return [style.getPropertyValue('--ec-height'), style.getPropertyValue('--ec-media-padding'), style.getPropertyValue('--ec-gradient-strength'), style.getPropertyValue('--ec-hero-media-mask')];
  })).toEqual(['620px', '24px', '0.62', expect.stringContaining('35%')]);
  await expect.poll(() => featured(page).evaluate(element => {
    const content = element.querySelector('.ec-slide.is-active .ec-content')!;
    const visible = Array.from(content.children).filter(child => child.getClientRects().length);
    const bottom = Math.max(...visible.map(child => child.getBoundingClientRect().bottom));
    return element.nextElementSibling!.getBoundingClientRect().top - bottom;
  })).toBeGreaterThanOrEqual(10);
  await page.screenshot({ path: test.info().outputPath('featured-native-hero.png') });
  await page.setViewportSize({ width: 924, height: 815 });
  await expect(featured(page)).toBeVisible();
  await expect(activeSlide(page).getByRole('button', { name: 'Explore this title', exact: true })).toBeVisible();
  await expect.poll(() => featured(page).evaluate(element => {
    const content = element.querySelector('.ec-slide.is-active .ec-content')!;
    const visible = Array.from(content.children).filter(child => child.getClientRects().length);
    return element.nextElementSibling!.getBoundingClientRect().top - Math.max(...visible.map(child => child.getBoundingClientRect().bottom));
  })).toBeGreaterThanOrEqual(10);
  await page.screenshot({ path: test.info().outputPath('featured-native-hero-924.png') });
});

test('Featured personalisation dialog saves through its own API and refreshes its own carousel', async ({ page }) => {
  await setup(page); await start(page); await expect(featured(page)).toBeVisible();
  await page.locator('[data-featured-user-settings-link=true]').click();
  const dialog = page.locator('.ec-preferences-dialog');
  await expect(dialog).toBeVisible();
  const description = dialog.locator('[data-display-preference-key=showDescription] input');
  await description.uncheck();
  await dialog.locator('.ec-preferences-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(featured(page)).toHaveCount(1);
  await expect(activeSlide(page).locator('.ec-overview')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__featuredSaved.preferences.display.showDescription)).toBe(false);
  expect(await page.evaluate(() => (window as any).__featuredCalls.filter((call: any) => call.path === '/featured/items').length)).toBe(2);
  await expect(page.locator('#tv-layout')).toHaveCount(0);
});

test('Featured background trailer, hotkeys and teardown remain owned by the real plugin', async ({ page }) => {
  await setup(page, { trailer: true }); await start(page);
  const video = featured(page).locator('video.ec-trailer');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused && element.readyState >= 2)).toBe(true);
  await expect(page.locator('#tvl-player-browse, #tvl-pause-screen')).toHaveCount(0);
  await activeSlide(page).focus(); await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.keyboard.press('m');
  expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(false);
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await activeSlide(page).getByRole('button', { name: 'Explore this title', exact: true }).click();
  await expect(page).toHaveURL(/#\/details\?id=movie-tide$/);
  await expect(page.locator('video.ec-trailer')).toHaveCount(0);
  await expect(page.locator('#tv-layout')).toBeVisible();
});

test('server and personalised hide-on-TV decisions are respected while native Home stays available', async ({ page }) => {
  await setup(page, { feed: { hideOnTvLayout: true } }); await start(page);
  await expect.poll(() => page.evaluate(() => (window as any).__featuredCalls.filter((call: any) => call.path === '/featured/items').length)).toBe(1);
  await expect(featured(page)).toHaveCount(0);
  await expect(page.locator('.ec-placeholder')).toHaveCount(0);
  await expect(page.locator('#indexPage #homeTab .homeSectionsContainer')).toBeVisible();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
});

test('late Featured startup and a replaced native Home container mount exactly once without moving existing rows', async ({ page }) => {
  await setup(page); await expect(page.locator('#tv-layout')).toHaveCount(0);
  await start(page); await expect(featured(page)).toHaveCount(1);
  await page.evaluate(() => {
    const container = document.querySelector('#indexPage #homeTab .homeSectionsContainer')!;
    const replacement = container.cloneNode(false) as HTMLElement;
    const row = document.createElement('section'); row.className = 'verticalSection native-replacement-row';
    row.innerHTML = '<h2>Native replacement section</h2><button type="button">Native media card</button>';
    replacement.append(row); container.replaceWith(replacement);
    document.querySelector('#indexPage')!.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
  });
  await expect(featured(page)).toHaveCount(1); await expect(featured(page)).toBeVisible();
  await expect(page.locator('.native-replacement-row')).toBeVisible();
  await expect(page.locator('#tv-layout')).toHaveCount(0);
  await page.locator('.native-replacement-row button').focus();
  await expect(page.locator('.native-replacement-row button')).toBeFocused();
});
