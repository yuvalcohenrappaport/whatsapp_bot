/**
 * CalendarDragGhost — portal-rendered drag ghost for calendar pills.
 *
 * WHY THIS EXISTS:
 *   Native HTML5 drag creates a static semi-transparent clone of the dragged
 *   element. It does NOT support live-updating captions (e.g. "Tue 2026-04-21
 *   14:30" that changes as the pointer moves across rows). A portal-rendered
 *   custom ghost — positioned via pointer coordinates — is the only way to
 *   show a live target timestamp during drag.
 *
 * ARCHITECTURE:
 *   Module-level state (no Zustand, no Context). A tiny pub-sub via
 *   useSyncExternalStore keeps React in sync without prop-drilling.
 *
 *   Exports:
 *     useCalendarDragGhost() — returns { show, hide, move, setTarget, state }
 *     <CalendarDragGhost />  — the portal component; mount ONCE in Calendar.tsx
 *
 * RENDER:
 *   ReactDOM.createPortal(..., document.body) so it's never clipped by
 *   calendar grid overflow. pointer-events-none + z-50.
 *
 * Plan 44-05.
 */
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPill } from './CalendarPill';
import { formatIstAbsolute } from '@/lib/ist';
import type { CalendarItem } from '@/api/calendarSchemas';

// -----------------------------------------------------------------------
// Module-level state
// -----------------------------------------------------------------------

interface GhostState {
  visible: boolean;
  item: CalendarItem | null;
  x: number;
  y: number;
  captionMs: number | null;
}

let _state: GhostState = {
  visible: false,
  item: null,
  x: 0,
  y: 0,
  captionMs: null,
};

const _listeners = new Set<() => void>();

function _notify() {
  for (const listener of _listeners) listener();
}

function _setState(partial: Partial<GhostState>) {
  _state = { ..._state, ...partial };
  _notify();
}

function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function _getSnapshot() {
  return _state;
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export interface CalendarDragGhostControls {
  show: (item: CalendarItem) => void;
  hide: () => void;
  move: (x: number, y: number) => void;
  setTarget: (captionMs: number | null) => void;
  state: GhostState;
}

/**
 * Hook that exposes ghost controls. Does NOT subscribe to ghost state, so
 * callers (Calendar page, views, pills) don't re-render on every pointer
 * move during drag — only the portal component below subscribes.
 *
 * The returned `state` is a stale snapshot (fine for read-at-call, never for
 * render-driven reads).
 */
export function useCalendarDragGhost(): CalendarDragGhostControls {
  return {
    show(item: CalendarItem) {
      _setState({ visible: true, item, captionMs: item.start });
    },
    hide() {
      _setState({ visible: false, item: null, captionMs: null });
    },
    move(x: number, y: number) {
      _setState({ x, y });
    },
    setTarget(captionMs: number | null) {
      _setState({ captionMs });
    },
    get state() {
      return _state;
    },
  };
}

// -----------------------------------------------------------------------
// Portal component — mount ONCE in Calendar.tsx
// -----------------------------------------------------------------------

/**
 * Renders the drag ghost into document.body via a React portal.
 * Mount this once at the root of Calendar.tsx.
 */
export function CalendarDragGhost() {
  const state = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);

  if (!state.item) return null;

  return createPortal(
    <div
      className="fixed pointer-events-none z-50 select-none"
      style={{
        left: state.x + 14,
        top: state.y + 14,
        opacity: state.visible ? 1 : 0,
        transition: 'opacity 75ms',
        minWidth: '120px',
        maxWidth: '200px',
      }}
    >
      {/* Mini pill clone */}
      <CalendarPill item={state.item} compact ghost />
      {/* Live timestamp caption */}
      {state.captionMs !== null && (
        <div className="mt-1 text-xs bg-zinc-900/90 text-zinc-50 rounded px-2 py-1 shadow-md">
          {formatIstAbsolute(state.captionMs)}
        </div>
      )}
    </div>,
    document.body,
  );
}
