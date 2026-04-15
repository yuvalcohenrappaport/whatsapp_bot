/**
 * Shared presentational strip showing "Generated {relative} · Claude"
 * for any lesson candidate or variant card. Phase 37-01.
 *
 * CONTEXT §decisions locks "generation metadata (model, timestamp, token cost)"
 * on both lesson and variant cards. Only `created_at` is available from
 * pm-authority's schema today; model is hard-coded to "Claude" (pm-authority
 * is always driven by Claude CLI per generation/generator.py); token cost
 * is omitted because no column tracks it. If a future plan adds model_used
 * or total_tokens columns, extend this component only — both pages will
 * pick up the change.
 *
 * formatRelative is intentionally inlined (NOT imported from
 * LinkedInPostCard) to keep this component file-disjoint from the Wave-3/4
 * card file. Plans 37-02 and 37-03 import from here, never from the card.
 */
import { cn } from '@/lib/utils';

export interface GenerationMetadataProps {
  createdAt: string;
  className?: string;
}

function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return '';
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

export function GenerationMetadata({ createdAt, className }: GenerationMetadataProps) {
  const relative = formatRelative(createdAt);
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      Generated {relative ? `${relative} ` : ''}· Claude
    </p>
  );
}
