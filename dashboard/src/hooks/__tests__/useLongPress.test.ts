/**
 * useLongPress vitest suite (5 cases).
 *
 * jsdom supports PointerEvent in recent versions. We fire synthetic pointer
 * events on a div rendered with the hook's handlers spread on it.
 * vi.useFakeTimers() lets us advance time deterministically.
 *
 * Note on jsdom PointerEvent: jsdom ≥16 supports new PointerEvent(...) but
 * may not honour all fields. We set pointerType + clientX/Y inline when
 * constructing so the hook reads them correctly.
 */

import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { useLongPress } from '../useLongPress';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Render a div with useLongPress handlers spread on it.
 * Returns { handler (the mock fn), el (the div), unmount }.
 */
function setup(opts?: { ms?: number; moveThreshold?: number }) {
  const handler = vi.fn();

  function TestComponent() {
    const longPressProps = useLongPress(handler, opts ?? {});
    return React.createElement('div', { 'data-testid': 'lp', ...longPressProps });
  }

  const { getByTestId, unmount } = render(React.createElement(TestComponent));
  const el = getByTestId('lp');
  return { handler, el, unmount };
}

/**
 * Fire a PointerEvent on an element, patching pointerType if jsdom doesn't
 * support it natively.
 */
function fire(el: HTMLElement, type: string, props: {
  pointerType?: string;
  clientX?: number;
  clientY?: number;
}) {
  let event: Event;
  try {
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: props.pointerType ?? 'touch',
      clientX: props.clientX ?? 0,
      clientY: props.clientY ?? 0,
    });
  } catch {
    // Older jsdom fallback — build via MouseEvent and patch pointerType
    const me = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: props.clientX ?? 0,
      clientY: props.clientY ?? 0,
    }) as unknown as PointerEvent;
    Object.defineProperty(me, 'pointerType', {
      value: props.pointerType ?? 'touch',
      configurable: true,
    });
    event = me;
  }
  el.dispatchEvent(event);
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hold 600ms with 0 movement → handler called once', () => {
    const { handler, el } = setup();

    fire(el, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 200 });
    vi.advanceTimersByTime(600);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('hold 600ms with 20px movement → handler NOT called (cancelled)', () => {
    const { handler, el } = setup();

    fire(el, 'pointerdown', { pointerType: 'touch', clientX: 0, clientY: 0 });
    // Move 20px — exceeds default 8px threshold
    fire(el, 'pointermove', { pointerType: 'touch', clientX: 20, clientY: 0 });
    vi.advanceTimersByTime(600);

    expect(handler).not.toHaveBeenCalled();
  });

  it('hold 300ms then release → handler NOT called (cancelled by onPointerUp)', () => {
    const { handler, el } = setup();

    fire(el, 'pointerdown', { pointerType: 'touch', clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(300);
    fire(el, 'pointerup', { pointerType: 'touch', clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(300); // advance rest of what would have been 600ms

    expect(handler).not.toHaveBeenCalled();
  });

  it('mouse pointerdown → handler NOT called (timer never starts)', () => {
    const { handler, el } = setup();

    fire(el, 'pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(600);

    expect(handler).not.toHaveBeenCalled();
  });

  it('two consecutive valid 600ms holds → handler called exactly twice', () => {
    const { handler, el } = setup();

    // First hold
    fire(el, 'pointerdown', { pointerType: 'touch', clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(600);

    // Second hold (start fresh)
    fire(el, 'pointerdown', { pointerType: 'touch', clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(600);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
