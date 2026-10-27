#!/usr/bin/env python3
"""Finite live check on a clearly labelled private technical account; no money/owner-lock mutations."""
import pathlib,json,requests,uuid,secrets,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/home/ubuntu/ksa-men-checkpoints');BASE='https://ksa.men';phase=sys.argv[1] if len(sys.argv)>1 else 'prepare';STATE=OUT/'live-completion-state.json'
def save(data):STATE.write_text(json.dumps(data));STATE.chmod(0o600)
def session(name):
 d=json.loads((OUT/name).read_text());s=requests.Session();s.cookies.update(d['cookies']);s.headers.update({'Origin':BASE,'X-CSRF-Token':d['csrf']});return s,d
owner,od=session('completion-owner-session.json');user,ud=session('verified-test-session.json');state=json.loads(STATE.read_text()) if STATE.exists() else {'checks':[],'userId':ud['userId']}
def check(label,valid,details=None):
 state['checks'].append({'label':label,'passed':bool(valid),'details':details});save(state);print(label+': '+('PASS' if valid else 'FAIL'),flush=True)
 if not valid:raise RuntimeError(label)
def call(s,method,path,expected=200,**kw):
 r=s.request(method,BASE+path,timeout=45,**kw)
 if r.status_code not in ([expected] if isinstance(expected,int) else expected):raise RuntimeError(path+' '+str(r.status_code)+' '+r.text[:200])
 return r
if phase=='prepare':
 if 'site' not in state:
  label='sys--'+uuid.uuid4().hex[:24]
  check('DNS-valid double hyphens accepted',call(user,'GET','/api/names/check?name='+label).json()['available'])
  data=call(user,'POST','/api/names/reserve',201,json={'name':label}).json();state.update({'name':label,'site':data['site']['id'],'sitePassword':secrets.token_urlsafe(24)});save(state)
 site=call(user,'GET','/api/sites/'+state['site']).json()['site']
 call(user,'POST','/api/sites/'+state['site']+'/lock',json={'enabled':True,'password':state['sitePassword'],'message':'تدقيق تقني داخلي — موقع مقفل غير مخصص للعرض العام'})
 upload=call(user,'POST','/api/upload',files={'file':('identity.webp',(ROOT/'public/assets/logo.webp').read_bytes(),'image/webp')},data={'purpose':'photo','siteId':state['site']}).json();state['media']=upload['id'];save(state)
 draft=site['draft'];draft.update({'name':'KSA.MEN — تدقيق تقني خاص','title':'تدقيق تجربة المنصة ومخرجاتها','bio':'هذه هوية تقنية داخلية لا تمثل عضوًا بشريًا. تُستخدم للتحقق من المراجعة والخصوصية وجودة المخرجات في منصة KSA.MEN، وتبقى مقفلة وغير مخصصة للعرض العام.','photo':upload['url'],'email':'ksa@mail.manus.bot','hidden':['email','whatsapp','phone'],'allowContact':False})
 saved=call(user,'PUT','/api/sites/'+state['site']+'/draft',json={'draft':draft,'version':site['draft_version']}).json()['site'];review=call(user,'POST','/api/sites/'+state['site']+'/submit',201,json={}).json()['review'];state['review']=review['id'];state['submittedVersion']=saved['draft_version'];save(state)
 draft['bio']+=' هذه الجملة تخص مسودة أحدث من اللقطة المرسلة.'
 latest=call(user,'PUT','/api/sites/'+state['site']+'/draft',json={'draft':draft,'version':saved['draft_version']}).json()['site'];state['latestVersion']=latest['draft_version'];save(state)
 check('Private media denied to anonymous visitor',requests.get(BASE+'/api/media/'+state['media'],timeout=20).status_code in [403,423])
 preview=call(owner,'GET','/api/admin/reviews/'+state['review']+'/preview');check('Actual protected full snapshot preview',str(state['submittedVersion']) in preview.text and 'تدقيق تقني خاص' in preview.text)
 call(owner,'POST','/api/admin/reviews/'+state['review']+'/decision',json={'decision':'approved'})
 result=call(user,'GET','/api/sites/'+state['site']).json()['site'];check('Immutable submitted version approved despite newer draft',result['published_version']==state['submittedVersion'] and result['draft_version']==state['latestVersion'])
 dash=call(user,'GET','/api/dashboard').json();check('Actual review decision shown to user',any(r['id']==state['review'] and r['status']=='approved' for r in dash['reviews']))
 state['translationPending']=True;save(state)
 r=user.post(BASE+'/api/translate',json={'siteId':state['site'],'target':'en','consent':True},timeout=60)
 check('Actual Workers AI translation request',r.status_code==200,{'status':r.status_code,'error':r.json().get('error') if r.headers.get('content-type','').startswith('application/json') else None})
 translated=call(user,'GET','/api/sites/'+state['site']).json()['site'];state['translationPending']=False;save(state);check('English translation genuinely persisted',bool(translated['draft'].get('translations',{}).get('en')))
 check('Original Arabic profile preserved',translated['draft']['name']==draft['name'] and translated['draft']['bio']==draft['bio'])
 for kind in ['pdf','ats','card','badge','social','vcard','qr']:
  result=call(user,'GET','/api/export-data/'+state['site']+'?kind='+kind+'&lang=ar').json();check('Live '+kind+' export entitlement and visibility',result['allowed'] and not result['profile'].get('email'))
 state['prepared']=True;save(state)
