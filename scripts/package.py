"""Create standard npm package/ tarball and a source zip; no third-party libraries."""
import hashlib
import json
from pathlib import Path
import tarfile
import zipfile

root = Path(__file__).resolve().parents[1]
out = root.parent / 'deliverables'
out.mkdir(exist_ok=True)
manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
name = f"{manifest['name']}-{manifest['version']}"
members = []
for item in ['package.json', *manifest['files']]:
    path = root / item
    members.extend(sorted(path.rglob('*')) if path.is_dir() else [path])
members = sorted(set(path for path in members if path.is_file()))
with tarfile.open(out / f'{name}.tgz', 'w:gz', format=tarfile.PAX_FORMAT) as archive:
    for path in members:
        info = archive.gettarinfo(str(path), 'package/' + path.relative_to(root).as_posix())
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        info.mode = 0o644
        with path.open('rb') as source:
            archive.addfile(info, source)
with zipfile.ZipFile(out / f'{name}-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for item in ['src', 'web', 'tests', 'scripts', 'package.json', 'cordis.patch.yml', 'README.md', 'COMPATIBILITY.md', 'LICENSE', 'TEST-REPORT.md']:
        path = root / item
        for file in sorted(path.rglob('*')) if path.is_dir() else [path]:
            if file.is_file() and '__pycache__' not in file.parts:
                archive.write(file, 'dsh-bill-visualization/' + file.relative_to(root).as_posix())
    for file in sorted((root / 'qa').glob('*')):
        if file.is_file() and file.suffix in ['.png', '.json']:
            archive.write(file, 'dsh-bill-visualization/qa/' + file.name)
checksums = []
for suffix in ['.tgz', '-source.zip']:
    path = out / (name + suffix)
    checksums.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name)
(out / (name + '-SHA256.txt')).write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print('\n'.join(checksums))
print(f'npm tarball: {len(members)} files')
