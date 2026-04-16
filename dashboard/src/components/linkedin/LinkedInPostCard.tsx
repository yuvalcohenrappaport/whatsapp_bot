/**
 * Reusable card for LinkedIn posts. Two variants:
 *   - 'queue': status pill + seq metadata + content preview + thumbnail
 *   - 'published': thumbnail + LinkedIn permalink + published_at + content
 *                  preview + 4-stat metrics row (or "Metrics pending")
 *
 * Both variants share the 96×96 thumbnail → 48×48 mobile shrink, the
 * Hebrew-above-English content rendering with "—" separator, and the
 * line-clamp-3 content compression.
 */
import { useState, type ReactNode } from 'react';
import {
  ExternalLink,
  FileText,
  Clock,
  Eye,
  MessageSquare,
  Repeat,
  Heart,
  Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { type LinkedInPost, statusStyle } from './postStatus';

type CardVariant = 'queue' | 'published';

export interface LinkedInPostCardProps {
  post: LinkedInPost;
  variant: CardVariant;
  className?: string;
  /**
   * Plan 36-02: rendered in the top-right of the queue card header row.
   * Ignored on the 'published' variant.
   */
  actionsSlot?: ReactNode;
  /**
   * Plan 36-03: when true, applies `ring-2 ring-blue-400 animate-pulse`,
   * swaps the status pill for a "Regenerating…" badge, and renders a
   * `Loader2` inline spinner next to that badge. Queue variant only.
   */
  isRegenerating?: boolean;
  /**
   * Plan 36-03: when true, briefly applies `bg-emerald-50` with
   * `transition-colors duration-[400ms]` to signal a just-completed
   * regeneration. The CALLER is responsible for clearing this prop via
   * setTimeout after ~400ms so the flash is one-shot. No toast is used
   * — this emerald flash IS the success feedback (CONTEXT §3 lock).
   * Queue variant only.
   */
  justRegenerated?: boolean;
  /**
   * Plan 36-04: rendered as a drop-zone overlay on top of the thumbnail.
   * Positioned absolutely inside a `relative` wrapper around <Thumbnail>.
   */
  thumbnailOverlay?: ReactNode;
  /**
   * Plan 36-04: rendered below the content preview for the
   * "Mark PII Reviewed" affordance. Queue variant only.
   */
  piiGateSlot?: ReactNode;
  /**
   * Plan 37-04: extra className applied to the root <Card>, typically a
   * 4px left-edge accent stripe (e.g. 'border-l-4 border-purple-500').
   * Sourced from STATUS_STYLES[status].accentClass. Queue variant only.
   */
  accentStripeClass?: string;
  /**
   * Plan 37-04: when true, applies a ~300ms amber bg flash to signal a
   * brand-new pending-action post arrived via SSE. The caller (LinkedInQueue)
   * owns the expiry via the useNewArrivalFlash hook. Queue variant only.
   */
  justArrivedFlash?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max).trimEnd() + '…';
}

function linkedInPermalink(shareUrn: string | null): string | null {
  if (!shareUrn) return null;
  // Confirmed via pm-authority/linkedin/client.py docstring: share_urn is
  // already in the form "urn:li:share:<id>". LinkedIn's feed URL accepts
  // this format directly.
  return `https://www.linkedin.com/feed/update/${shareUrn}/`;
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Thumbnail({ post }: { post: LinkedInPost }) {
  const [errored, setErrored] = useState(false);
  // <img> tags cannot send Authorization: Bearer headers. The image proxy
  // route accepts ?token=<jwt> as a query-string fallback (same trick as SSE).
  const token = localStorage.getItem('jwt') ?? '';
  const src = `/api/linkedin/posts/${post.id}/image?token=${encodeURIComponent(token)}`;

  if (errored || !post.image.url) {
    return (
      <div
        className="shrink-0 size-12 md:size-24 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"
        aria-label={`Image for post ${post.id} — ${post.status}`}
      >
        <FileText className="size-5 md:size-10" />
      </div>
    );
  }

  return (
    <img
      src={src}
      loading="lazy"
      alt={`Image for post ${post.id} — ${post.status}`}
      className="shrink-0 size-12 md:size-24 rounded-md object-cover bg-slate-100 dark:bg-slate-800"
      onError={() => setErrored(true)}
    />
  );
}

function ContentPreview({
  post,
  maxLines,
}: {
  post: LinkedInPost;
  maxLines: 2 | 3;
}) {
  // Hebrew above English, "—" separator, ~240 chars total budget.
  const CONTENT_BUDGET = 240;
  const hasHebrew =
    post.content_he !== null && post.content_he.trim().length > 0;
  const lineClamp = maxLines === 3 ? 'line-clamp-3' : 'line-clamp-2';

  if (!hasHebrew) {
    return (
      <p className={cn('text-sm text-muted-foreground leading-snug', lineClamp)}>
        {truncate(post.content, CONTENT_BUDGET)}
      </p>
    );
  }

  // Split budget 55/45 Hebrew/English
  const heBudget = Math.floor(CONTENT_BUDGET * 0.55);
  const enBudget = CONTENT_BUDGET - heBudget;
  return (
    <div
      className={cn('text-sm text-muted-foreground leading-snug', lineClamp)}
    >
      <span dir="rtl" lang="he">
        {truncate(post.content_he as string, heBudget)}
      </span>
      <span className="mx-2 opacity-60">—</span>
      <span dir="ltr" lang="en">
        {truncate(post.content, enBudget)}
      </span>
    </div>
  );
}

function QueueMeta({ post }: { post: LinkedInPost }) {
  // "seq · {short_id} · post N"
  const seqShort = post.sequence_id.slice(0, 8);
  return (
    <span className="text-xs text-muted-foreground">
      seq · {seqShort} · post {post.position}
    </span>
  );
}

function MetricsRow({ post }: { post: LinkedInPost }) {
  const a = post.analytics;
  if (!a) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
        <Clock className="size-3.5" />
        Metrics pending — available ~72h after publish
      </p>
    );
  }
  const fmt = (n: number | null): string =>
    n === null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Eye className="size-3.5" />
        {fmt(a.impressions)}
      </span>
      <span className="flex items-center gap-1">
        <MessageSquare className="size-3.5" />
        {fmt(a.comments)}
      </span>
      <span className="flex items-center gap-1">
        <Repeat className="size-3.5" />
        {fmt(a.reshares)}
      </span>
      <span className="flex items-center gap-1">
        <Heart className="size-3.5" />
        {fmt(a.reactions)}
      </span>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────

