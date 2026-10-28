#!/usr/bin/env python3
"""Finite interactive production QA. Real UI happy paths; read-only/denial probes use the same browser. No API interception, fake profiles or financial transactions."""
import json,pathlib,time,traceback,secrets,sys,re
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path('/home/ubuntu/ksa-men-checkpoints/roles-20261028');OUT.mkdir(exist_ok=True)
BASE='https://ksa.men'
users=json.loads((OUT/'users-before.json').read_text());owner_data=next(x for x in users if x['role']=='owner')
test_before=json.loads((OUT/'test-account-before.json').read_text())
old_pin=json.loads((OUT.parent/'verified-test-session.json').read_text())['pin']
settings={x['key']:json.loads(x['value']) for x in json.loads((OUT/'settings-before.json').read_text())}
owner_email=owner_data['email'];alias=owner_email.split('@')[0].split('+')[0]+'+qa-20261028@'+owner_email.split('@')[1]
state={'alias':alias,'name':'sys--qa-20261028-'+secrets.token_hex(3),'sitePassword':secrets.token_urlsafe(20),'checks':[]}
contexts={};pages={};errors=[]
def persist():
 p=OUT/'journey-private-state.json';p.write_text(json.dumps(state,ensure_ascii=False,indent=2));p.chmod(0o600)
 (OUT/'journey-results.json').write_text(json.dumps({'checks':state['checks'],'pageErrors':errors},ensure_ascii=False,indent=2))
def check(label,passed,detail=None):
 state['checks'].append({'label':label,'passed':bool(passed),'detail':detail});persist();print(('PASS ' if passed else 'FAIL ')+label,flush=True)
 if not passed:raise RuntimeError(label)
def ctx(role,width=390):
 if role not in contexts:
  c=browser.new_context(viewport={'width':width,'height':844},accept_downloads=True);c.add_init_script("localStorage.setItem('ksa-lang','ar');localStorage.setItem('ksa-theme','dark');");pg=c.new_page();pg.set_default_timeout(15000);pg.on('pageerror',lambda e:errors.append({'role':role,'message':str(e)}));pg.on('dialog',lambda d:d.accept());contexts[role]=c;pages[role]=pg
 return pages[role]
def save_context(role):
 p=OUT/(role+'-browser-private.json');contexts[role].storage_state(path=str(p));p.chmod(0o600)
def goto(role,path):
 pg=ctx(role);pg.goto(BASE+path,wait_until='networkidle');pg.locator('#main-content').wait_for();pg.wait_for_timeout(200);return pg
def shot(role,name,width=390):
 pg=ctx(role);pg.set_viewport_size({'width':width,'height':844 if width<800 else 920});pg.wait_for_timeout(200);pg.screenshot(path=str(OUT/(name+'.png')));d=pg.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');check(name+' horizontal fit',d['scroll']<=d['width'],d)
def fetch(role,path,method='GET',body=None):
 pg=ctx(role)
 return pg.evaluate("""async a=>{const me=await fetch('/api/auth/me',{cache:'no-store'}).then(r=>r.json());const r=await fetch(a.path,{method:a.method,headers:{'Content-Type':'application/json',...(me.csrf?{'X-CSRF-Token':me.csrf}:{})},...(a.method==='GET'?{}:{body:JSON.stringify(a.body??{})})});return {status:r.status,data:await r.json().catch(()=>null)};}""",{'path':path,'method':method,'body':body})
def get_code(path):
 d=json.loads(pathlib.Path(path).read_text());return d['code']
