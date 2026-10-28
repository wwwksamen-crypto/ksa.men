#!/usr/bin/env python3
"""Finite live UI inspection. Reads actual owner/delegated site; does not mutate production.
Standalone personal/output previews use existing protected technical data in this browser only,
with all non-GET requests blocked. This is not a public site or an authorization test.
"""
import asyncio,json,pathlib,sys
from urllib.parse import urlparse
from playwright.async_api import async_playwright
OUT=pathlib.Path('/home/ubuntu/ksa-men-checkpoints/redesign-20261028');MODE=sys.argv[1] if len(sys.argv)>1 else 'live'
SESSION=json.loads((OUT/'owner-review-session.json').read_text());ROW=json.loads((OUT/'technical-site-readonly.json').read_text());SITE=json.loads((OUT/'live-private-site.json').read_text())['site'];CHECKS=[]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.connect_over_cdp('http://127.0.0.1:9222')
  context=await browser.new_context(viewport={'width':1366,'height':920},accept_downloads=True)
  await context.add_cookies([{'name':k,'value':v,'url':'https://ksa.men','httpOnly':True,'secure':True,'sameSite':'Lax'} for k,v in SESSION['cookies'].items()])
  await context.add_init_script("localStorage.setItem('ksa-lang','ar');localStorage.setItem('ksa-theme','dark');localStorage.removeItem('ksa-sanad');")
  async def safe(route):
   if route.request.method not in ['GET','HEAD']:
    await route.fulfill(status=405,content_type='application/json',body='{"error":"Read-only visual inspection"}');return
   await route.continue_()
  await context.route('**/api/**',safe)
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def capture(label,path,selector,width=390,full=False):
   await page.set_viewport_size({'width':width,'height':920 if width>760 else 844});await page.goto('https://ksa.men'+path,wait_until='networkidle');await page.locator(selector).wait_for(timeout=20000);
   if selector=='.admin-console':await page.locator('.admin-loading').wait_for(state='hidden',timeout=25000)
   await page.evaluate('document.fonts.ready');await page.screenshot(path=str(OUT/(label+'.png')),full_page=full)
   check=await page.evaluate("({width:innerWidth,documentWidth:document.documentElement.scrollWidth,brokenImages:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute('src')),overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<-2||r.right>innerWidth+2)&&getComputedStyle(e).position!=='absolute'}).slice(0,6).map(e=>e.className)})")
   CHECKS.append({'screen':label,**check});print(label,check,flush=True)
  if MODE=='live':
   for width in [1366,390]:
    await capture('home-'+str(width),'/','.hero',width,True)
    await capture('admin-'+str(width),'/admin','.admin-console',width)
    await capture('editor-'+str(width),'/dashboard?site='+SITE['id'],'.dashboard-edit-card',width)
   await capture('editor-320','/dashboard?site='+SITE['id'],'.dashboard-edit-card',320)
   await page.get_by_role('button',name='معاينة',exact=False).first.click();await page.locator('.dashboard-preview-modal[open]').wait_for();CHECKS.append({'previewNativeModal':True,'underlyingInert':await page.locator('[inert]').count()>0,'guideHidden':await page.locator('.sanad-dock').is_hidden()});await page.screenshot(path=str(OUT/'editor-preview-mobile.png'));await page.keyboard.press('Escape')
   await capture('home-light-390','/','.hero',390)
   await page.get_by_role('button',name='تبديل المظهر',exact=True).click();await page.screenshot(path=str(OUT/'home-light-390.png'),full_page=True)
   # Guest authentication uses an independent context without reading or changing an account.
   guest=await browser.new_context(viewport={'width':390,'height':844});await guest.route('**/api/**',safe);g=await guest.new_page();g.on('pageerror',lambda e:errors.append(str(e)));await g.goto('https://ksa.men/auth',wait_until='networkidle');await g.locator('.auth-card').wait_for();await g.screenshot(path=str(OUT/'auth-mobile.png'),full_page=True);await g.get_by_role('button',name='PIN',exact=True).click();await g.screenshot(path=str(OUT/'pin-mobile.png'),full_page=True);CHECKS.append({'pinEmailAndPinRequired':await g.locator('.auth-card input[type=email][required]').count()==1 and await g.locator('.auth-card input[name=pin][required]').count()==1})
   await g.locator('.sanad-launch').click();await g.locator('.sanad-dialog[open]').wait_for();audio=g.locator('audio');CHECKS.append({'noAutoSpeech':await audio.evaluate('(a)=>a.paused&&a.currentTime===0')});await g.get_by_role('button',name='تشغيل التسجيل',exact=True).click();await g.wait_for_timeout(700)
   frames=set()
   for i in range(16):
    frames.add(await g.locator('.sanad-portrait-panel .sanad-sprite').get_attribute('class'));await g.wait_for_timeout(110)
   CHECKS.append({'audioPlaying':await audio.evaluate('(a)=>({paused:a.paused,time:a.currentTime,duration:a.duration,error:a.error?.code||null})'),'speechFrames':sorted(frames)});await g.screenshot(path=str(OUT/'sanad-speaking-mobile.png'))
   await g.get_by_role('button',name='إيقاف مؤقت',exact=True).click();pausedTime=await audio.evaluate('(a)=>a.currentTime');await g.wait_for_timeout(200);CHECKS.append({'pauseWorks':await audio.evaluate('(a)=>a.paused') and abs(await audio.evaluate('(a)=>a.currentTime')-pausedTime)<.12})
   await g.get_by_role('button',name='متابعة',exact=True).click();await g.wait_for_timeout(400);await g.locator('.sanad-dialog').get_by_role('button',name='إخفاء',exact=True).click();CHECKS.append({'hiddenPreferenceSaved':await g.evaluate("localStorage.getItem('ksa-sanad')==='hidden'"),'inlineGuidancePresent':await g.locator('.sanad-inline-guide').is_visible()})
   await g.locator('.sanad-inline-guide').click();await g.get_by_role('button',name='تشغيل التسجيل',exact=True).click();await g.wait_for_timeout(900);CHECKS.append({'restoreSpeechWorks':await g.locator('audio').evaluate('(a)=>!a.paused&&a.currentTime>.5'),'restoreFrame':await g.locator('.sanad-portrait-panel .sanad-sprite').get_attribute('class')});await g.keyboard.press('Escape');CHECKS.append({'closeStopsAudio':await g.locator('audio').evaluate('(a)=>a.paused&&a.currentTime===0')})
   await guest.close()
  elif MODE=='private':
   profile=json.loads(ROW['published']);hidden=profile.get('hidden',[])
   for key in hidden:profile.pop(key,None)
   publicData={'profile':profile,'name':ROW['site_name'],'site':ROW['id'],'userId':'C'+str(ROW['owner_user_id']),'branding':bool(ROW['branding']),'locked':False}
   rootHtml=await context.request.get('https://ksa.men/index.html');html=await rootHtml.text()
   async def fixture(route):
    req=route.request;parsed=urlparse(req.url)
    if req.method not in ['GET','HEAD']:
     await route.fulfill(status=405,content_type='application/json',body='{"error":"Read-only private preview"}');return
    if req.is_navigation_request() and parsed.hostname==ROW['site_name']+'.ksa.men':await route.fulfill(status=200,content_type='text/html',body=html);return
    if parsed.path=='/api/public/profile':await route.fulfill(content_type='application/json',body=json.dumps(publicData));return
    if parsed.path.startswith('/api/export-data/'):
     await route.fulfill(content_type='application/json',body=json.dumps({'profile':profile,'name':ROW['site_name'],'site':ROW['id'],'kind':'card','allowed':True,'translated':True}));return
    if parsed.path.startswith('/api/media/'):
     r=await context.request.get('https://ksa.men'+parsed.path);await route.fulfill(status=r.status,headers={'Content-Type':r.headers.get('content-type','image/webp')},body=await r.body());return
    await route.continue_()
   await context.unroute('**/api/**',safe);await context.route('**/*',fixture)
   for width in [1366,390]:
    await page.set_viewport_size({'width':width,'height':920 if width>760 else 844});await page.goto('https://'+ROW['site_name']+'.ksa.men/',wait_until='networkidle');await page.locator('.identity-page').wait_for();await page.screenshot(path=str(OUT/('private-profile-'+str(width)+'.png')),full_page=True);CHECKS.append({'screen':'private-profile-'+str(width),'isolatedExistingData':True,'width':width,'documentWidth':await page.evaluate('document.documentElement.scrollWidth')})
   await page.goto('https://ksa.men/export/card?site='+ROW['id'],wait_until='networkidle');await page.locator('.exports-preview-panel').wait_for();await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'private-output-studio-mobile.png'),full_page=True)
   with_download=page.get_by_role('button',name='تنزيل البطاقة الرقمية',exact=False)
   if await with_download.count():
    async with page.expect_download(timeout=30000) as di:await with_download.click()
    download=await di.value;await download.save_as(str(OUT/'redesigned-identity-card.png'));CHECKS.append({'digitalCardDownloaded':True})
   await page.goto('https://ksa.men/export/ats?site='+ROW['id'],wait_until='networkidle');await page.get_by_role('button',name='تنزيل سيرة ATS',exact=False).wait_for()
   async with page.expect_download(timeout=45000) as di:await page.get_by_role('button',name='تنزيل سيرة ATS',exact=False).click()
   download=await di.value;await download.save_as(str(OUT/'redesigned-arabic-ats.pdf'));CHECKS.append({'atsDownloaded':True,'isolatedExistingData':True})
  (OUT/('visual-'+MODE+'.json')).write_text(json.dumps({'mode':MODE,'checks':CHECKS,'pageErrors':errors},ensure_ascii=False,indent=2));print('Page errors:',errors,flush=True);await context.close()
asyncio.run(main())
