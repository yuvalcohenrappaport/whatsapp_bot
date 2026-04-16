/**
 * Tracks post id arrivals across SSE re-emits and returns a Set of post
 * ids currently "flashing" — i.e. arrived within the last ~300ms.
 *
 * CONTEXT §Area 4 lock: only PENDING_LESSON_SELECTION + PENDING_VARIANT
 * posts trigger the amber arrival flash. Other status arrivals (e.g. a
 * new DRAFT from a newly-generated sequence) are deliberately quiet —
 * the flash is meant to announce "something needs your decision now."
 *
 * CONTEXT §Area 4 lock: NO toast. The card-level amber flash IS the
 * arrival feedback, so this hook does not import sonner.
 *
 * Plan 37-04.
 */
import { useEffect, useRef, useState } from 'react';
import type { LinkedInPost } from '@/components/linkedin/postStatus';

const FLASH_MS = 300;
const FLASH_STATUSES = new Set<string>([
  'PENDING_LESSON_SELECTION',
  'PENDING_VARIANT',
]);

export function useNewArrivalFlash(
  posts: LinkedInPost[] | null,
): Set<string> {
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  // null sentinel lets us distinguish "first render, seed only" from
  // "subsequent render, diff against prior snapshot". On first render we
  // never flash — we just record what was there.
  const prevIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!posts) return;
    const currentIds = new Set(posts.map((p) => p.id));

    // Initial mount: seed the prevIds without flashing anything.
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

    // Filter: only pending-action posts trigger the flash.
    const toFlash = new Set<string>();
    for (const p of posts) {
      if (newIds.has(p.id) && FLASH_STATUSES.has(p.status)) {
        toFlash.add(p.id);
      }
    }
    if (toFlash.size === 0) return;

    setFlashing((prev) => {
      const next = new Set(prev);
      for (const id of toFlash) next.add(id);
      return next;
    });

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of toFlash) {
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
  }, [posts]);

  return flashing;
}