elif phase=='translate':
 current=call(user,'GET','/api/sites/'+state['site']).json()['site']
 original=current['draft']
 r=user.post(BASE+'/api/translate',json={'siteId':state['site'],'target':'en','consent':True},timeout=90)
 check('Actual Workers AI translation request',r.status_code==200,{'status':r.status_code,'error':r.json().get('error') if r.headers.get('content-type','').startswith('application/json') else r.text[:160]})
 translated=call(user,'GET','/api/sites/'+state['site']).json()['site'];state['translationPending']=False;save(state)
 check('English translation genuinely persisted',bool(translated['draft'].get('translations',{}).get('en')))
 check('Original Arabic profile preserved',translated['draft']['name']==original['name'] and translated['draft']['bio']==original['bio'])
 review=call(user,'POST','/api/sites/'+state['site']+'/submit',201,json={}).json()['review']
 call(owner,'POST','/api/admin/reviews/'+review['id']+'/decision',json={'decision':'approved'})
 check('Translated snapshot published only after actual approval',call(user,'GET','/api/sites/'+state['site']).json()['site']['published'].get('translations',{}).get('en') is not None)
 for kind in ['pdf','ats','card','badge','social','vcard','qr']:
  result=call(user,'GET','/api/export-data/'+state['site']+'?kind='+kind+'&lang=ar').json();check('Live '+kind+' export entitlement and visibility',result['allowed'] and not result['profile'].get('email'))
 state['prepared']=True;save(state)
elif phase in ['finish','roles']:
 if phase=='finish':
  check('Prepared private fixture exists',state.get('prepared'))
  image=call(owner,'GET','/api/admin/sites/'+state['site']+'/share-image?lang=ar');check('Actual resvg PNG generated on Workers',image.headers.get('Content-Type')=='image/png' and image.content[:8]==b'\x89PNG\r\n\x1a\n')
  imagePath=OUT/'live-private-sharing.png';imagePath.write_bytes(image.content);imagePath.chmod(0o600)
  anonymous=requests.get(BASE+'/api/public/og/'+state['name'],timeout=20);check('Private identity image not publicly accessible',anonymous.status_code in [403,423,404])
  sub='https://'+state['name']+'.ksa.men';visitor=requests.Session();r=visitor.get(sub+'/api/public/profile',timeout=20);check('Private subdomain requires its own gate',r.status_code==200 and r.json().get('locked'))
  r=visitor.post(sub+'/api/public/unlock',headers={'Origin':sub},json={'password':state['sitePassword']},timeout=20);check('Independent site password genuinely works',r.status_code==200)
  r=visitor.get(sub+'/api/public/profile?lang=en',timeout=20);check('Translated published public profile hidden fields respected',r.status_code==200 and not r.json().get('profile',{}).get('email'))
 for role in ['manager','moderator']:
  call(owner,'POST','/api/admin/users/'+str(ud['userId'])+'/action',json={'action':'role','role':role,'financial':False})
  import subprocess
  subprocess.run([sys.executable,str(ROOT/'scripts/live_browser_check.py'),role],check=True)
  r=call(user,'GET','/api/admin/overview');check('Live '+role+' control-room role access',r.status_code==200)
  r=user.get(BASE+'/api/admin/payments',timeout=20);check('Live '+role+' financial access denied without delegation',r.status_code==403)
 call(owner,'POST','/api/admin/users/'+str(ud['userId'])+'/action',json={'action':'role','role':'user','financial':False})
 check('Live role restored to user',call(user,'GET','/api/auth/me').json()['user']['role']=='user')
 state['finished']=True;save(state)
 print(json.dumps({'checks':len(state['checks']),'allPassed':all({v['label']:v['passed'] for v in state['checks']}.values())},ensure_ascii=False),flush=True)
else:raise SystemExit('Use prepare or finish')
