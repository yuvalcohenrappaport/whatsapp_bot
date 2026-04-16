/**
 * Entry button rendered in the actionsSlot of pending-action queue cards.
 * Routes to the lesson selection or variant finalization page built in
 * Plans 37-02 / 37-03.
 *
 * CONTEXT §Area 4 lock: this is the only action rendered for
 * PENDING_LESSON_SELECTION and PENDING_VARIANT posts in the queue —
 * approve/reject/edit from Phase 36 are NOT shown for pending-action
 * posts (the owner must resolve the pending decision first).
 *
 * Plan 37-04.
 */
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { LinkedInPost } from './postStatus';

export interface PendingActionEntryButtonProps {
  post: LinkedInPost;
}

export function PendingActionEntryButton({
  post,
}: PendingActionEntryButtonProps) {
  if (post.status === 'PENDING_LESSON_SELECTION') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link
          to={`/linkedin/queue/posts/${encodeURIComponent(post.id)}/lesson`}
        >
          Pick lesson
          <ArrowRight className="size-3.5 ml-1" aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  if (post.status === 'PENDING_VARIANT') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link
          to={`/linkedin/queue/posts/${encodeURIComponent(post.id)}/variant`}
        >
          Pick variant
          <ArrowRight className="size-3.5 ml-1" aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  return null;
}
