/**
 * Dashboard-local type mirror + status helpers for LinkedIn posts.
 *
 * The type shape MUST stay in lockstep with `src/api/linkedin/schemas.ts`
 * PostSchema in the whatsapp-bot backend. When PostSchema changes, update
 * this file too (or the runtime Zod parse in 35-04's hook will surface
 * the drift as a SchemaMismatchError and fall back to polling).
 *
 * Why duplicate instead of shared import: the dashboard Vite bundle and
 * the Fastify backend are two separate TypeScript projects with separate
 * node_modules resolution. Sharing Zod runtime across both would require
 * a monorepo tooling step that's out of scope for Phase 35.
 */

export interface LinkedInVariant {
  id: number;
  kind: string;
  content: string;
  image_prompt: string | null;
  selected: boolean;
}

export interface LinkedInLessonCandidate {
  id: number;
  lesson_text: string;
  rationale: string;
  image_url: string | null;
  selected: boolean;
}

export interface LinkedInImageInfo {
  source: 'ai' | 'screenshot' | 'uploaded' | null;
  url: string | null;
  pii_reviewed: boolean;
}

export interface LinkedInPostAnalytics {
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reshares: number | null;
  members_reached: number | null;
}

export interface LinkedInPost {
  id: string;
  sequence_id: string;
  position: number;
  status: string;
  perspective: string;
  language: string;
  content: string;
  content_he: string | null;
  image: LinkedInImageInfo;
  variants: LinkedInVariant[];
  lesson_candidates: LinkedInLessonCandidate[];
  regeneration_count: number;
  regeneration_capped: boolean;
  share_urn: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
  analytics?: LinkedInPostAnalytics | null;
}

// ─── Status pill color map (CONTEXT §1) ───────────────────────────────────

/**
 * Tailwind classes for each LinkedIn post status badge.
 * Matches the shape used in ScheduledMessageCard's STATUS_STYLES for
 * visual consistency with other dashboard pages.
 */
export const STATUS_STYLES: Record<
  string,
  { className: string; label: string }
> = {
  DRAFT: {
    className:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    label: 'Draft',
  },
  PENDING_VARIANT: {
    className:
      'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    label: 'Variant',
  },
  PENDING_LESSON_SELECTION: {
    className:
      'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    label: 'Lesson',
  },
  PENDING_PII_REVIEW: {
    className:
      'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    label: 'PII Review',
  },
  APPROVED: {
    className:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    label: 'Approved',
  },
  PUBLISHED: {
    className:
      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    label: 'Published',
  },
  REJECTED: {
    className:
      'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    label: 'Rejected',
  },
};

export function statusStyle(status: string): { className: string; label: string } {
  return (
    STATUS_STYLES[status] ?? {
      className:
        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
      label: status,
    }
  );
}

// ─── Predicates used by the queue page and status strip ─────────────────

const NON_TERMINAL = new Set<string>([
  'DRAFT',
  'PENDING_VARIANT',
  'PENDING_LESSON_SELECTION',
  'PENDING_PII_REVIEW',
  'APPROVED',
]);

const PENDING = new Set<string>([
  'DRAFT',
  'PENDING_VARIANT',
  'PENDING_LESSON_SELECTION',
  'PENDING_PII_REVIEW',
]);

export function isNonTerminal(status: string): boolean {
  return NON_TERMINAL.has(status);
}

export function isPending(status: string): boolean {
  return PENDING.has(status);
}

export function isApproved(status: string): boolean {
  return status === 'APPROVED';
}
