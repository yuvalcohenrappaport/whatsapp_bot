/**
 * LinkedInImageDropZone — thumbnail-scoped drop zone overlay.
 *
 * Rendered via `LinkedInPostCard.thumbnailOverlay` slot (pre-wired by Plan
 * 36-01 Task 6 — the parent div has `position: relative` so absolute-
 * positioned overlays work out of the box).
 *
 * Responsibilities:
 *   - Capture dragenter/dragover/dragleave/drop events on itself (absolutely
 *     positioned, fills the thumbnail's 96×96 desktop / 48×48 mobile box).
 *   - On drag-over show a dashed blue border + "Drop image to replace" text.
 *   - On drop:
 *     - Take dataTransfer.files[0] (first only; toast others)
 *     - validateImageClientSide → toast + bail on reject
 *     - URL.createObjectURL preview + XHR upload
 *     - Progress overlay with Loader2 spinner + percent
 *     - On success → onUploaded(updatedPost) + keep preview for ~1.2s while
 *       SSE catches up
 *     - On error → revoke preview + onError(message)
 *   - dragleave uses a counter pattern (children fire leave/enter, so we
 *     count depth and only clear drag state at 0)
 *
 * Plan: 36-04
 */
import { useState, useCallback, useRef, type DragEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardPost } from '@/api/linkedinSchemas';
import {
  useLinkedInImageUpload,
  validateImageClientSide,
  type ImageUploadError,
} from '@/hooks/useLinkedInImageUpload';

export interface LinkedInImageDropZoneProps {
  postId: string;
  /** Called on 2xx response with the updated post DTO. */
  onUploaded: (updatedPost: DashboardPost) => void;
  /** Called on any error (client validation, network, server). */
  onError: (message: string) => void;
  /** Optional: fired when a file has been validated and upload is about to start. */
  onStart?: () => void;
}

export function LinkedInImageDropZone({
  postId,
  onUploaded,
  onError,
  onStart,
}: LinkedInImageDropZoneProps) {
  const { upload } = useLinkedInImageUpload();
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      dragCounterRef.current = 0;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      if (files.length > 1) {
        onError('Only the first image was uploaded');
      }
      const file = files[0];

      // Synchronous client-side validation BEFORE preview/upload
      const validation = validateImageClientSide(file);
      if (validation) {
        onError(validation.message);
        return;
      }

      // Client-side preview via object URL
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      setProgress(0);
      onStart?.();

      try {
        const updated = await upload(postId, file, (ev) =>
          setProgress(ev.percent),
        );
        // Success — clear progress but keep the preview visible briefly so
        // SSE has time (~1.2s) to deliver the new post state and the
        // underlying Thumbnail component re-renders with the new bytes.
        setProgress(null);
        window.setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          setPreviewUrl(null);
        }, 1200);
        onUploaded(updated);
      } catch (err) {
        setProgress(null);
        URL.revokeObjectURL(objectUrl);
        setPreviewUrl(null);
        const typed = err as ImageUploadError;
        // Swallow silent aborts (e.g. user dragged a second file while the
        // first was in flight — the hook aborts the first and onError would
        // double-toast otherwise).
        if (typed.kind === 'aborted') return;
        onError(typed.message || 'Upload failed. Retry?');
      }
    },
    [postId, upload, onUploaded, onError, onStart],
  );

  return (
    <div
      className={cn(
        'absolute inset-0 rounded-md flex items-center justify-center text-xs text-blue-700 dark:text-blue-300 pointer-events-auto',
        dragOver
          ? 'border-2 border-dashed border-blue-400 bg-white/60 dark:bg-slate-900/60'
          : 'border border-transparent',
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {previewUrl && (
        <img
          src={previewUrl}
          alt="Upload preview"
          className="absolute inset-0 size-full rounded-md object-cover"
        />
      )}
      {dragOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/80 dark:bg-slate-900/80 rounded-md">
          <Upload className="size-4" />
          <span className="text-[10px] md:text-xs font-medium text-center px-1">
            Drop image to replace
          </span>
        </div>
      )}
      {progress !== null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white rounded-md">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-[10px] md:text-xs">{progress}%</span>
        </div>
      )}
    </div>
  );
}
