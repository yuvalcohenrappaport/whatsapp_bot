import * as React from 'react';

type Options = {
  ms?: number;             // default 500
  moveThreshold?: number;  // default 8 px
};

/**
 * Returns spreadable pointer handlers. Attach with {...useLongPress(handler)}.
 * Fires handler() after `ms` ms IFF total pointer movement < moveThreshold AND
 * the pointer didn't release first. Ignores mouse pointers — desktop UX
 * (drag, click, hover) must not be hijacked.
 */
export function useLongPress(
  handler: () => void,
  { ms = 500, moveThreshold = 8 }: Options = {},
) {
  const timer = React.useRef<number | null>(null);
  const start = React.useRef<{ x: number; y: number } | null>(null);

  const cancel = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  return React.useMemo(() => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        handler();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current || timer.current === null) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      if (dx > moveThreshold || dy > moveThreshold) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  }), [handler, ms, moveThreshold, cancel]);
}
