import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We mock useViewport so we can control isMobile per test
vi.mock('../useViewport', () => ({
  useViewport: vi.fn(() => ({ isMobile: false, isTablet: false, isDesktop: true })),
}));

import { useViewport } from '../useViewport';
import { useCalendarViewMode } from '../useCalendarViewMode';

const mockUseViewport = useViewport as ReturnType<typeof vi.fn>;

describe('useCalendarViewMode', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseViewport.mockReturnValue({ isMobile: false, isTablet: false, isDesktop: true });
  });

  it('mobile with no localStorage returns day', () => {
    mockUseViewport.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    const { result } = renderHook(() => useCalendarViewMode());
    expect(result.current.view).toBe('day');
  });

  it('desktop with no localStorage returns week', () => {
    mockUseViewport.mockReturnValue({ isMobile: false, isTablet: false, isDesktop: true });
    const { result } = renderHook(() => useCalendarViewMode());
    expect(result.current.view).toBe('week');
  });

  it('setView on mobile writes mobile key and leaves desktop key untouched', () => {
    mockUseViewport.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    const { result } = renderHook(() => useCalendarViewMode());
    act(() => {
      result.current.setView('3day');
    });
    expect(localStorage.getItem('calendar-view-mode-mobile')).toBe('3day');
    expect(localStorage.getItem('calendar-view-mode-desktop')).toBeNull();
  });

  it('setView on desktop writes desktop key and leaves mobile key untouched', () => {
    mockUseViewport.mockReturnValue({ isMobile: false, isTablet: false, isDesktop: true });
    const { result } = renderHook(() => useCalendarViewMode());
    act(() => {
      result.current.setView('month');
    });
    expect(localStorage.getItem('calendar-view-mode-desktop')).toBe('month');
    expect(localStorage.getItem('calendar-view-mode-mobile')).toBeNull();
  });

  it('setView(month) on mobile silently no-ops', () => {
    mockUseViewport.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false });
    const { result } = renderHook(() => useCalendarViewMode());
    act(() => {
      result.current.setView('month'); // desktop-only view — must be ignored
    });
    // view stays at mobile default (day)
    expect(result.current.view).toBe('day');
    expect(localStorage.getItem('calendar-view-mode-mobile')).toBeNull();
  });
});
