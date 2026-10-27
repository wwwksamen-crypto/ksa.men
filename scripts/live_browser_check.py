#!/usr/bin/env python3
"""Finite screenshots/downloads of the live, protected technical fixture; no deployment/test hosting."""
import json,pathlib,sys,re
from playwright.sync_api import sync_playwright
OUT=pathlib.Path('/home/ubuntu/ksa-men-checkpoints');STATE=json.loads((OUT/'live-completion-state.json').read_text());MODE=sys.argv[1] if len(sys.argv)>1 else 'exports';DATA=json.loads((OUT/('completion-owner-session.json' if MODE=='owner' else 'verified-test-session.json')).read_text())
with sync_playwright() as p:
 browser=p.chromium.connect_over_cdp('http://127.0.0.1:9222');context=browser.new_context(viewport={'width':1366,'height':850},accept_downloads=True);context.add_cookies([{'name':k,'value':v,'url':'https://ksa.men','httpOnly':True,'secure':True,'sameSite':'Lax'} for k,v in DATA['cookies'].items()]);context.add_init_script("localStorage.setItem('ksa-lang','ar');localStorage.setItem('ksa-theme','dark');");page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));checks=[]
 def shot(label,path,selector,width=390):
  page.set_viewport_size({'width':width,'height':844});page.goto('https://ksa.men'+path,wait_until='networkidle');page.locator(selector).wait_for(timeout=20000);page.screenshot(path=str(OUT/(label+'.png')));d=page.evaluate('({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth})');checks.append({'label':label,**d,'horizontalOverflow':d['documentWidth']>d['viewport']});print(label+': '+str(d),flush=True)
 if MODE in ['exports','pdf']:
  shot('final-mobile-dashboard','/dashboard','.dashboard')
  for kind,lang,label,button in [('ats','ar','actual-arabic-ats','تنزيل سيرة ATS'),('pdf','ar','actual-arabic-profile','تنزيل الملف التعريفي'),('ats','en','actual-english-ats','تنزيل سيرة ATS'),('qr','ar','actual-identity-qr','تنزيل QR'),('vcard','ar','actual-vcard','تنزيل vCard'),('social','ar','actual-social-card','تنزيل بطاقة المشاركة')]:
   if MODE=='pdf' and kind not in ['ats','pdf','social']:continue
   page.set_viewport_size({'width':1366,'height':850});page.goto('https://ksa.men/export/'+kind+'?site='+STATE['site']+'&lang='+lang,wait_until='networkidle');buttonLocator=page.get_by_role('button',name=button,exact=False);buttonLocator.wait_for(timeout=20000)
   with page.expect_download(timeout=45000) as download:buttonLocator.click()
   d=download.value;extension=pathlib.Path(d.suggested_filename).suffix;d.save_as(str(OUT/(label+extension)));checks.append({'label':label,'download':label+extension,'bytes':(OUT/(label+extension)).stat().st_size});print('Downloaded '+label+extension,flush=True)
  shot('final-mobile-card','/export/card?site='+STATE['site']+'&lang=ar','.exports-main')
 elif MODE in ['manager','moderator','owner']:
  shot('final-'+MODE+'-desktop','/admin','.admin-console',1366);shot('final-'+MODE+'-mobile','/admin','.admin-console',390);checks.append({'label':'role-body','text':page.locator('.admin-console').inner_text()[:300]})
  if MODE=='owner':
   page.get_by_role('button',name='الخدمات',exact=True).click();page.locator('.admin-service').first.wait_for();page.screenshot(path=str(OUT/'final-owner-services-mobile.png'))
 result={'mode':MODE,'checks':checks,'pageErrors':errors};(OUT/('browser-'+MODE+'-results.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'mode':MODE,'pageErrors':errors,'checks':len(checks)},ensure_ascii=False),flush=True);context.close()
