// Capture the injected bundle URL while it executes. This preserves Jellyfin's
// base path and the Pages project path without sending art requests elsewhere.
const scriptSource = typeof document !== 'undefined'
  ? (document.currentScript as HTMLScriptElement | null)?.src || '' : '';
export function resolveSeasonalAssetUrl(filename: string, script: string, base: string): string {
  const source = new URL(script || 'dist/jellyfin-tv-layout.js', base);
  const injected = /\/TvItemLayout\/ClientScript$/i.test(source.pathname);
  const url = new URL(injected ? `SeasonalAsset/${filename}` : `../assets/seasonal/${filename}`, source);
  url.searchParams.set('v', source.searchParams.get('v') || '0.2.43');
  return url.href;
}
export function seasonalAssetUrl(filename: string): string {
  return resolveSeasonalAssetUrl(filename, scriptSource, document.baseURI);
}
