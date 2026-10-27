#!/usr/bin/env python3
"""Restore an encrypted KSA snapshot into a NEW, isolated SQLite file; never production."""
import argparse,hashlib,json,os,pathlib,sqlite3,sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('snapshot',type=pathlib.Path)
parser.add_argument('target',type=pathlib.Path)
parser.add_argument('--sha256',required=True,help='Plaintext checksum supplied by snapshot metadata/header')
args=parser.parse_args()
if args.target.exists():raise SystemExit('Target already exists; refusing to overwrite any data.')
secret=os.environ.get('AUTH_SECRET')
recovery=os.environ.get('BACKUP_RECOVERY_KEY_HEX')
if recovery:
 try:key=bytes.fromhex(recovery)
 except ValueError:raise SystemExit('Invalid recovery key format.')
 if len(key)!=32:raise SystemExit('Recovery key must encode exactly 32 bytes.')
elif secret:key=hashlib.sha256((secret+':ksa-backup-v1').encode()).digest()
else:raise SystemExit('BACKUP_RECOVERY_KEY_HEX or AUTH_SECRET is required and is never printed.')
raw=args.snapshot.read_bytes();plain=AESGCM(key).decrypt(raw[:12],raw[12:],None)
if hashlib.sha256(plain).hexdigest()!=args.sha256:raise SystemExit('Checksum does not match.')
data=json.loads(plain)
if data.get('format')!='ksa-men-backup-v1' or not data.get('schema'):raise SystemExit('Snapshot does not contain a restorable schema; create a current encrypted snapshot.')
args.target.parent.mkdir(parents=True,exist_ok=True)
conn=sqlite3.connect(args.target);conn.execute('PRAGMA foreign_keys=OFF')
objects=data['schema'];tables=data['tables']
# Tables and indexes first; effects/triggers are installed AFTER importing historical rows.
# No seed migrations or reward triggers run during restore, preventing doubled balances/rewards.
for kind in ['table']:
 for item in objects:
  if item['type']==kind and item.get('sql'):conn.execute(item['sql'])
for name,rows in tables.items():
 if not rows:continue
 if not name.replace('_','').isalnum():raise SystemExit('Unsafe table identifier.')
 for row in rows:
  columns=list(row);quoted=','.join('"'+column+'"' for column in columns);values=[json.dumps(row[column],ensure_ascii=False) if isinstance(row[column],(dict,list)) else row[column] for column in columns]
  conn.execute('INSERT INTO "'+name+'"('+quoted+') VALUES('+','.join('?' for _ in columns)+')',values)
for kind in ['index','trigger']:
 for item in objects:
  if item['type']==kind and item.get('sql'):conn.execute(item['sql'])
conn.commit();conn.execute('PRAGMA foreign_keys=ON');violations=conn.execute('PRAGMA foreign_key_check').fetchall();integrity=conn.execute('PRAGMA integrity_check').fetchone()[0];counts={name:conn.execute('SELECT COUNT(*) FROM "'+name+'"').fetchone()[0] for name in tables};conn.close();args.target.chmod(0o600)
report={'format':data['format'],'checksumVerified':True,'sqliteIntegrity':integrity,'foreignKeyViolations':violations,'tableCounts':counts,'authenticationRestored':False,'productionModified':False,'mediaReferencesOnly':True}
args.target.with_suffix('.verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='tableCounts'},ensure_ascii=False))
if violations or integrity!='ok':sys.exit(1)
