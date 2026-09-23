# Publishing a release

The GitHub repository is `jampez77/Jellyfin-TV-Item-Layout`. Jellyfin reads the checked-in `manifest.json` on `main`; the ZIP files live in GitHub Releases.

1. Keep the three-part release version in `package.json`, `server/Jellyfin.Plugin.TvItemLayout.csproj` and `scripts/package-plugin.sh` in sync. The server build adds `.1` for 10.10.7, `.2` for 10.11.x, and `.3` for 12.x. Each DLL's assembly version must match its catalogue entry.
2. Update installation docs and release notes before packaging, since each ZIP includes `INSTALL.md`. Run the frontend and server verification commands from the README.
3. Run `bash scripts/package-plugin.sh all`, then `python3 scripts/create-manifest.py`. Update the generator's changelog for the release. It validates the archives, uses Jellyfin's required ZIP MD5 checksum, and preserves older catalogue versions. Each ZIP also has a SHA-256 file for direct downloads.
4. Commit the source, docs and manifest. Create a tag such as `v0.1.0` at that commit and push the commit and tag. Create a GitHub release with the three matching ZIP files, their three SHA-256 files, and `manifest.json`. Mark builds intended for initial server testing as prereleases.
5. Verify that the public raw manifest resolves, every referenced release asset downloads without authentication, and both its MD5 and SHA-256 match. Verify that 10.10.7, 10.11.x and 12.x each select the correct highest compatible plugin version.

Treat published version numbers and their assets as immutable. Use a new release version for subsequent fixes so Jellyfin offers an update and clients retrieve the new bundle.

## Jellyfin Cinema rename

Version 0.2.0 changes the public plugin name and adds `imageUrl` for the catalogue cover. Keep GUID `1a06b74f-7609-4af9-899d-430c9b5a52b1`, the `Jellyfin.Plugin.TvItemLayout` assembly/namespace, `/TvItemLayout` routes, `jellyfin-tv-layout.js`, legacy archive names and the repository URL stable for existing clients and installations. The npm package and public documentation use Jellyfin Cinema.

The checked-in catalogue cover is `assets/catalogue/jellyfin-cinema.png`; its built-in image generation prompt is recorded alongside it in `prompt.txt`. Ensure its public raw URL resolves when publishing. Artwork is illustrative, not a screenshot of a real library.

Prepared release entries point to assets that may not yet be public. Publish the matching release archives before merging that manifest to `main`, then run the public-download and checksum checks above. A successful local package build is not a published release.
