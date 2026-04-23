/**
 * CalendarFilterPanel — unified left-rail filter surface for /calendar.
 *
 * Sections:
 *   - "Google Tasks" — one row per gtasks list (toggle + color swatch + name + count + gear)
 *   - "Google Calendar" — one row per gcal calendar (same UX)
 *
 * Mobile: rendered inside a Sheet (bottom drawer) via CalendarFilterPanelSheet.
 * Desktop: rendered as a left-rail aside column alongside the calendar grid.
 *
 * Phase 46 Plan 03 introduced the Google Tasks section; Phase 47 Plan 03
 * added the Google Calendar section. Both waves shipped together (see
 * 47-03-SUMMARY Rule-3 deviation).
 *
 * No external Checkbox component is used — native <input type="checkbox">
 * styled with tailwind. Dashboard ui/ does not ship a checkbox primitive
 * and installing one for a two-section panel is over-engineering.
 */
import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { GtasksListMeta, GcalCalendarMeta } from '@/hooks/useCalendarFilter';
import {
  type FilterPrefs,
  getListPref,
  getCalendarPref,
} from '@/components/calendar/CalendarFilterPanel.types';

// Palette for the gear-icon color override picker
const PALETTE_OPTIONS = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-fuchsia-500',
];

export type CalendarFilterPanelProps = {
  prefs: FilterPrefs;
  gtasksLists: GtasksListMeta[];
  onToggleList: (listId: string, visible: boolean) => void;
  onOverrideColor: (listId: string, color: string, displayName?: string) => void;
  // Phase 47 — Google Calendar section
  gcalCalendars: GcalCalendarMeta[];
  onToggleCalendar: (calendarId: string, visible: boolean) => void;
  onOverrideCalendarColor: (calendarId: string, color: string, displayName?: string) => void;
  // Future extensibility — additional sections rendered below gcal
  extraSections?: React.ReactNode;
};

/**
 * Generic row used by both sections — identical UX, different callbacks.
 */
function FilterRow({
  id,
  displayColor,
  displayName,
  originalName,
  itemCount,
  visible,
  onToggle,
  onOverride,
}: {
  id: string;
  displayColor: string;
  displayName: string;
  originalName: string;
  itemCount: number;
  visible: boolean;
  onToggle: (visible: boolean) => void;
  onOverride: (color: string, displayName?: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1 group">
      <input
        id={`filter-${id}`}
        type="checkbox"
        checked={visible}
        onChange={(e) => onToggle(e.target.checked)}
        className="shrink-0 h-4 w-4 accent-foreground cursor-pointer"
      />
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${displayColor}`} />
      <label
        htmlFor={`filter-${id}`}
        className="flex-1 text-sm cursor-pointer truncate"
      >
        {displayName}
      </label>
      <span className="text-xs text-muted-foreground tabular-nums">{itemCount}</span>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            aria-label={`Override color for ${displayName}`}
          >
            ⚙
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" side="right">
          <div className="text-xs font-medium mb-2">Color override</div>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {PALETTE_OPTIONS.map((color) => (
              <button
                key={color}
                className={`h-6 w-6 rounded-full ${color} ring-offset-1 ${
                  displayColor === color ? 'ring-2 ring-foreground' : ''
                }`}
                onClick={() => onOverride(color)}
                aria-label={color}
              />
            ))}
          </div>
          <div className="text-xs font-medium mb-1">Display name</div>
          <input
            className="w-full text-sm border rounded px-2 py-1"
            defaultValue={displayName}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== originalName) {
                onOverride(displayColor, v);
              }
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CalendarFilterPanel({
  prefs,
  gtasksLists,
  onToggleList,
  onOverrideColor,
  gcalCalendars,
  onToggleCalendar,
  onOverrideCalendarColor,
  extraSections,
}: CalendarFilterPanelProps) {
  return (
    <div className="w-full lg:w-56 lg:shrink-0 lg:pr-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
      </div>

      {/* Google Tasks section */}
      <div className="mb-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">Google Tasks</div>
        {gtasksLists.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No tasks in window</div>
        )}
        {gtasksLists.map((list) => {
          const pref = getListPref(prefs, list.listId);
          const displayColor = pref.colorOverride ?? list.color;
          const displayName = pref.displayNameOverride ?? list.listName;
          return (
            <FilterRow
              key={list.listId}
              id={`list-${list.listId}`}
              displayColor={displayColor}
              displayName={displayName}
              originalName={list.listName}
              itemCount={list.itemCount}
              visible={pref.visible}
              onToggle={(v) => onToggleList(list.listId, v)}
              onOverride={(color, name) => onOverrideColor(list.listId, color, name)}
            />
          );
        })}
      </div>

      {/* Google Calendar section — Phase 47 Plan 03 */}
      <div className="mb-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">Google Calendar</div>
        {gcalCalendars.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No events in window</div>
        )}
        {gcalCalendars.map((cal) => {
          const pref = getCalendarPref(prefs, cal.calendarId);
          const displayColor = pref.colorOverride ?? cal.color;
          const displayName = pref.displayNameOverride ?? cal.calendarName;
          return (
            <FilterRow
              key={cal.calendarId}
              id={`cal-${cal.calendarId}`}
              displayColor={displayColor}
              displayName={displayName}
              originalName={cal.calendarName}
              itemCount={cal.itemCount}
              visible={pref.visible}
              onToggle={(v) => onToggleCalendar(cal.calendarId, v)}
              onOverride={(color, name) => onOverrideCalendarColor(cal.calendarId, color, name)}
            />
          );
        })}
      </div>

      {/* Future extension point */}
      {extraSections}
    </div>
  );
}

/**
 * Mobile-only wrapper — shows the panel inside a sliding sheet triggered
 * from the CalendarHeader filter button.
 */
export function CalendarFilterPanelSheet(
  props: CalendarFilterPanelProps & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  },
) {
  const { open, onOpenChange, ...panelProps } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 pt-10">
        <SheetHeader>
          <SheetTitle className="text-sm">Filters</SheetTitle>
        </SheetHeader>
        <div className="mt-4 px-4">
          <CalendarFilterPanel {...panelProps} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
