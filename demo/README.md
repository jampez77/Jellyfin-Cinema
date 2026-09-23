# Local preview

Run `npm install`, `npm run build`, and `npm run dev` from the project root. Open [the preview](http://127.0.0.1:4173/).

The preview loads the same layout bundle used by Jellyfin, with a separate in-memory API supplying fictional media. It needs no Jellyfin credentials and makes no network requests after the local page and bundled photographs have loaded. The small switcher at the top belongs only to this preview.

- **TV Shows:** North of Nowhere has three seasons and six episodes per season. The first episode is watched; the second is partially watched. Down from the last episode advances to the next season; Up from the first returns to the previous season’s last episode.
- **Movies:** After the Tide has a resume position, a trailer action, cast, technical metadata and four related films. The trailer opens its own labelled playback simulation and preserves the film’s resume position.
- **Live TV:** Four channels share a horizontal programme timeline, with varied programme durations. Left/Right browses time, Up/Down browses channels, and the banner shows the highlighted programme’s artwork and details, including future programmes. The schedule is calculated when the page loads.

The Live TV preview opens the main guide at `/#/livetv?collectionType=livetv`. Channel details remain available at `/#/details?id=channel-field`; their **Channels & guide** button links to the main guide.

Arrow keys, Enter and Escape exercise remote navigation. Clicking works too. Playback opens a clearly labelled simulation; **Back to details**, **Back to guide** or Escape returns to the previous page. Favorites remain set while the page stays open.

Use the address bar to open an item directly:

- `/#/details?id=series-north`
- `/#/details?id=movie-tide`
- `/#/details?id=channel-field`

## Failure and loading scenarios

Add a query before the hash and reload:

- `/?scenario=empty#/details?id=series-north`: empty seasons, episodes, related films, channels and programme listings.
- `/?scenario=empty#/details?id=movie-tide`: no trailer available, while film playback remains available.
- `/?scenario=error#/details?id=series-north`: all asynchronous API calls reject, allowing the error and retry state to be checked.
- `/?scenario=slow#/details?id=series-north`: longer, varied response times. Switch items or seasons quickly to check that older requests cannot replace the active view.

Remove the query and reload to restore ordinary behaviour. All titles, descriptions, cast names and ratings are fictional demonstration data. Photograph sources are recorded in [assets/CREDITS.md](assets/CREDITS.md).
