/**
 * useCalendarFilter — manages filter state, localStorage sync, and filtered items.
 *
 * Returns:
 *   - prefs               — current FilterPrefs (persisted to localStorage)
 *   - gtasksLists         — metadata per gtasks list observed in the window
 *   - gcalCalendars       — metadata per gcal calendar observed in the window
 *   - filteredItems       — items with hidden gtasks lists + hidden gcal calendars removed
 *   - resolveItemColor    — returns the Tailwind bg class for gtasks / gcal items
 *                           (respects per-list / per-calendar colorOverride)
 *   - toggleList          — set gtasks list visibility
 *   - overrideListColor   — override color + displayName for a gtasks list
 *   - toggleCalendar      — set gcal calendar visibility (Phase 47)
 *   - overrideCalendarColor — override color + displayName for a gcal calendar (Phase 47)
 *   - mobileFilterOpen    — state for the mobile-only sheet
 *   - setMobileFilterOpen — setter for the mobile-only sheet
 *
 * Introduced in Phase 46 Plan 03 (gtasks), extended in Phase 47 Plan 03 (gcal).
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { CalendarItem } from '@/api/calendarSchemas';
import {
  type FilterPrefs,
  loadFilterPrefs,
  saveFilterPrefs,
  setListVisible,
  setListColorOverride,
  getListPref,
  setCalendarVisible,
  setCalendarColorOverride,
  getCalendarPref,
} from '@/components/calendar/CalendarFilterPanel.types';

export type GtasksListMeta = {
  listId: string;
  listName: string;
  color: string; // hashed color from sourceFields
  itemCount: number;
};

export type GcalCalendarMeta = {
  calendarId: string;
  calendarName: string;
  color: string; // hashed color from sourceFields
  itemCount: number;
};

export function useCalendarFilter(allItems: CalendarItem[]) {
  const [prefs, setPrefs] = useState<FilterPrefs>(() => loadFilterPrefs());
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Sync to localStorage whenever prefs change
  useEffect(() => {
    saveFilterPrefs(prefs);
  }, [prefs]);

  // Derive gtasks list metadata from items currently in the view window
  const gtasksLists = useMemo<GtasksListMeta[]>(() => {
    const map = new Map<string, GtasksListMeta>();
    for (const item of allItems) {
      if (item.source !== 'gtasks') continue;
      const listId = (item.sourceFields.listId as string) ?? 'unknown';
      const listName = (item.sourceFields.listName as string) ?? listId;
      const color = (item.sourceFields.color as string) ?? 'bg-sky-500';
      const existing = map.get(listId);
      if (existing) {
        map.set(listId, { ...existing, itemCount: existing.itemCount + 1 });
      } else {
        map.set(listId, { listId, listName, color, itemCount: 1 });
      }
    }
    return Array.from(map.values());
  }, [allItems]);

  // Derive gcal calendar metadata from items currently in the view window
  const gcalCalendars = useMemo<GcalCalendarMeta[]>(() => {
    const map = new Map<string, GcalCalendarMeta>();
    for (const item of allItems) {
      if (item.source !== 'gcal') continue;
      const calendarId = (item.sourceFields.calendarId as string) ?? 'unknown';
      const calendarName = (item.sourceFields.calendarName as string) ?? calendarId;
      const color = (item.sourceFields.color as string) ?? 'bg-rose-500';
      const existing = map.get(calendarId);
      if (existing) {
        map.set(calendarId, { ...existing, itemCount: existing.itemCount + 1 });
      } else {
        map.set(calendarId, { calendarId, calendarName, color, itemCount: 1 });
      }
    }
    return Array.from(map.values());
  }, [allItems]);

  // Filtered items: exclude gtasks items from hidden lists + gcal items from
  // hidden calendars. task/event/linkedin always pass through.
  const filteredItems = useMemo<CalendarItem[]>(() => {
    return allItems.filter((item) => {
      if (item.source === 'gtasks') {
        const listId = (item.sourceFields.listId as string) ?? 'unknown';
        return getListPref(prefs, listId).visible;
      }
      if (item.source === 'gcal') {
        const calendarId = (item.sourceFields.calendarId as string) ?? 'unknown';
        return getCalendarPref(prefs, calendarId).visible;
      }
      return true;
    });
  }, [allItems, prefs]);

  // Resolve display color per item, respecting colorOverride.
  const resolveItemColor = useCallback(
    (item: CalendarItem): string => {
      if (item.source === 'gtasks') {
        const listId = (item.sourceFields.listId as string) ?? 'unknown';
        const pref = getListPref(prefs, listId);
        return pref.colorOverride ?? (item.sourceFields.color as string) ?? 'bg-sky-500';
      }
      if (item.source === 'gcal') {
        const calendarId = (item.sourceFields.calendarId as string) ?? 'unknown';
        const pref = getCalendarPref(prefs, calendarId);
        return pref.colorOverride ?? (item.sourceFields.color as string) ?? 'bg-rose-500';
      }
      return '';
    },
    [prefs],
  );

  const toggleList = useCallback((listId: string, visible: boolean) => {
    setPrefs((p) => setListVisible(p, listId, visible));
  }, []);

  const overrideListColor = useCallback((listId: string, color: string, displayName?: string) => {
    setPrefs((p) => setListColorOverride(p, listId, color, displayName));
  }, []);

  const toggleCalendar = useCallback((calendarId: string, visible: boolean) => {
    setPrefs((p) => setCalendarVisible(p, calendarId, visible));
  }, []);

  const overrideCalendarColor = useCallback(
    (calendarId: string, color: string, displayName?: string) => {
      setPrefs((p) => setCalendarColorOverride(p, calendarId, color, displayName));
    },
    [],
  );

  return {
    prefs,
    gtasksLists,
    gcalCalendars,
    filteredItems,
    resolveItemColor,
    toggleList,
    overrideListColor,
    toggleCalendar,
    overrideCalendarColor,
    mobileFilterOpen,
    setMobileFilterOpen,
  };
}
