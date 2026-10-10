"""Publish metadata and immutable, hash-named scripts for FusionReader."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def build(destination, base_url):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'scripts').mkdir(exist_ok=True)
    extensions = []
    for path in sorted((ROOT / 'sources').glob('*.js')):
        data = path.read_bytes()
        if len(data) > 2 * 1024 * 1024:
            raise ValueError('Plugin exceeds client size limit')
        script = data.decode('utf-8')
        header = re.search(r'==MiruExtension==([\s\S]+?)==/MiruExtension==', script)
        if not header:
            raise ValueError(f'Missing metadata: {path.name}')
        fields = dict(re.findall(r'@(\w+)\s+([^\r\n]+)', header[1]))
        fields = {key: value.strip() for key, value in fields.items()}
        package = fields.get('package', '')
        version = fields.get('version', '')
        if not re.fullmatch(r'[a-z][a-z0-9_.-]{0,127}', package) or path.stem != package:
            raise ValueError(f'Invalid package: {path.name}')
        if not re.fullmatch(r'v?\d+\.\d+\.\d+', version):
            raise ValueError(f'Invalid version: {path.name}')
        minimum = fields.get('minAppVersion', '1.4.0')
        if not re.fullmatch(r'\d+\.\d+\.\d+', minimum):
            raise ValueError(f'Invalid minimum app version: {path.name}')
        kind = {'fikushon': 'novel', 'bangumi': 'anime'}.get(fields.get('type'), fields.get('type'))
        if kind not in ('manga', 'novel', 'anime'):
            raise ValueError(f'Invalid media type: {path.name}')
        digest = hashlib.sha256(data).hexdigest()
        filename = f'{package}-{digest}.js'
        (destination / 'scripts' / filename).write_bytes(data)
        extensions.append(dict(package=package, name=fields.get('name', package), version=version,
            type=kind, lang=fields.get('lang', 'all'), author=fields.get('author', ''),
            icon=fields.get('icon', ''), nsfw=fields.get('nsfw', 'false') == 'true',
            url='scripts/' + filename, sha256=digest, size=len(data), minAppVersion=minimum))
    if not extensions:
        raise ValueError('No plugins to publish')
    manifest = dict(schemaVersion=1, name='FusionReader 插件仓库', website=base_url.rstrip('/') + '/', extensions=extensions)
    (destination / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for source in (ROOT / 'public').iterdir():
        if source.is_file():
            shutil.copyfile(source, destination / source.name)
    shutil.copytree(ROOT / 'licenses', destination / 'licenses', dirs_exist_ok=True)
    (destination / '.nojekyll').touch()
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(ROOT / 'dist'))
    parser.add_argument('--base-url', default='https://hanyin111.github.io/fusion-reader-extensions/')
    args = parser.parse_args()
    catalog = build(args.output, args.base_url)
    print(f'Published metadata for {len(catalog["extensions"])} plugins')
