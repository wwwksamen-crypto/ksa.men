#!/usr/bin/env python3
"""Restore a KSA backup only into a NEW isolated SQLite file; never production.

The tool accepts only v2 backups encrypted with BACKUP_ENCRYPTION_KEY (or a supplied
BACKUP_RECOVERY_KEY_HEX). Tombstones in the snapshot, plus optional current tombstones,
are applied before constraints/triggers are installed so deleted data cannot reappear.
"""
import argparse,base64,hashlib,json,os,pathlib,sqlite3,sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('snapshot',type=pathlib.Path)
parser.add_argument('target',type=pathlib.Path)
parser.add_argument('--sha256',required=True,help='Plaintext checksum supplied by snapshot metadata/header')
parser.add_argument('--tombstones',type=pathlib.Path,required=True,help='Current erasure context from protected /api/admin/backup-erasure-context; no production calls are made')
args=parser.parse_args()
if args.target.exists():raise SystemExit('Target already exists; refusing to overwrite any data.')
def backup_key():
 recovery=os.environ.get('BACKUP_RECOVERY_KEY_HEX')
 secret=os.environ.get('BACKUP_ENCRYPTION_KEY')
 if recovery:
  try:key=bytes.fromhex(recovery)
  except ValueError:raise SystemExit('Invalid recovery key format.')
  if len(key)!=32:raise SystemExit('Recovery key must encode exactly 32 bytes.')
  return key
 if not secret:raise SystemExit('BACKUP_ENCRYPTION_KEY or BACKUP_RECOVERY_KEY_HEX is required; AUTH_SECRET is never accepted for backup recovery.')
 return hashlib.sha256(secret.encode()).digest()
raw=args.snapshot.read_bytes()
if len(raw)<17 or raw[:4]!=b'KSA2':raise SystemExit('Only ksa-men-backup-v2 snapshots are accepted by this recovery tool.')
plain=AESGCM(backup_key()).decrypt(raw[4:16],raw[16:],None)
if hashlib.sha256(plain).hexdigest()!=args.sha256:raise SystemExit('Checksum does not match.')
data=json.loads(plain)
if data.get('format')!='ksa-men-backup-v2' or not data.get('schema'):raise SystemExit('Snapshot does not contain a v2 restorable schema.')
tables=data['tables']
# Never restore account invitation capabilities.
tables['managed_claim_tokens']=[]
tables['auth_mail_daily_limits']=[]
supplied=json.loads(args.tombstones.read_text())
if not isinstance(supplied,dict) or not isinstance(supplied.get('deleted_tombstones'),list) or not isinstance(supplied.get('retained_sites'),list):
 raise SystemExit('A structured current erasure context is required; a snapshot-only list is insufficient.')
if not isinstance(supplied.get('generatedAt'),(int,float)) or supplied['generatedAt'] < data.get('createdAt',0):
 raise SystemExit('Erasure context is older than the snapshot.')
tables.setdefault('deleted_tombstones',[]).extend(supplied['deleted_tombstones'])
accounts_current={str(r['resource_id']) for r in tables['deleted_tombstones'] if r.get('resource_type')=='account'}
retained={str(r['id']):r for r in supplied['retained_sites']}
for site in tables.get('sites',[]):
 live=retained.get(str(site.get('id')))
 if live and str(site.get('user_id')) in accounts_current:
  site['user_id']=None;site['manager_id']=live.get('manager_id');site['authorization']=live.get('authorization')
for table,key in [('dns_names','owner_id'),('media','owner_id')]:
 for row in tables.get(table,[]):
  live=retained.get(str(row.get('site_id')))
  if live and str(row.get(key)) in accounts_current:row[key]=live.get('manager_id')
# Deduplicate tombstones without retaining any personal payload.
tombstones={(str(r.get('resource_type')),str(r.get('resource_id'))) for r in tables.get('deleted_tombstones',[]) if isinstance(r,dict) and r.get('resource_type') and r.get('resource_id') is not None}
preserved_accounts={rid for typ,rid in tombstones if typ=='account' and (
 any(str(r.get('from_id'))==rid or str(r.get('to_id'))==rid for r in tables.get('ledger',[])) or
 any(str(r.get('user_id'))==rid for t in ['payments','reviews','subscription_requests','retention_holds'] for r in tables.get(t,[])))}
def anonymous_user(row):
 result={k:(v if k in ['id','created_at','consent_at'] else 0 if isinstance(v,(int,float)) else '' if isinstance(v,str) else None) for k,v in row.items()}
 result.update(id=row['id'],email='erased-'+str(row['id'])+'@deleted.ksa.men',name='حساب محذوف',whatsapp='',status='deleted',role='user',pin_hash=None,assigned_to=None,referrer_id=None)
 return result
tables['users']=[anonymous_user(r) if str(r.get('id')) in preserved_accounts else r for r in tables.get('users',[])]
preserved_sites={str(r.get('site_id')) for r in tables.get('reviews',[]) if ('site',str(r.get('site_id'))) in tombstones}
for site in tables.get('sites',[]):
 if str(site.get('id')) in preserved_sites:
  site.update(user_id=None,manager_id=None,draft='{}',published=None,status='deleted',searchable=0,allow_contact=0,lock_hash=None,lock_message='',authorization=None)
def purge(table,resource,key):
 rows=tables.get(table,[])
 if isinstance(rows,list):tables[table]=[r for r in rows if not isinstance(r,dict) or (resource,str(r.get(key))) not in tombstones or (table=='users' and str(r.get('id')) in preserved_accounts) or (table=='sites' and str(r.get('id')) in preserved_sites)]
purge('users','account','id');purge('sites','site','id');purge('media','media','id');purge('conversations','conversation','id');purge('messages','message','id')
accounts={rid for typ,rid in tombstones if typ=='account'};sites={rid for typ,rid in tombstones if typ=='site'}
conversations={rid for typ,rid in tombstones if typ=='conversation'}
if isinstance(tables.get('messages'),list):tables['messages']=[r for r in tables['messages'] if str(r.get('conversation_id')) not in conversations]
for table in ['mail_delivery_events','managed_creation_requests','managed_accounts','managed_claim_tokens','wallets','user_services','entitlement_sources','consent_records','notifications','quick_links','subscription_requests','member_preferences','loyalty_notification_consents','loyalty_daily_activities','occasion_notices','upload_intents','sessions','devices']:
 if isinstance(tables.get(table),list):tables[table]=[r for r in tables[table] if str(r.get('user_id')) not in accounts or (table=='wallets' and str(r.get('user_id')) in preserved_accounts)]
for table in ['site_visibility','dns_names','names','analytics','proxy_media','proxy_sites','site_custody','subdomain_change_requests']:
 if isinstance(tables.get(table),list):tables[table]=[r for r in tables[table] if str(r.get('site_id')) not in sites]
args.target.parent.mkdir(parents=True,exist_ok=True)
conn=sqlite3.connect(args.target);conn.execute('PRAGMA foreign_keys=OFF')
objects=data['schema']
# Tables first, then records. Triggers are installed only after import, avoiding replayed side-effects.
for item in objects:
 if item['type']=='table' and item.get('sql'):conn.execute(item['sql'])
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
report={'format':data['format'],'checksumVerified':True,'sqliteIntegrity':integrity,'foreignKeyViolations':violations,'tableCounts':counts,'authenticationRestored':False,'productionModified':False,'mediaReferencesOnly':True,'tombstonesApplied':len(tombstones),'currentContextAt':supplied['generatedAt'],'contextProvided':True}
args.target.with_suffix('.verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='tableCounts'},ensure_ascii=False))
if violations or integrity!='ok':sys.exit(1)
