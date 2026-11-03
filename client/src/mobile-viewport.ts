import { useEffect, type RefObject } from 'react';

/** Move only if a focused field is actually obscured. No per-keystroke focus or scroll. */
export function obscuredFieldOffset(rect: { top: number; bottom: number; height: number }, top: number, height: number): number {
  if (height <= 0) return 0;
  const start = top + 16, end = top + height - 16;
  if (rect.height > height - 32) return rect.top < start || rect.top > end - 48 ? rect.top - start : 0;
  return rect.bottom > end ? rect.bottom - end : rect.top < start ? rect.top - start : 0;
}
export function useMobileViewport(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const root = ref.current, viewport = window.visualViewport;
    if (!enabled || !root || !viewport) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      root.style.setProperty('--visible-viewport-height', `${viewport.height}px`);
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && root.contains(focused) && focused.matches('input:not([type="file"]), textarea, select, [contenteditable="true"]');
      const keyboard = editing && viewport.scale <= 1.2 && window.innerHeight - viewport.height > 120;
      root.toggleAttribute('data-keyboard-open', keyboard);
      if (!keyboard || !(focused instanceof HTMLElement)) return;
      const offset = obscuredFieldOffset(focused.getBoundingClientRect(), viewport.offsetTop, viewport.height);
      if (Math.abs(offset) > 1) window.scrollBy({ top: offset, behavior: 'auto' });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 120); };
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    root.addEventListener('focusin', schedule);
    root.addEventListener('focusout', schedule);
    update();
    return () => {
      clearTimeout(timer); viewport.removeEventListener('resize', schedule); viewport.removeEventListener('scroll', schedule);
      root.removeEventListener('focusin', schedule); root.removeEventListener('focusout', schedule);
      root.removeAttribute('data-keyboard-open'); root.style.removeProperty('--visible-viewport-height');
    };
  }, [enabled, ref]);
}