def request(role,email,register=False):
 pg=goto(role,'/auth'+('?register=1' if register else ''))
 pg.locator('input[name=email]').fill(email)
 if register:
  pg.locator('input[name=name]').fill('[تدقيق تقني خاص] جولة الإطلاق')
  phone=settings.get('contact',{}).get('whatsapp') or next(x.get('whatsapp','') for x in users if x['role']=='owner')
  if not phone:
   import requests,os
   u='https://api.cloudflare.com/client/v4/accounts/c4bed103a44f2fc99adeb96126a0a9ff/d1/database/dd006d15-8b4c-4469-9809-af08cbb42ad4/query'
   d=requests.post(u,headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN']},json={'sql':'SELECT whatsapp FROM users WHERE id=?','params':[owner_data['id']]},timeout=20).json();phone=d['result'][0]['results'][0]['whatsapp']
  assert phone
  pg.locator('input[name=whatsapp]').fill(phone);pg.locator('input[type=checkbox]').check()
 with pg.expect_response(lambda r:'/api/auth/request' in r.url and r.request.method=='POST') as response:pg.get_by_role('button',name='أرسل رمز التحقق',exact=False).click()
 r=response.value;check(role+' email code requested through UI',r.status==200,{'status':r.status})
 pg.locator('input[name=code]').wait_for();save_context(role);shot(role,role+'-email-stage');print('EMAIL_QUERY from:auth@ksa.men to:'+email+' after:'+str(int(time.time())-120),flush=True)
def verify(role,path,register=False):
 pg=ctx(role);pg.locator('input[name=code]').fill(get_code(path))
 if register:pg.locator('input[name=pin]').fill(old_pin)
 with pg.expect_response(lambda r:'/api/auth/verify' in r.url and r.request.method=='POST') as response:pg.get_by_role('button',name='تحقق وادخل',exact=False).click()
 r=response.value;check(role+' email verified through UI',r.status==200,{'status':r.status});pg.wait_for_url('**/admin' if role=='owner' else '**/dashboard');pg.locator('.admin-console' if role=='owner' else '.dashboard').wait_for();me=fetch(role,'/api/auth/me')['data'];state[role+'Id']=me['user']['id'];save_context(role);shot(role,role+'-signed-in');return me

def visitors():
 pg=goto('visitor','/');pg.locator('.hero').wait_for();check('Anonymous visitor genuinely sees live home',fetch('visitor','/api/auth/me')['data']['user'] is None);shot('visitor','visitor-home-mobile');shot('visitor','visitor-home-desktop',1366)
 pg.get_by_role('link',name='مزايا المنصة',exact=True).click();pg.wait_for_url('**/features');pg.locator('.feature-grid').wait_for();check('Features are a separate button and page',True)
 pg=goto('visitor','/search');pg.locator('.search-panel').wait_for();pg.locator('.search-panel input').fill('تدقيق غير ظاهر');pg.locator('.search-panel').get_by_role('button',name='بحث',exact=True).click();pg.wait_for_timeout(450);check('Visitor search excludes private technical identity',not pg.locator('.person-card').count());shot('visitor','visitor-search-mobile')
 pg=goto('visitor','/qr');pg.get_by_role('heading').first.wait_for();shot('visitor','visitor-qr-mobile');(OUT/'visitor-qr-dom.txt').write_text(pg.locator('main#main-content').inner_text())
 for route in ['/privacy','/terms','/about','/contact']:
  pg=goto('visitor',route);check('Visitor '+route+' has readable content',len(pg.locator('#main-content').inner_text())>40)
 for route in ['/api/dashboard','/api/admin/overview']:
  d=fetch('visitor',route);check('Anonymous denied '+route,d['status']==401,{'status':d['status']})
 pg=goto('visitor','/auth');pg.get_by_role('button',name='PIN',exact=True).click();check('PIN visibly requires email and PIN',pg.locator('input[name=email]').is_visible() and pg.locator('input[name=pin]').is_visible());pg.locator('input[name=email]').fill(test_before['email']);pg.locator('input[name=pin]').fill(old_pin)
 with pg.expect_response(lambda r:'/api/auth/quick' in r.url) as rr:pg.locator('.auth-card form').get_by_role('button',name='دخول',exact=True).click()
 check('PIN on a new untrusted browser is rejected',rr.value.status==401);shot('visitor','visitor-pin-new-device');persist()

def prepare_old():
 d=fetch('owner','/api/admin/users/'+str(test_before['id'])+'/action','POST',{'action':'status','status':'active'});check('Setup: only technical account reactivated',d['status']==200)

def reserve():
 pg=ctx('member');pg.locator('.dashboard').wait_for();(OUT/'member-first-dom.txt').write_text(pg.locator('.dashboard').inner_text());print('MEMBER_READY_FOR_RESERVATION',flush=True)

def pin(role,email):
 pg=ctx(role);before=fetch(role,'/api/auth/me')['data']['user']['id'];pg.get_by_role('button',name='تسجيل الخروج',exact=True).click();pg.wait_for_url(BASE+'/');check(role+' logout removes account identity',fetch(role,'/api/auth/me')['data']['user'] is None)
 pg=goto(role,'/auth');pg.get_by_role('button',name='PIN',exact=True).click();pg.locator('input[name=email]').fill(owner_email);pg.locator('input[name=pin]').fill(old_pin)
 with pg.expect_response(lambda r:'/api/auth/quick' in r.url) as rr:pg.locator('.auth-card form').get_by_role('button',name='دخول',exact=True).click()
 check(role+' matching PIN cannot enter another email account',rr.value.status==401 and fetch(role,'/api/auth/me')['data']['user'] is None)
 pg.locator('input[name=email]').fill(email)
 with pg.expect_response(lambda r:'/api/auth/quick' in r.url) as rr:pg.locator('.auth-card form').get_by_role('button',name='دخول',exact=True).click()
 check(role+' email and PIN succeeds on own trusted device',rr.value.status==200);pg.wait_for_url('**/dashboard');pg.locator('.dashboard').wait_for();check(role+' PIN session belongs to exact account',fetch(role,'/api/auth/me')['data']['user']['id']==before);save_context(role)

def inspect(role,path,filename=None):
 pg=goto(role,path);pg.wait_for_timeout(600);(OUT/(filename or role+'-current-dom.txt')).write_text(pg.locator('#main-content').inner_text());shot(role,role+'-current');print('DOM_SAVED '+(filename or role+'-current-dom.txt'),flush=True)

def set_role(value):
 d=fetch('owner','/api/admin/users/'+str(test_before['id'])+'/action','POST',{'action':'role','role':value,'financial':False});check('Setup technical role '+value,d['status']==200);goto('old','/admin' if value!='user' else '/dashboard');save_context('old')

def command(parts):
 action=parts[0]
 if action=='visitors':visitors()
 elif action=='owner-request':request('owner',owner_email)
 elif action=='owner-verify':verify('owner',parts[1]);prepare_old()
 elif action=='old-request':request('old',test_before['email'])
 elif action=='old-verify':verify('old',parts[1])
 elif action=='member-request':request('member',alias,True)
 elif action=='member-verify':verify('member',parts[1],True);reserve()
 elif action=='pin-old':pin('old',test_before['email'])
 elif action=='pin-member':pin('member',alias)
 elif action=='inspect':inspect(parts[1],parts[2],parts[3] if len(parts)>3 else None)
 elif action=='role':set_role(parts[1])
 elif action=='snapshot':shot(parts[1],parts[2],int(parts[3]) if len(parts)>3 else 390)
 elif action=='eval':
  config=json.loads(pathlib.Path(parts[1]).read_text());role=config['role'];res=ctx(role).evaluate(config['script'],config.get('arg'));path=OUT/'eval-result-private.json';path.write_text(json.dumps(res,ensure_ascii=False,indent=2));path.chmod(0o600);print('EVAL_RESULT saved',flush=True)
 elif action=='fetch':
  role,path=parts[1:3];res=fetch(role,path);p=OUT/'fetch-private.json';p.write_text(json.dumps(res,ensure_ascii=False,indent=2));p.chmod(0o600);print('FETCH_STATUS '+str(res['status']),flush=True)
 elif action=='run-file':
  exec(compile(pathlib.Path(parts[1]).read_text(),parts[1],'exec'),globals());persist()
 elif action=='save':
  for role in contexts:save_context(role)
  persist()
 elif action=='quit':return False
 else:raise ValueError('Unknown command')
 return True

with sync_playwright() as pw:
 browser=pw.chromium.connect_over_cdp('http://127.0.0.1:9222')
 print('READY_FOR_COMMAND',flush=True)
 while True:
  try:
   line=input('qa> ').strip()
   if not line:continue
   if not command(line.split()):break
   print('COMMAND_COMPLETE',flush=True)
  except EOFError:break
  except Exception as e:
   (OUT/'last-error.txt').write_text(traceback.format_exc());persist();print('COMMAND_ERROR '+str(e)[:300],flush=True)
 for c in contexts.values():c.close()
