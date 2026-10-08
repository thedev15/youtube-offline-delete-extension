"""Dependency-free, reproducible WebExtension packages. Never includes tests or credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
FILES = ['shared.js', 'content.js', 'options.html', 'options.css', 'options.js']

def icon(size):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            nx, ny = x/size, y/size
            white = ((.30 <= nx <= .70 and .34 <= ny <= .78 and (nx <= .36 or nx >= .64 or ny >= .72))
                     or (.25 <= nx <= .75 and .25 <= ny <= .32)
                     or (.41 <= nx <= .59 and .17 <= ny <= .25)
                     or (.45 <= nx <= .55 and .40 <= ny <= .68))
            rows.extend((255, 255, 255, 255) if white else (180, 32, 28, 255))
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(rows),9))+chunk(b'IEND',b'')

def build(browser):
    manifest = json.loads((ROOT/'manifests'/f'{browser}.json').read_text())
    assert manifest['permissions'] == ['storage']
    assert 'background' not in manifest and 'host_permissions' not in manifest
    destination = ROOT/'dist'/browser
    destination.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(ROOT/'extension'/name, destination/name)
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    icons = destination/'icons'
    icons.mkdir(exist_ok=True)
    for size in [16,48,128]:
        (icons/f'{size}.png').write_bytes(icon(size))
    files = [*FILES,'manifest.json','icons/16.png','icons/48.png','icons/128.png']
    archive = ROOT/'dist'/f'youtube-offline-remove-{browser}-{manifest["version"]}.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info,(destination/name).read_bytes())
    return {'browser':browser,'version':manifest['version'],'file':archive.name,
            'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size}

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser',choices=['chromium','firefox','all'],default='all')
    args=parser.parse_args()
    browsers=['chromium','firefox'] if args.browser=='all' else [args.browser]
    report=[build(browser) for browser in browsers]
    (ROOT/'dist'/'SHA256SUMS').write_text(''.join(f'{r["sha256"]}  {r["file"]}\n' for r in report))
    print(json.dumps(report,indent=2))