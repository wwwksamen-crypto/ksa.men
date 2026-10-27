#!/usr/bin/env python3
"""Inspect the live authentication form. No account creation, PIN entry or lock changes."""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright
OUT=pathlib.Path('/home/ubuntu/ksa-men-checkpoints/auth-repair-20261027')
OUT.mkdir(exist_ok=True)
async def main():
    stage=sys.argv[1]
    async with async_playwright() as p:
        browser=await p.chromium.connect_over_cdp('http://127.0.0.1:9222')
        context=await browser.new_context(viewport={'width':1366,'height':844})
        page=await context.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto('https://ksa.men/auth',wait_until='networkidle',timeout=30000)
        await page.locator('.auth-card form input[type=email]').wait_for()
        if stage=='before':
            await page.locator('input[type=email]').fill('www.ksa.men@gmail.com')
            async with page.expect_response(lambda r:'/api/auth/request' in r.url and r.request.method=='POST') as response:
                await page.get_by_role('button',name='أرسل رمز التحقق').click()
            r=await response.value
            payload=await r.json()
            assert r.status==400 and 'Too small' in payload.get('error',''), 'Expected pre-mail validation defect; stop instead of repeating.'
            print(json.dumps({'stage':stage,'status':r.status,'error':payload.get('error')},ensure_ascii=False))
        await page.screenshot(path=str(OUT/(stage+'-email-desktop.png')),full_page=True)
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path=str(OUT/(stage+'-email-mobile.png')),full_page=True)
        await page.get_by_role('button',name='PIN على جهاز موثوق').click()
        await page.screenshot(path=str(OUT/(stage+'-pin-mobile.png')),full_page=True)
        inputs=await page.locator('.auth-card form input').evaluate_all('(els)=>els.map(e=>({type:e.type,required:e.required,autocomplete:e.autocomplete}))')
        result={'stage':stage,'pinFormInputs':inputs,'pageErrors':errors,'horizontalOverflow':await page.evaluate('document.documentElement.scrollWidth>window.innerWidth')}
        if stage=='after':
            assert any(x['type']=='email' for x in inputs) and any(x['type']=='password' for x in inputs)
            await page.get_by_role('button',name='التحقق بالبريد').click()
            await page.locator('input[type=email]').fill('www.ksa.men@gmail.com')
            async with page.expect_response(lambda r:'/api/auth/request' in r.url and r.request.method=='POST') as response:
                await page.get_by_role('button',name='أرسل رمز التحقق').click()
            r=await response.value
            payload=await r.json()
            assert r.status==200 and payload.get('challenge'), 'Do not repeat unsuccessful mail requests automatically.'
            result['emailRequestStatus']=r.status
            await page.locator('input[autocomplete=one-time-code]').wait_for()
            result['codeFieldVisible']=True
            await page.screenshot(path=str(OUT/'after-email-verification-mobile.png'),full_page=True)
            await page.get_by_role('button',name='إعادة إرسال الرمز').click()
            await page.set_viewport_size({'width':1366,'height':844})
            await page.get_by_role('button',name='PIN على جهاز موثوق').click()
            await page.screenshot(path=str(OUT/'after-pin-desktop.png'),full_page=True)
        (OUT/(stage+'-browser-results.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(result,ensure_ascii=False))
        await context.close()
asyncio.run(main())
