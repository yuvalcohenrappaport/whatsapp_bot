import * as React from 'react';

type Options = {
  onLeft?: () => void;
  onRight?: () => void;
  threshold?: number;        // default 60px
  maxVerticalDrift?: number; // default 30px
};

/**
 * Pointer-events horizontal swipe detector. Fires onLeft/onRight on
 * pointerup IFF total |dx| >= threshold AND |dy| < maxVerticalDrift.
 * Does NOT preventDefault on pointermove — vertical scroll is preserved.
 * Cleans up on unmount.
 */
export function useHorizontalSwipe(
  ref: React.RefObject<HTMLElement | null>,
  { onLeft, onRight, threshold = 60, maxVerticalDrift = 30 }: Options,
) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let active = false;

    const onDown = (e: PointerEvent) => {
      // Mouse pointers ignored — desktop drag-DnD on calendar items must
      // not be hijacked. Touch / pen only.
      if (e.pointerType === 'mouse') return;
      startX = e.clientX;
      startY = e.clientY;
      active = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      const dx = e.clientX - startX;
      const dy = Math.abs(e.clientY - startY);
      if (dy >= maxVerticalDrift) return;       // scroll-like, ignore
      if (dx <= -threshold) onLeft?.();
      else if (dx >= threshold) onRight?.();
    };
    const onCancel = () => { active = false; };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [ref, onLeft, onRight, threshold, maxVerticalDrift]);
}
