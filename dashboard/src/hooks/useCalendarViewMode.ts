import * as React from 'react';
import { useViewport } from './useViewport';

export type CalendarView = 'month' | 'week' | 'day' | '3day' | 'dots';

const MOBILE_VIEWS: CalendarView[] = ['day', '3day', 'dots'];
const DESKTOP_VIEWS: CalendarView[] = ['month', 'week', 'day'];
const MOBILE_DEFAULT: CalendarView = 'day';
const DESKTOP_DEFAULT: CalendarView = 'week';
const MOBILE_KEY = 'calendar-view-mode-mobile';
const DESKTOP_KEY = 'calendar-view-mode-desktop';

function readLs(key: string, fallback: CalendarView, allowed: CalendarView[]): CalendarView {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key) as CalendarView | null;
  return v && allowed.includes(v) ? v : fallback;
}

export function useCalendarViewMode() {
  const { isMobile } = useViewport();
  const allowed = isMobile ? MOBILE_VIEWS : DESKTOP_VIEWS;
  const key = isMobile ? MOBILE_KEY : DESKTOP_KEY;
  const fallback = isMobile ? MOBILE_DEFAULT : DESKTOP_DEFAULT;

  const [view, setViewState] = React.useState<CalendarView>(() =>
    readLs(key, fallback, allowed),
  );

  // Re-resolve when viewport flips (e.g., orientation rotation). Only
  // overwrite if the current view is NOT in the new allowed list.
  React.useEffect(() => {
    if (!allowed.includes(view)) {
      setViewState(readLs(key, fallback, allowed));
    }
  }, [isMobile, key, fallback, allowed, view]);

  const setView = React.useCallback((v: CalendarView) => {
    if (!allowed.includes(v)) return; // silently ignore desktop-only on mobile
    setViewState(v);
    if (typeof window !== 'undefined') window.localStorage.setItem(key, v);
  }, [allowed, key]);

  return { view, setView, availableViews: allowed };
}
