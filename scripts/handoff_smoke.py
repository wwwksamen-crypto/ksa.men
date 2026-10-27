#!/usr/bin/env python3
"""Finite, four-screen handoff check of the live site; no generated test accounts."""
import asyncio,json,pathlib
from playwright.async_api import async_playwright
OUT=pathlib.Path('/home/ubuntu/ksa-men-checkpoints');OUT.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.connect_over_cdp('http://127.0.0.1:9222')
  context=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  evidence=[]
  for name,path,wait in [('mobile-home','/', '.hero'),('mobile-auth','/auth','.auth-card'),('mobile-about','/about','.company-documents')]:
   await page.goto('https://ksa.men'+path,wait_until='networkidle');await page.locator(wait).wait_for();await page.screenshot(path=str(OUT/(name+'.png')))
   dimensions=await page.evaluate('({viewport:innerWidth,width:document.documentElement.scrollWidth})');evidence.append({'screen':name,**dimensions,'horizontalOverflow':dimensions['width']>dimensions['viewport']})
  data=json.loads((OUT/'owner-verify-session.json').read_text())
  owner=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  await owner.add_cookies([{'name':k,'value':v,'domain':'ksa.men','path':'/','httpOnly':True,'secure':True,'sameSite':'Lax'} for k,v in data['cookies'].items()])
  admin=await owner.new_page();admin.on('pageerror',lambda e:errors.append(str(e)));await admin.goto('https://ksa.men/admin',wait_until='networkidle');await admin.locator('.admin-console').wait_for();await admin.screenshot(path=str(OUT/'mobile-owner-admin.png'))
  d=await admin.evaluate('({viewport:innerWidth,width:document.documentElement.scrollWidth})');evidence.append({'screen':'mobile-owner-admin',**d,'horizontalOverflow':d['width']>d['viewport']})
  print(json.dumps({'evidence':evidence,'pageErrors':errors},ensure_ascii=False,indent=2));(OUT/'handoff-smoke.json').write_text(json.dumps({'evidence':evidence,'pageErrors':errors},ensure_ascii=False,indent=2));await context.close();await owner.close()
asyncio.run(main())
