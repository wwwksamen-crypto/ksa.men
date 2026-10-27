#!/usr/bin/env python3
"""Create portable source/clone artifacts without secrets, user records, build caches, or owner attachments."""
import argparse,pathlib,subprocess,zipfile,json,re,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('output',type=pathlib.Path);p.add_argument('--clone',action='store_true');p.add_argument('--domain');p.add_argument('--owner-email');p.add_argument('--brand');a=p.parse_args()
if a.output.exists():raise SystemExit('Output exists; refusing overwrite.')
if a.clone and not all([a.domain,a.owner_email,a.brand]):raise SystemExit('Clone requires domain, owner-email and brand.')
if a.domain and not re.fullmatch(r'[a-z0-9.-]+',a.domain):raise SystemExit('Invalid domain.')
if a.brand and (len(a.brand)>100 or any(char in a.brand for char in ['\'','"','<','>','\\'])):raise SystemExit('Brand must not contain code/markup delimiters.')
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines();manifest=[]
with zipfile.ZipFile(a.output,'x',compression=zipfile.ZIP_DEFLATED) as z:
 for name in sorted(set(files)):
  path=ROOT/name
  if not path.is_file() or name.startswith(('.env','.dev.vars','.git','node_modules','dist')) or 'owner-session' in name or 'completion-owner-session' in name:continue
  if a.clone and name in ['public/assets/company-bank.webp','public/assets/company-registration.webp']:continue
  content=path.read_bytes()
  if a.clone and name=='wrangler.jsonc':
   data=json.loads(content);data['name']='clone-config-required';data['account_id']='ACCOUNT_ID_REQUIRED';data['vars']['ROOT_DOMAIN']=a.domain;data['vars']['OWNER_EMAIL']=a.owner_email;data['d1_databases'][0]['database_id']='DATABASE_ID_REQUIRED';data['d1_databases'][0]['database_name']='clone-database-config-required';data['r2_buckets'][0]['bucket_name']='clone-bucket-config-required';content=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode()
  elif a.clone and path.suffix in ['.ts','.tsx','.json','.html','.md','.sql','.js','.py']:
   text=content.decode();text=text.replace('www.ksa.men@gmail.com',a.owner_email).replace('ksa.men',a.domain).replace('KSA.MEN',a.brand)
   text=text.replace('SA5380000296608010947219','').replace('296000010006080947219','').replace('7050011712','').replace('10/05/2025','').replace('شركة رجال الوطن القابضة',a.brand).replace('شركة رجال الوطن',a.brand)
   text=text.replace('c4bed103a44f2fc99adeb96126a0a9ff','ACCOUNT_ID_REQUIRED').replace('dd006d15-8b4c-4469-9809-af08cbb42ad4','DATABASE_ID_REQUIRED')
   if name=='client/src/main.tsx':text=re.sub(r'<section className="section"><div className="section-heading"><span className="eyebrow">\{t\(\'وضوح يبني الثقة\'[\s\S]*?className="company-documents"[\s\S]*?</section>','',text)
   if name.startswith('migrations/'):
    text=text.replace('SA5380000296608010947219','').replace('296000010006080947219','').replace('7050011712','').replace('10/05/2025','').replace('شركة رجال الوطن القابضة',a.brand).replace('شركة رجال الوطن',a.brand)
    # Independent clone keeps intake disabled until its own official recipient is configured.
    text=text.replace('"enabled":true,"beneficiary"','"enabled":false,"beneficiary"')
   content=text.encode()
  z.writestr(name,content);manifest.append({'path':name,'sha256':hashlib.sha256(content).hexdigest()})
 z.writestr('TRANSFER-MANIFEST.json',json.dumps({'format':'ksa-source-transfer-v1','clone':a.clone,'includesUserDatabase':False,'includesRuntimeSecrets':False,'files':manifest},ensure_ascii=False,indent=2)+'\n')
 if a.clone:z.writestr('CLONE-SETUP.md','# Independent clone\n\nNo user database, receipts, communications, sessions or runtime secrets are included. Configure the new Cloudflare account/D1/R2 identifiers and secret values; use your own logo/cover/legal entity and official payment recipient. Intake must remain disabled until confirmed. The migration history belongs only to the NEW database; never apply modified clone migrations to the original database. Do not transfer original user data.\n')
print(json.dumps({'output':str(a.output.resolve()),'files':len(manifest),'clone':a.clone,'databaseIncluded':False,'secretsIncluded':False}))
