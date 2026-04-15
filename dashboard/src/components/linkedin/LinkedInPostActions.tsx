/**
 * LinkedInPostActions — responsive write-action surface for a queue card.
 *
 * Two coordinated surfaces:
 *   - Desktop (≥md): 4-button inline row (Approve, Reject, Edit, Regenerate)
 *   - Mobile  (<md): single … MoreHorizontal DropdownMenu with 4 items
 *
 * Both surfaces share a single source of truth for disable predicates +
 * tooltip strings. The destructive reject confirmation AlertDialog is
 * mounted once at the parent level and opened from either surface.
 *
 * Plan: 36-02 (owns Approve / Reject / Edit)
 * Plan 36-03 will wire the `onRegenerate` prop; Plan 36-02 passes a no-op.
 */
import { useState, type ReactElement } from 'react';
import { Check, X, RefreshCw, Pencil, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LinkedInPost } from './postStatus';

export interface LinkedInPostActionsProps {
  post: LinkedInPost;
  /** True while Plan 36-03's regenerate job is in flight. Disables all buttons. */
  isRegenerating?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  /** Plan 36-03 wires this. Plan 36-02 passes a no-op default from the parent. */
  onRegenerate: () => void;
}

export function LinkedInPostActions({
  post,
  isRegenerating = false,
  onApprove,
  onReject,
  onEdit,
  onRegenerate,
}: LinkedInPostActionsProps) {
  const [rejectOpen, setRejectOpen] = useState(false);

  // SINGLE SOURCE OF TRUTH for disable predicates + tooltip strings.
  // Both the desktop inline row AND the mobile dropdown read from this.
  const approveDisabled =
    isRegenerating || post.status === 'PENDING_PII_REVIEW';
  const approveTooltip = isRegenerating
    ? 'Regenerating — wait for new content'
    : post.status === 'PENDING_PII_REVIEW'
      ? 'Clear PII review first'
      : null;

  const rejectDisabled = isRegenerating;
  const rejectTooltip = isRegenerating
    ? 'Regenerating — wait for new content'
    : null;

  const editDisabled = isRegenerating;
  const editTooltip = isRegenerating
    ? 'Regenerating — wait for new content'
    : null;

  const regenDisabled = isRegenerating || post.regeneration_count >= 5;
  const regenTooltip = isRegenerating
    ? 'Regenerating…'
    : post.regeneration_count >= 5
      ? 'Regeneration cap reached (5/5)'
      : null;

  // Open the shared AlertDialog from either surface.
  const openReject = () => setRejectOpen(true);

  return (
    <TooltipProvider delayDuration={200}>
      {/* --- Desktop: inline 4-button row (≥md only) --- */}
      <div className="hidden md:flex items-center gap-1.5">
        {/* Approve */}
        <TooltipOrPlain tooltip={approveTooltip}>
          <Button
            size="sm"
            variant="default"
            className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={approveDisabled}
            onClick={onApprove}
            aria-label="Approve post"
          >
            <Check className="size-4" />
            <span className="ml-1">Approve</span>
          </Button>
        </TooltipOrPlain>

        {/* Reject — opens the shared AlertDialog */}
        <TooltipOrPlain tooltip={rejectTooltip}>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={rejectDisabled}
            onClick={openReject}
            aria-label="Reject post"
          >
            <X className="size-4" />
            <span className="ml-1">Reject</span>
          </Button>
        </TooltipOrPlain>

        {/* Edit */}
        <TooltipOrPlain tooltip={editTooltip}>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={editDisabled}
            onClick={onEdit}
            aria-label="Edit post"
          >
            <Pencil className="size-4" />
            <span className="ml-1">Edit</span>
          </Button>
        </TooltipOrPlain>

        {/* Regenerate — Plan 36-03 wires onRegenerate; shell lives here */}
        <TooltipOrPlain tooltip={regenTooltip}>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-blue-400 text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
            disabled={regenDisabled}
            onClick={onRegenerate}
            aria-label="Regenerate post"
          >
            <RefreshCw
              className={'size-4' + (isRegenerating ? ' animate-spin' : '')}
            />
            <span className="ml-1">Regenerate</span>
          </Button>
        </TooltipOrPlain>
      </div>

      {/* --- Mobile: single … DropdownMenu trigger (<md only) --- */}
      {/* CONTEXT §1: "Mobile (<768px): collapse behind a single … menu." */}
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              aria-label="Post actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              disabled={approveDisabled}
              onSelect={(e) => {
                e.preventDefault();
                if (!approveDisabled) onApprove();
              }}
            >
              <Check className="size-4 mr-2 text-emerald-600" />
              Approve
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={editDisabled}
              onSelect={(e) => {
                e.preventDefault();
                if (!editDisabled) onEdit();
              }}
            >
              <Pencil className="size-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={regenDisabled}
              onSelect={(e) => {
                e.preventDefault();
                if (!regenDisabled) onRegenerate();
              }}
            >
              <RefreshCw
                className={
                  'size-4 mr-2 text-blue-600' +
                  (isRegenerating ? ' animate-spin' : '')
                }
              />
              Regenerate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={rejectDisabled}
              onSelect={(e) => {
                // Destructive: route through the SAME AlertDialog as the
                // desktop Reject button.
                e.preventDefault();
                if (!rejectDisabled) openReject();
              }}
              className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950"
            >
              <X className="size-4 mr-2" />
              Reject
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* --- Shared reject confirmation dialog (mounted once; opened by either surface) --- */}
      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this post?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be marked REJECTED and removed from the queue. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                setRejectOpen(false);
                onReject();
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

/** Helper: wrap in a Tooltip only when there's text to show. */
function TooltipOrPlain({
  tooltip,
  children,
}: {
  tooltip: string | null;
  children: ReactElement;
}) {
  if (!tooltip) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span wrapper: Radix Tooltip on a disabled Button needs a
            non-disabled trigger so the tooltip still shows */}
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
