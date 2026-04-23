import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { useHorizontalSwipe } from '../useHorizontalSwipe';

// Helper: dispatch a synthetic pointer event on an element.
// jsdom supports PointerEvent in recent versions; if not, we fall back to
// a manual event construction (documented below).
function firePointer(el: HTMLElement, type: string, props: Partial<PointerEvent>) {
  let event: Event;
  try {
    // Try native PointerEvent first (jsdom ≥16 supports it)
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch', // default to touch so the hook doesn't skip it
      clientX: 0,
      clientY: 0,
      ...props,
    });
  } catch {
    // Fallback: CustomEvent with matching shape (older jsdom)
    // Cast to PointerEvent via the hook's `e.clientX / e.pointerType` reads
    const ce = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: (props as MouseEventInit).clientX ?? 0,
      clientY: (props as MouseEventInit).clientY ?? 0,
    }) as unknown as PointerEvent;
    // Patch missing pointerType onto the event object
    Object.defineProperty(ce, 'pointerType', { value: (props as Partial<PointerEvent>).pointerType ?? 'touch', configurable: true });
    event = ce;
  }
  el.dispatchEvent(event);
}

function swipe(el: HTMLElement, dx: number, dy: number, pointerType = 'touch') {
  firePointer(el, 'pointerdown', { clientX: 0, clientY: 0, pointerType } as Partial<PointerEvent>);
  firePointer(el, 'pointerup', { clientX: dx, clientY: dy, pointerType } as Partial<PointerEvent>);
}

describe('useHorizontalSwipe', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('80px right swipe with 10px drift fires onRight once', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useHorizontalSwipe(ref, { onLeft, onRight });
    });
    swipe(container, 80, 10);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('80px right swipe with 50px vertical drift fires neither callback', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useHorizontalSwipe(ref, { onLeft, onRight });
    });
    swipe(container, 80, 50);
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('30px right swipe (under threshold) fires neither callback', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useHorizontalSwipe(ref, { onLeft, onRight });
    });
    swipe(container, 30, 5);
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('80px left swipe with low drift fires onLeft once', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useHorizontalSwipe(ref, { onLeft, onRight });
    });
    swipe(container, -80, 10);
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();
  });

  it('two consecutive 80px right swipes fire onRight exactly twice', () => {
    const onRight = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useHorizontalSwipe(ref, { onRight });
    });
    swipe(container, 80, 5);
    swipe(container, 80, 5);
    expect(onRight).toHaveBeenCalledTimes(2);
  });
});
