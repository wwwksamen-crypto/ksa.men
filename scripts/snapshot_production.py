#!/usr/bin/env python3
"""Scoped, read-only encrypted production snapshot before a migration; no deletion/billing."""
import requests,os,json,pathlib,concurrent.futures,hashlib,secrets,time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=pathlib.Path(__file__).resolve().parents[1];CHECK=pathlib.Path('/home/ubuntu/ksa-men-checkpoints');URL='https://api.cloudflare.com/client/v4/accounts/c4bed103a44f2fc99adeb96126a0a9ff/d1/database/dd006d15-8b4c-4469-9809-af08cbb42ad4/query';HEADERS={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN']}
def query(sql):
 r=requests.post(URL,headers=HEADERS,json={'sql':sql,'params':[]},timeout=45).json()
 if not r.get('success'):raise RuntimeError('Snapshot read failed')
 return r['result'][0]['results']
schema=query("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL")
excluded=['auth_codes','sessions','devices','rate_limits'];names=[row['name'] for row in schema if row['type']=='table' and row['name'] not in excluded]
def table(name):
 if not name.replace('_','').isalnum():raise RuntimeError('Unsafe table name')
 return name,query('SELECT * FROM '+name)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:tables=dict(ex.map(table,names))
data={'format':'ksa-men-backup-v1','createdAt':int(time.time()),'reason':'pre-completion','tables':tables,'schema':schema,'excluded':excluded,'mediaImmutable':True};plain=json.dumps(data,ensure_ascii=False).encode();sha=hashlib.sha256(plain).hexdigest();secret=next(line.split('=',1)[1] for line in (ROOT/'.dev.vars').read_text().splitlines() if line.startswith('AUTH_SECRET='));key=hashlib.sha256((secret+':ksa-backup-v1').encode()).digest();iv=secrets.token_bytes(12);stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime());path=CHECK/('snapshot-'+stamp+'.ksab');path.write_bytes(iv+AESGCM(key).encrypt(iv,plain,None));path.chmod(0o600);meta=path.with_suffix('.metadata.json');meta.write_text(json.dumps({'snapshot':str(path),'sha256':sha,'tableCounts':{k:len(v) for k,v in tables.items()}},indent=2)+'\n');meta.chmod(0o600);(CHECK/'snapshot-latest.json').write_text(json.dumps({'snapshot':str(path),'metadata':str(meta)}));(CHECK/'snapshot-latest.json').chmod(0o600);print('Encrypted production checkpoint:',path.name,'tables:',len(tables))
