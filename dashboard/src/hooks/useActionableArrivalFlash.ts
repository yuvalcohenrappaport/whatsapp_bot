/**
 * 300ms amber arrival flash for newly-arriving pending actionables.
 *
 * Mirrors the seed-on-first-render pattern from `useNewArrivalFlash.ts`
 * (Phase 37 LinkedIn queue) but is simpler in one respect — EVERY new
 * `pending_approval` row deserves the flash (CONTEXT §Live-Update Behavior
 * "Row slides in at top of the pending list with a ~300ms amber arrival
 * flash"). The LinkedIn hook filters by sub-status because only certain
 * pending-action post statuses warranted the flash; all pending actionables
 * are semantically equal in the approval view.
 *
 * Accepts `pending: Actionable[] | null`, returns `Set<string>` of ids
 * currently flashing. The `null` sentinel means "still loading" — no flash
 * on initial mount; prevIds is seeded on the first non-null snapshot.
 */
import { useEffect, useRef, useState } from 'react';
import type { Actionable } from '@/api/actionablesSchemas';

const FLASH_MS = 300;

export function useActionableArrivalFlash(
  pending: Actionable[] | null,
): Set<string> {
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  // null sentinel distinguishes "first render, seed only" from "subsequent
  // render, diff against prior snapshot". On first render we never flash —
  // we just record what was already there.
  const prevIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!pending) return;
    const currentIds = new Set(pending.map((a) => a.id));

    // Initial mount: seed without flashing anything.
    if (prevIds.current === null) {
      prevIds.current = currentIds;
      return;
    }

    // Diff — ids appearing in the current snapshot for the first time.
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIds.current.has(id)) newIds.add(id);
    }
    prevIds.current = currentIds;
    if (newIds.size === 0) return;

    setFlashing((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of newIds) {
      timers.push(
        setTimeout(() => {
          setFlashing((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, FLASH_MS),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [pending]);

  return flashing;
}
