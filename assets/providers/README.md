# Provider logos

These marks identify collections grouped by streaming provider. Jellyfin Cinema is not affiliated with or endorsed by the providers. The marks remain the property of their respective owners; the project's software license does not grant trademark rights.

All images are embedded as data URIs in `src/provider-brands.ts`, so provider navigation works without a request to an external image host. The files here are the editable source assets. If an image changes, update its matching literal in that module as well.

## SVG marks

Netflix, Apple TV, NOW, Paramount+, ITVX and Channel 4 are from [Simple Icons](https://github.com/simple-icons/simple-icons) at commit [`d4e6ba93e48f178898707f0145ec285f28b64b38`](https://github.com/simple-icons/simple-icons/tree/d4e6ba93e48f178898707f0145ec285f28b64b38), retrieved 27 September 2026. Simple Icons distributes its icon data under [CC0 1.0](SIMPLE-ICONS-LICENSE.md). Paths are unchanged. The view boxes remove unused square padding, and fills are red for Netflix, lime for ITVX, mint for Channel 4 and white for the other marks on dark Cinema tiles.

| Local file | Pinned source | Brand source recorded by Simple Icons |
| --- | --- | --- |
| `netflix.svg` | [Netflix icon](https://github.com/simple-icons/simple-icons/blob/d4e6ba93e48f178898707f0145ec285f28b64b38/icons/netflix.svg) | [Netflix brand assets](https://brand.netflix.com/en/assets/logos) |
| `apple.svg` | [Apple TV icon](https://github.com/simple-icons/simple-icons/blob/d4e6ba93e48f178898707f0145ec285f28b64b38/icons/appletv.svg) | [Apple TV logo](https://en.wikipedia.org/wiki/File:Apple_TV_(logo).svg) |
| `now.svg` | [NOW icon](https://github.com/simple-icons/simple-icons/blob/d4e6ba93e48f178898707f0145ec285f28b64b38/icons/now.svg) | [NOW](https://www.nowtv.com) |
| `paramount.svg` | [Paramount+ icon](https://github.com/simple-icons/simple-icons/blob/d4e6ba93e48f178898707f0145ec285f28b64b38/icons/paramountplus.svg) | [Paramount+ brand](https://www.paramount.com/brand/paramount-plus) |

| `itvx.svg` | [ITVX icon](https://github.com/simple-icons/simple-icons/blob/d4e6ba93e48f178898707f0145ec285f28b64b38/icons/itvx.svg) | [ITVX](https://www.itv.com/) |
| `channel4.svg` | [Channel 4 icon](https://github.com/simple-icons/simple-icons/blob/d4e6ba93e48f178898707f0145ec285f28b64b38/icons/channel4.svg) | [Channel 4](https://www.channel4.com/) |

## Official website marks

These two transparent PNG images are unmodified assets from the providers' public websites, retrieved 27 September 2026. They are proprietary brand assets, not covered by the Simple Icons CC0 dedication. They are included solely to identify the corresponding provider; no general license to reuse them is asserted.

| Local file | Source page | Image source | Native size |
| --- | --- | --- | --- |
| `prime.png` | [Prime Video](https://www.primevideo.com/) | [White Prime Video wordmark](https://m.media-amazon.com/images/G/02/digital/video/acquisition/logo/pv_logo_white._CB548648705_.png) | 1040 × 317 |
| `disney.png` | [Disney+ UK](https://www.disneyplus.com/en-gb) | [White Disney+ wordmark](https://disney.images.edge.bamgrid.com/ripcut-delivery/v2/variant/disney/C17497FEB6E396BC29C6A790A01C34FEAC1E56F78A0AEAD93D6390B42C95C05E/compose?format=png&width=640) | 640 × 350 |

The interface uses a separate text label for each provider, including Apple TV+, rather than altering any logo's lettering. Accent colors decorate Cinema's own tiles and are not part of the logo artwork.

## BBC iPlayer

`bbc.png` is the unmodified BBC iPlayer watch-provider mark returned by the official TMDB provider directory for GB, provider ID 38, retrieved 27 September 2026. Its [image source](https://image.tmdb.org/t/p/original/vi6XJCpJ9GpAPD3rDSRzMC812Z.png) is embedded locally, like the other marks. It is a proprietary identifying trademark, not covered by the Simple Icons dedication.

The official [movie provider directory](https://developer.themoviedb.org/reference/watch-providers-movie-list) and [TV provider directory](https://developer.themoviedb.org/reference/watch-providers-tv-list), queried for GB on the same date, confirmed BBC iPlayer **38**, ITVX **41**, and Channel 4 **103** for both media types. These presets match free and ad-supported offers. Premium variants are separate providers and are not silently included.

## TMDB data attribution

`tmdb.svg` is TMDB's approved **Alt short (blue)** logo, downloaded unmodified on 27 September 2026 from the official [logos and attribution page](https://www.themoviedb.org/about/logos-attribution). Its [direct SVG source](https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg) is retained in `assets/providers/tmdb.svg` for attribution records. The gradient, lettering and aspect ratio are preserved. This proprietary trademark is not covered by the Simple Icons license.

TMDB's [API FAQ](https://developer.themoviedb.org/docs/faq) requires the approved logo and this notice in an application's About or Credits section:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The logo should remain less prominent than Jellyfin Cinema's own identity and link to [TMDB](https://www.themoviedb.org). Do not imply endorsement or change the logo's colors or aspect ratio.

TMDB's [watch-provider documentation](https://developer.themoviedb.org/reference/movie-watch-providers) separately requires attribution to **JustWatch** as the source of streaming availability data. Cinema's source and asset documentation identifies TMDB and [JustWatch](https://www.justwatch.com/). Data-source links and credits are omitted from the TV and desktop frontend.
