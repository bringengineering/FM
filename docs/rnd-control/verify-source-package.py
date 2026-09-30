import sys,json,zipfile,hashlib
from pathlib import PurePosixPath
with zipfile.ZipFile(sys.argv[1]) as archive:
 names=archive.namelist()
 if len(names)!=len(set(names)) or archive.testzip():raise SystemExit('FAIL duplicate path or ZIP CRC')
 manifest=json.loads(archive.read('PACKAGE_MANIFEST.json'))
 if manifest.get('kind')!='BRING_RND_SOURCE_PACKAGE' or manifest.get('version')!=1:raise SystemExit('FAIL manifest kind')
 files=manifest['files']
 if {item['path'] for item in files}!=set(names)-{'PACKAGE_MANIFEST.json'} or len(files)!=len(names)-1:raise SystemExit('FAIL inventory')
 if archive.read('BASE_COMMIT.txt').decode().strip()!=manifest['baseCommit']:raise SystemExit('FAIL base commit')
 for item in files:
  path=PurePosixPath(item['path'])
  if path.is_absolute() or '..' in path.parts or '\\' in item['path']:raise SystemExit('FAIL unsafe path')
  data=archive.read(item['path'])
  if len(data)!=item['sizeBytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:raise SystemExit('FAIL '+item['path'])
 print('PASS source package CRC, inventory, base commit and all file hashes')
