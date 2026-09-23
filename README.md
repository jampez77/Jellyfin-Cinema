# Jellyfin TV Item Layout

Cinematic media detail pages for Jellyfin’s **TV layout**, inspired by Netflix and built using the integration and remote-control patterns from [InPlayerEpisodePreview-TV](https://github.com/jampez77/InPlayerEpisodePreview-TV).

This independent plugin styles media detail pages **before playback**, the Movies and TV Shows libraries and Collections, and replaces the main Live TV page with a landscape programme guide. It can run alongside InPlayerEpisodePreview-TV, which provides browsing inside the player. All artwork, metadata, collections, recommendations, favourites and playback positions come from your signed-in Jellyfin library.

## The layouts

- **TV Shows library:** the same browse layout as Movies, with All shows, Suggestions, Favourites, Genres, search, A–Z/# filters and Collections. Suggestions show Jellyfin’s Continue watching, Next up and Recently added items, with episode titles and numbers.
- **TV Show details:** backdrop and title artwork, next-episode/resume action, and a dedicated browser with seasons on the left and episode thumbnails, synopses and watch progress on the right. Down from a season’s last episode opens the next season’s first episode; Up from its first episode opens the previous season’s last. Season and episode detail links open the corresponding show. Scroll down for collection links and More like this recommendations.
- **Movies library:** All movies, Suggestions, Favourites and Genres, with search and A–Z/# title filters. Suggestions use Jellyfin’s continue-watching, recently-added and recommendation lists. Browse in pages, open a film and return to the same filters and selected card. Collections remain one click away.
- **Movie details:** a large backdrop, title, Play/Resume, a trailer button with a clapperboard icon, favourites, runtime/rating/quality when available, cast and genres, and a More like this grid. Trailer playback uses Jellyfin’s own trailer action or an available local trailer; unavailable trailers show a clear message. Recommendations open their own detail pages. Collection cards show which collections contain the movie and open their collection pages in the same style.
- **Collections:** a cinematic collections list and individual collection pages with artwork, descriptions and a remote-friendly grid. Open a member or nested collection, then use Back to return to the selected card. The Collections library and the Movies Collections tab use this layout.
- **Live TV:** current programme, broadcast times and live progress, plus a landscape guide with channel rows and programmes laid out horizontally under a shared time axis. The highlighted programme’s artwork keeps its original proportions on the right and blends into the background, confined above the schedule, with its title, synopsis and live/upcoming status over a left fade. Missing or failed programme artwork falls back to the channel logo. Left/Right moves through a channel’s schedule; Up/Down moves between channels. Watch live tunes the selected channel; future programmes show details without changing playback.

Movie and series pages reveal Jellyfin’s existing theme video behind readable gradients when it is playing. Theme playback remains controlled by Jellyfin’s user settings; the plugin does not start another stream. Static artwork returns when the video is unavailable. Native page controls are hidden visually while our layout is open, while remaining available to Jellyfin’s playback actions.

Open **Live TV** from Jellyfin's navigation (`web/#/livetv?collectionType=livetv`) to use the main guide. **Channels & guide** on a channel's detail page links to that same guide. Use arrows to navigate, **OK / Enter** to select, and **Back / Escape** to return. Episode and guide lists scroll as focus moves. Pointer controls also work.

The plugin activates only in Jellyfin Web’s TV display mode. Desktop and mobile modes retain their normal pages. Web-based TV clients can load it; native clients with independent interfaces cannot. CSS and JavaScript include fallbacks for webOS 6’s Chromium 79 engine. Physical remotes and an actual Jellyfin server still need installation testing.

## Preview locally

```sh
npm ci
npm run build
npm run dev
```

Open [the local preview](http://127.0.0.1:4173). The controls at the top switch between TV Shows, Movies, Live TV and Collections. This preview runs the production layout against fictional library data; playback is explicitly simulated. Its photos are local assets, and it does not connect to a server or need credentials. See [demo scenarios](demo/README.md).

## Install

The [v0.1.5 test release](https://github.com/jampez77/Jellyfin-TV-Item-Layout/releases/tag/v0.1.5) is available for Jellyfin 10.10.7, 10.11.x and 12.x. In **Dashboard → Plugins → Repositories**, add:

```text
https://raw.githubusercontent.com/jampez77/Jellyfin-TV-Item-Layout/main/manifest.json
```

Install **TV Item Layout** from the catalogue, along with a compatible **File Transformation** plugin, then restart Jellyfin. Enable **TV** display mode in your Jellyfin Web user settings. See the [installation guide](docs/server.md) for the File Transformation repository, manual installation, and troubleshooting. No web files are silently modified.

To build the packages locally:

```sh
bash scripts/package-plugin.sh all
```

The final plugin version component identifies the server target: `0.1.5.1` for 10.10.7, `0.1.5.2` for 10.11.x and `0.1.5.3` for 12.x. The catalogue selects the compatible build. Release preparation is documented in [publishing](docs/publishing.md).

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
| `src/guide-view.ts`, `src/guide.ts`, `src/guide.css` | Main Live TV page, horizontal guide and timeline navigation |
| `src/library-view.ts`, `src/library.css` | Shared Movies and TV Shows filters, suggestions and paginated browsing |
| `src/collection-view.ts`, `src/collection.css` | Collections list and member browsing |
| `src/api.ts`, `src/local-playback.ts` | Authenticated Jellyfin data and native playback bridge |
| `src/native-host.ts`, `src/native-host.css` | Native page visibility and restoration |
| `src/index.ts`, `src/theme-video.ts` | Route lifecycle, native theme-video visibility and page restoration |
| `server/` | Independent server plugin and File Transformation integration |
| `demo/` | Offline fixture and artwork |

## Credits

Integration and local playback code are adapted from [jampez77/InPlayerEpisodePreview-TV](https://github.com/jampez77/InPlayerEpisodePreview-TV), based on [Namo2/InPlayerEpisodePreview](https://github.com/Namo2/InPlayerEpisodePreview). Original MIT notices are retained in [LICENSE.md](LICENSE.md) and the packaged server licence. The TV design takes inspiration from the supplied Netflix [overview](https://techwiser.com/wp-content/uploads/2023/01/Netflix-Smart-TV-More-episodes.jpg) and [season browser](https://techwiser.com/wp-content/uploads/2023/01/Netflix-Smart-TV-Change-season.jpg), and the supplied movie reference. No Netflix branding, film artwork, or fabricated ranking data is bundled. Demo photo sources are listed in [artwork credits](demo/assets/CREDITS.md).
