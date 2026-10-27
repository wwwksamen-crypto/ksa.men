#!/usr/bin/env python3
"""Scoped Cloudflare production migration/checkpoint utility; no destructive operations."""
import os,json,hashlib,datetime,pathlib,sys,re
import requests
ACCOUNT='c4bed103a44f2fc99adeb96126a0a9ff'
ZONE='063f7d765f7427b77309172c977f2f5b'
DB='dd006d15-8b4c-4469-9809-af08cbb42ad4'
WORKER='ksa-men-prod-app'
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://api.cloudflare.com/client/v4'
HEADERS={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN']}
CHECK=pathlib.Path('/home/ubuntu/ksa-men-checkpoints')
CHECK.mkdir(exist_ok=True)
def request(method,path,payload=None,params=None,allow_failure=False):
    assert method in ('GET','POST','PUT','PATCH')
    assert ACCOUNT in path or path.startswith('/zones/'+ZONE+'/')
    r=requests.request(method,BASE+path,headers=HEADERS,json=payload,params=params,timeout=90)
    result=r.json()
    if not allow_failure and (not r.ok or not result.get('success')):
        raise RuntimeError(f'{method} {path}: {r.status_code} {result.get("errors")}')
    return result

def query(sql,params=None):
    assert not re.search(r'\b(?:DELETE|DROP)\s+(?:FROM|TABLE|INDEX|TRIGGER|VIEW)',sql,re.I)
    return request('POST',f'/accounts/{ACCOUNT}/d1/database/{DB}/query',{'sql':sql,'params':params or []})

if sys.argv[1]=='checkpoint':
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    state={}
    for name in ['ksa.men','*.ksa.men','www.ksa.men']:
        state['dns:'+name]=request('GET',f'/zones/{ZONE}/dns_records',params={'name':name})
    for key,path in [('routes',f'/zones/{ZONE}/workers/routes'),('settings',f'/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings'),('deployments',f'/accounts/{ACCOUNT}/workers/scripts/{WORKER}/deployments')]:
        state[key]=request('GET',path,allow_failure=True)
    out=CHECK/f'production-before-{stamp}.json';out.write_text(json.dumps(state,ensure_ascii=False,indent=2));print('Production checkpoint:',out)
elif sys.argv[1]=='migrate':
    query('CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL);')
    state=query('SELECT name,sha256 FROM app_migrations')['result'][0]['results']
    applied={x['name']:x['sha256'] for x in state}
    for path in sorted((ROOT/'migrations').glob('*.sql')):
        sql=path.read_text();sha=hashlib.sha256(sql.encode()).hexdigest()
        if path.name in applied:
            if applied[path.name]!=sha:raise RuntimeError('Applied migration changed: '+path.name)
            print('Already applied:',path.name);continue
        query(sql)
        query('INSERT INTO app_migrations(name,sha256,applied_at) VALUES(?,?,?)',[path.name,sha,datetime.datetime.now(datetime.timezone.utc).isoformat()])
        print('Applied:',path.name,sha[:16],flush=True)
    print('Production schema:',query('SELECT COUNT(*) AS migrations FROM app_migrations')['result'][0]['results'])
elif sys.argv[1]=='secrets':
    pairs={}
    for line in (ROOT/'.dev.vars').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k,v=line.split('=',1);pairs[k]=v
    for key in ['AUTH_SECRET','RESEND_API_KEY']:
        request('PUT',f'/accounts/{ACCOUNT}/workers/scripts/{WORKER}/secrets',{'name':key,'type':'secret_text','text':pairs[key]})
        print('Worker secret stored:',key,flush=True)
else:
    raise SystemExit('usage: production.py checkpoint | migrate | secrets')
