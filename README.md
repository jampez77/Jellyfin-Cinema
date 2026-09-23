# Jellyfin TV Item Layout

Cinematic media detail pages for Jellyfin’s **TV layout**, inspired by Netflix and built using the integration and remote-control patterns from [InPlayerEpisodePreview-TV](https://github.com/jampez77/InPlayerEpisodePreview-TV).

This independent plugin changes the detail pages **before playback**. It can run alongside InPlayerEpisodePreview-TV, which provides browsing inside the player. All artwork, metadata, recommendations, favourites and playback positions come from your signed-in Jellyfin library.

## The layouts

- **TV Shows:** backdrop and title artwork, next-episode/resume action, and a dedicated browser with seasons on the left and episode thumbnails, synopses and watch progress on the right. Down from a season’s last episode opens the next season’s first episode; Up from its first episode opens the previous season’s last. Season and episode detail links open the corresponding show.
- **Movies:** a large backdrop, title, Play/Resume, a trailer button with a clapperboard icon, favourites, runtime/rating/quality when available, cast and genres, and a More like this grid. Trailer playback uses Jellyfin’s own trailer action or an available local trailer; unavailable trailers show a clear message. Recommendations open their own detail pages.
- **Live TV:** current programme, broadcast times and live progress, plus a landscape guide with channel rows and programmes laid out horizontally under a shared time axis. A prominent banner shows the highlighted programme’s thumbnail, synopsis and live/upcoming status. Left/Right moves through a channel’s schedule; Up/Down moves between channels. Watch live tunes the selected channel; future programmes show details without changing playback.

Use arrows to navigate, **OK / Enter** to select, and **Back / Escape** to return. Episode and guide lists scroll as focus moves. Pointer controls also work. **Jellyfin layout** returns to the original detail page for the current item, including its full version, audio, subtitle and other native controls.

The plugin activates only in Jellyfin Web’s TV display mode. Desktop and mobile modes retain their normal pages. Web-based TV clients can load it; native clients with independent interfaces cannot. CSS and JavaScript include fallbacks for webOS 6’s Chromium 79 engine. Physical remotes and an actual Jellyfin server still need installation testing.

## Preview locally

```sh
npm ci
npm run build
npm run dev
```

Open [the local preview](http://127.0.0.1:4173). The three controls at the top switch between media types. This preview runs the production layout against fictional library data; playback is explicitly simulated. Its photos are local assets, and it does not connect to a server or need credentials. See [demo scenarios](demo/README.md).

## Install

The [first test release](https://github.com/jampez77/Jellyfin-TV-Item-Layout/releases/tag/v0.1.0) is available for Jellyfin 10.10.7, 10.11.x and 12.x. In **Dashboard → Plugins → Repositories**, add:

```text
https://raw.githubusercontent.com/jampez77/Jellyfin-TV-Item-Layout/main/manifest.json
```

Install **TV Item Layout** from the catalogue, along with a compatible **File Transformation** plugin, then restart Jellyfin. Enable **TV** display mode in your Jellyfin Web user settings. See the [installation guide](docs/server.md) for the File Transformation repository, manual installation, and troubleshooting. No web files are silently modified.

To build the packages locally:

```sh
bash scripts/package-plugin.sh all
```

The final plugin version component identifies the server target: `0.1.0.1` for 10.10.7, `0.1.0.2` for 10.11.x and `0.1.0.3` for 12.x. The catalogue selects the compatible build. Release preparation is documented in [publishing](docs/publishing.md).

## Verify

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
dotnet run --project server/verification/TvItemLayout.ServerChecks.csproj --configuration Release
```

The browser suite exercises the actual layout against a simulated Jellyfin API. Server checks exercise injection, script delivery and caching on a temporary local HTTP host. These checks do not establish real-server playback or hardware compatibility.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/view.ts`, `src/style.css` | Media layouts, loading/empty/error states and actions |
| `src/remote.ts` | Focus navigation and remote key handling |
| `src/guide.ts`, `src/guide.css` | Horizontal Live TV guide and timeline navigation |
| `src/api.ts`, `src/local-playback.ts` | Authenticated Jellyfin data and native playback bridge |
| `src/index.ts` | TV/detail route lifecycle and native page restoration |
| `server/` | Independent server plugin and File Transformation integration |
| `demo/` | Offline fixture and artwork |

## Credits

Integration and local playback code are adapted from [jampez77/InPlayerEpisodePreview-TV](https://github.com/jampez77/InPlayerEpisodePreview-TV), based on [Namo2/InPlayerEpisodePreview](https://github.com/Namo2/InPlayerEpisodePreview). Original MIT notices are retained in [LICENSE.md](LICENSE.md) and the packaged server licence. The TV design takes inspiration from the supplied Netflix [overview](https://techwiser.com/wp-content/uploads/2023/01/Netflix-Smart-TV-More-episodes.jpg) and [season browser](https://techwiser.com/wp-content/uploads/2023/01/Netflix-Smart-TV-Change-season.jpg), and the supplied movie reference. No Netflix branding, film artwork, or fabricated ranking data is bundled. Demo photo sources are listed in [artwork credits](demo/assets/CREDITS.md).
