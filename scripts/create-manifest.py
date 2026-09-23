#!/usr/bin/env python3
"""Generate the Jellyfin catalogue from the three packaged release archives."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
repository = 'jampez77/Jellyfin-TV-Item-Layout'
release = json.loads((root / 'package.json').read_text())['version']
plugin_id = '1a06b74f-7609-4af9-899d-430c9b5a52b1'
client_hash = hashlib.sha256((root / 'dist/jellyfin-tv-layout.js').read_bytes()).hexdigest()
timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
versions = []
for suffix, target in [('3', '12.0.0'), ('2', '10.11.0'), ('1', '10.10.7')]:
    version = f'{release}.{suffix}'
    archive = root / 'dist/releases' / f'TvItemLayout_{version}_jellyfin-{target}.zip'
    data = archive.read_bytes()
    with ZipFile(archive) as package:
        assert package.testzip() is None, f'Corrupt archive: {archive.name}'
        info = json.loads(package.read('build-info.json'))
        assert info['id'] == plugin_id and info['version'] == version
        assert info['jellyfinVersion'] == target and info['clientSha256'] == client_hash
        assert 'Jellyfin.Plugin.TvItemLayout.dll' in package.namelist()
    assert archive.with_suffix('.zip.sha256').read_text().split()[0] == hashlib.sha256(data).hexdigest()
    versions.append({
        'version': version,
        'changelog': 'The main Live TV page now opens the horizontal programme guide, and channel detail guide buttons link to that page. Removed the Jellyfin layout switch and the J Film / J Series labels. Preserves remote navigation, programme artwork and explicit live playback. Requires File Transformation and Jellyfin Web in TV display mode.',
        'targetAbi': target,
        'sourceUrl': f'https://github.com/{repository}/releases/download/v{release}/{archive.name}',
        # Jellyfin's catalogue protocol requires MD5; SHA-256 files are also published.
        'checksum': hashlib.md5(data).hexdigest(),
        'timestamp': timestamp,
    })

manifest_path = root / 'manifest.json'
if manifest_path.exists():
    previous = next((item for item in json.loads(manifest_path.read_text()) if item['guid'] == plugin_id), None)
    if previous:
        current = {item['version'] for item in versions}
        versions.extend(item for item in previous['versions'] if item['version'] not in current)
versions.sort(key=lambda item: tuple(map(int, item['version'].split('.'))), reverse=True)
manifest = [{
    'guid': plugin_id,
    'name': 'TV Item Layout',
    'overview': 'Cinematic TV layouts for movies, series and Live TV.',
    'description': 'Netflix-inspired media detail pages and a main Live TV guide for Jellyfin Web in TV display mode. Browse episodes across seasons, launch movie trailers, and explore a horizontal programme guide with highlighted show artwork. Install File Transformation separately for automatic loading. Native Android TV, Roku and other independent clients are not supported.',
    'owner': 'jampez77',
    'category': 'General',
    'versions': versions,
}]
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Generated {manifest_path.name} for v{release} with {len(versions)} package versions.')