export function LinkedInPostCard({
  post,
  variant,
  className,
  actionsSlot,
  isRegenerating,
  justRegenerated,
  thumbnailOverlay,
  piiGateSlot,
  accentStripeClass,
  justArrivedFlash,
}: LinkedInPostCardProps) {
  if (variant === 'queue') {
    return (
      <QueueCard
        post={post}
        className={className}
        actionsSlot={actionsSlot}
        isRegenerating={isRegenerating}
        justRegenerated={justRegenerated}
        thumbnailOverlay={thumbnailOverlay}
        piiGateSlot={piiGateSlot}
        accentStripeClass={accentStripeClass}
        justArrivedFlash={justArrivedFlash}
      />
    );
  }
  return <PublishedCard post={post} className={className} />;
}

function QueueCard({
  post,
  className,
  actionsSlot,
  isRegenerating = false,
  justRegenerated = false,
  thumbnailOverlay,
  piiGateSlot,
  accentStripeClass,
  justArrivedFlash = false,
}: {
  post: LinkedInPost;
  className?: string;
  actionsSlot?: ReactNode;
  isRegenerating?: boolean;
  justRegenerated?: boolean;
  thumbnailOverlay?: ReactNode;
  piiGateSlot?: ReactNode;
  accentStripeClass?: string;
  justArrivedFlash?: boolean;
}) {
  const style = statusStyle(post.status);
  const relative = formatRelative(post.created_at);
  // Ring goes on while regen is in flight; emerald flash goes on for the
  // ~400ms window AFTER regen completes. CONTEXT §3 locks both visuals.
  const ringClass = isRegenerating ? 'ring-2 ring-blue-400 animate-pulse' : '';
  const flashClass = justRegenerated
    ? 'bg-emerald-50 dark:bg-emerald-950/30'
    : '';
  // Plan 37-04: amber arrival flash for new SSE-delivered pending-action posts.
  // The parent (LinkedInQueue) owns the 300ms expiry via useNewArrivalFlash.
  const arrivalClass = justArrivedFlash
    ? 'bg-amber-100 dark:bg-amber-900/30'
    : '';

  return (
    <Card
      className={cn(
        'p-4 md:p-5 transition-colors duration-[400ms]',
        ringClass,
        flashClass,
        accentStripeClass,
        arrivalClass,
        className,
      )}
    >
      <div className="flex items-start gap-3 md:gap-4">
        <div className="relative shrink-0">
          <Thumbnail post={post} />
          {thumbnailOverlay}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              {isRegenerating ? (
                <>
                  <Badge
                    variant="outline"
                    className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    Regenerating…
                  </Badge>
                  {/* CONTEXT §3: inline Loader2 spinner next to the badge. */}
                  <Loader2
                    className="size-3.5 animate-spin text-blue-600 dark:text-blue-400"
                    aria-hidden="true"
                  />
                </>
              ) : (
                <Badge variant="outline" className={style.className}>
                  {style.label}
                </Badge>
              )}
              <QueueMeta post={post} />
              {relative && (
                <span className="text-xs text-muted-foreground">
                  · {relative}
                </span>
              )}
            </div>
            {actionsSlot && (
              <div className="shrink-0 ml-auto flex items-center gap-1">
                {actionsSlot}
              </div>
            )}
          </div>
          <ContentPreview post={post} maxLines={3} />
          {piiGateSlot}
        </div>
      </div>
    </Card>
  );
}

function PublishedCard({
  post,
  className,
}: {
  post: LinkedInPost;
  className?: string;
}) {
  const href = linkedInPermalink(post.share_urn);
  const relative = formatRelative(post.published_at);

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <div className="flex items-start gap-3 md:gap-4">
        <Thumbnail post={post} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                LinkedIn
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                LinkedIn permalink unavailable
              </span>
            )}
            {relative && (
              <span className="text-xs text-muted-foreground">
                Published {relative}
              </span>
            )}
          </div>
          <ContentPreview post={post} maxLines={3} />
          <MetricsRow post={post} />
        </div>
      </div>
    </Card>
  );
}
