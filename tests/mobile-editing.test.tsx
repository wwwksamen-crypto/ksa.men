// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { obscuredFieldOffset, useMobileViewport } from '../client/src/mobile-viewport';
function Page() { const ref = useRef<HTMLDivElement | null>(null); useMobileViewport(ref); return <div ref={ref}><input aria-label="حقل كتابة" defaultValue="كتابة مستمرة"/></div>; }
let host: HTMLDivElement, root: Root, viewport: EventTarget & { height: number; offsetTop: number; scale: number }, scroll: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
  viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 }); scroll = vi.fn();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 }); vi.stubGlobal('scrollBy', scroll);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Page/>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (window as any).visualViewport; vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('portrait keyboard and date guards — no browser', () => {
  it('does not refocus/remount or alter text when the visual viewport shrinks around a focused input', async () => {
    const input = host.querySelector('input')!;
    input.getBoundingClientRect = () => ({ top:450,bottom:498,height:48,left:10,right:280,width:270,x:10,y:450,toJSON:()=>({}) });
    input.focus(); viewport.height = 380;
    await act(async () => { viewport.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(120); });
    expect(host.querySelector('input')).toBe(input);expect(document.activeElement).toBe(input);expect(input.value).toBe('كتابة مستمرة');
    expect(scroll).toHaveBeenCalledWith({ top: 498 - (380 - 16), behavior:'auto' }); expect(host.firstElementChild?.hasAttribute('data-keyboard-open')).toBe(true);
    expect(host.querySelector('div')!.style.getPropertyValue('--visible-viewport-height')).toBe('380px');
  });
  it('does not interfere with already-visible fields or pinch zoom', async () => {
    const input=host.querySelector('input')!;input.getBoundingClientRect=()=>({top:20,bottom:68,height:48,left:0,right:200,width:200,x:0,y:20,toJSON:()=>({})});
    input.focus();viewport.height=380;await act(async()=>{viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(120);});expect(scroll).not.toHaveBeenCalled();
    viewport.scale=2;await act(async()=>{viewport.dispatchEvent(new Event('resize'));vi.advanceTimersByTime(120);});expect(host.firstElementChild?.hasAttribute('data-keyboard-open')).toBe(false);expect(document.activeElement).toBe(input);
  });
  it('keeps a tall textarea reachable instead of jumping to its obscured bottom on every resize', () => {
    expect(obscuredFieldOffset({top:30,bottom:730,height:700},0,380)).toBe(0);
    expect(obscuredFieldOffset({top:-30,bottom:670,height:700},0,380)).toBe(-30-16);
  });
  it('keeps portrait dates in normal flow with logical dot spacing and removes the old microphone overlay', () => {
    const identity=readFileSync('client/src/personal.css','utf8'), dashboard=readFileSync('client/src/dashboard.css','utf8'), speech=readFileSync('client/src/dictation.css','utf8');
    expect(identity).toContain('.identity-timeline__period { position: static;');expect(identity).toContain('padding-inline: 18px 0;');
    expect(identity).toContain('min-inline-size: 0; max-inline-size: 100%; line-height: 1.7;');
    expect(dashboard).not.toContain('margin-top: -48px');expect(speech).toContain('.dictated-field { display: grid;');
    expect(speech).toContain('prefers-reduced-motion: reduce'); expect(identity).toContain('prefers-reduced-motion: reduce');
  });
});
