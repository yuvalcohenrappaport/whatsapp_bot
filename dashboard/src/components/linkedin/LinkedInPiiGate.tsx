/**
 * LinkedInPiiGate — "Mark PII Reviewed" affordance.
 *
 * Rendered via `LinkedInPostCard.piiGateSlot` slot. Parent
 * (LinkedInQueueRoute) only mounts this component when
 * `post.status === 'PENDING_PII_REVIEW'`; the component itself is
 * status-agnostic — it just calls the `onConfirm` prop.
 *
 * Plan: 36-04
 */
import { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LinkedInPiiGateProps {
  postId: string;
  /** Called when the user clicks "Mark PII Reviewed". Parent owns the POST. */
  onConfirm: () => Promise<void>;
}

export function LinkedInPiiGate({ postId, onConfirm }: LinkedInPiiGateProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex items-center gap-2 pt-1"
      data-post-id={postId}
      data-testid="linkedin-pii-gate"
    >
      <div className="flex-1 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
        <ShieldCheck className="size-3.5" />
        Review the uploaded image for PII before approving
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950"
        disabled={loading}
        onClick={handleClick}
        aria-label="Mark PII reviewed"
      >
        {loading && <Loader2 className="size-3 animate-spin mr-1" />}
        Mark PII Reviewed
      </Button>
    </div>
  );
}
