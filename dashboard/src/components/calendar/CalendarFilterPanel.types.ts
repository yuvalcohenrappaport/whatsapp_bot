/**
 * CalendarFilterPanel types + localStorage helpers.
 *
 * Single localStorage key `calFilterPrefs_v1` carries both Google Tasks
 * (gtasksLists) and Google Calendar (gcalCalendars) preferences. Forward-
 * compatible loader fills in missing sections with [] so old blobs parse.
 *
 * Phase 46 Plan 03 introduced gtasksLists; Phase 47 Plan 03 added
 * gcalCalendars — both waves shipped together (see 47-03 Rule-3 deviation).
 */

const LS_KEY = 'calFilterPrefs_v1';

// Per-list or per-calendar visibility preference.
export type ListPref = {
  id: string; // listId for gtasks, calendarId for gcal
  visible: boolean;
  colorOverride?: string; // Tailwind bg class, e.g. 'bg-rose-500'
  displayNameOverride?: string; // display-only override, no writeback to Google
};

// Top-level prefs persisted to localStorage.
export type FilterPrefs = {
  gtasksLists: ListPref[];
  gcalCalendars: ListPref[];
};

export function loadFilterPrefs(): FilterPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { gtasksLists: [], gcalCalendars: [] };
    const parsed = JSON.parse(raw) as Partial<FilterPrefs>;
    // Forward-compat: fill in missing sections so legacy blobs (Phase 46
    // without gcalCalendars, or an even older blob) load without error.
    return {
      gtasksLists: parsed.gtasksLists ?? [],
      gcalCalendars: parsed.gcalCalendars ?? [],
    };
  } catch {
    return { gtasksLists: [], gcalCalendars: [] };
  }
}

export function saveFilterPrefs(prefs: FilterPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage quota exceeded or private mode — silently ignore
  }
}

// -----------------------------------------------------------------------
// Google Tasks helpers
// -----------------------------------------------------------------------

export function getListPref(prefs: FilterPrefs, listId: string): ListPref {
  return prefs.gtasksLists.find((l) => l.id === listId) ?? { id: listId, visible: true };
}

export function setListVisible(prefs: FilterPrefs, listId: string, visible: boolean): FilterPrefs {
  const existing = prefs.gtasksLists.find((l) => l.id === listId);
  if (existing) {
    return {
      ...prefs,
      gtasksLists: prefs.gtasksLists.map((l) => (l.id === listId ? { ...l, visible } : l)),
    };
  }
  return {
    ...prefs,
    gtasksLists: [...prefs.gtasksLists, { id: listId, visible }],
  };
}

export function setListColorOverride(
  prefs: FilterPrefs,
  listId: string,
  colorOverride: string,
  displayNameOverride?: string,
): FilterPrefs {
  const existing = prefs.gtasksLists.find((l) => l.id === listId);
  if (existing) {
    return {
      ...prefs,
      gtasksLists: prefs.gtasksLists.map((l) =>
        l.id === listId
          ? { ...l, colorOverride, ...(displayNameOverride !== undefined ? { displayNameOverride } : {}) }
          : l,
      ),
    };
  }
  return {
    ...prefs,
    gtasksLists: [...prefs.gtasksLists, { id: listId, visible: true, colorOverride, displayNameOverride }],
  };
}

// -----------------------------------------------------------------------
// Google Calendar helpers (Phase 47 Plan 03)
// -----------------------------------------------------------------------

export function getCalendarPref(prefs: FilterPrefs, calendarId: string): ListPref {
  return (
    prefs.gcalCalendars.find((c) => c.id === calendarId) ?? { id: calendarId, visible: true }
  );
}

export function setCalendarVisible(
  prefs: FilterPrefs,
  calendarId: string,
  visible: boolean,
): FilterPrefs {
  const existing = prefs.gcalCalendars.find((c) => c.id === calendarId);
  if (existing) {
    return {
      ...prefs,
      gcalCalendars: prefs.gcalCalendars.map((c) =>
        c.id === calendarId ? { ...c, visible } : c,
      ),
    };
  }
  return {
    ...prefs,
    gcalCalendars: [...prefs.gcalCalendars, { id: calendarId, visible }],
  };
}

export function setCalendarColorOverride(
  prefs: FilterPrefs,
  calendarId: string,
  colorOverride: string,
  displayNameOverride?: string,
): FilterPrefs {
  const existing = prefs.gcalCalendars.find((c) => c.id === calendarId);
  if (existing) {
    return {
      ...prefs,
      gcalCalendars: prefs.gcalCalendars.map((c) =>
        c.id === calendarId
          ? { ...c, colorOverride, ...(displayNameOverride !== undefined ? { displayNameOverride } : {}) }
          : c,
      ),
    };
  }
  return {
    ...prefs,
    gcalCalendars: [
      ...prefs.gcalCalendars,
      { id: calendarId, visible: true, colorOverride, displayNameOverride },
    ],
  };
}
