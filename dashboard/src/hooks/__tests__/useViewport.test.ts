import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewport } from '@/hooks/useViewport';

// Helper: set window.innerWidth and dispatch a resize event
function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('useViewport', () => {
  beforeEach(() => {
    // Reset to a neutral desktop-ish width before each test
    setInnerWidth(1280);
  });

  it('returns isMobile=true when innerWidth is 400 (below 768px breakpoint)', () => {
    setInnerWidth(400);
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(false);
  });

  it('returns isTablet=true when innerWidth is 900 (768 <= w < 1024)', () => {
    setInnerWidth(900);
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(true);
    expect(result.current.isDesktop).toBe(false);
  });

  it('returns isDesktop=true when innerWidth is 1280 (>= 1024)', () => {
    setInnerWidth(1280);
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(true);
  });

  it('reflects updated innerWidth on fresh mount (simulates resize between navigations)', () => {
    // First mount at desktop
    setInnerWidth(1280);
    const { result: desktop } = renderHook(() => useViewport());
    expect(desktop.current.isDesktop).toBe(true);

    // Change to mobile width — hook initialises from window.innerWidth on mount
    setInnerWidth(375);
    const { result: mobile } = renderHook(() => useViewport());
    expect(mobile.current.isMobile).toBe(true);
    expect(mobile.current.isDesktop).toBe(false);
  });
});
