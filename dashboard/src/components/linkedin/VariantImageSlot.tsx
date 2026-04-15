/**
 * Image area for a variant card. Four render modes:
 *
 *   A. 'idle': no image generation yet and user hasn't picked this variant
 *      → placeholder "Image will generate on selection"
 *   B. 'pending': user has picked this variant, fal.ai is running
 *      → spinner + "Generating image…" + elapsed-seconds counter
 *   C. 'ready': post.image.url is populated → <img> renders the real image
 *   D. 'error': generation failed → red error card with message
 *
 * Per CONTEXT §Area 3 Scenario B: NO client-side timeout. The spinner spins
 * indefinitely until the backend (via SSE) reports completion or failure.
 *
 * Plan: 37-03.
 */
import { useEffect, useState } from 'react';
import { Loader2, ImageOff } from 'lucide-react';

export type VariantImageMode = 'idle' | 'pending' | 'ready' | 'error';

export interface VariantImageSlotProps {
  mode: VariantImageMode;
  postId: string; // used to build the /api/linkedin/posts/:id/image src
  errorMessage?: string;
}

export function VariantImageSlot({
  mode,
  postId,
  errorMessage,
}: VariantImageSlotProps) {
  if (mode === 'idle') {
    return (
      <div className="aspect-video w-full rounded-md bg-slate-100 dark:bg-slate-900/50 flex items-center justify-center text-center">
        <div className="text-xs text-muted-foreground px-4">
          Image will generate when you select this variant
        </div>
      </div>
    );
  }
  if (mode === 'pending') {
    return <PendingImage />;
  }
  if (mode === 'error') {
    return (
      <div className="aspect-video w-full rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 flex flex-col items-center justify-center gap-2">
        <ImageOff className="size-6 text-red-600" />
        <p className="text-xs text-red-700 dark:text-red-300 px-4 text-center">
          {errorMessage ?? 'Image generation failed'}
        </p>
      </div>
    );
  }
  // 'ready'
  const token = localStorage.getItem('jwt') ?? '';
  const src = `/api/linkedin/posts/${encodeURIComponent(postId)}/image?token=${encodeURIComponent(token)}`;
  return (
    <img
      src={src}
      alt={`Generated image for post ${postId}`}
      className="aspect-video w-full rounded-md object-cover bg-slate-100 dark:bg-slate-800"
      loading="lazy"
    />
  );
}

function PendingImage() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="aspect-video w-full rounded-md bg-slate-100 dark:bg-slate-900/50 flex flex-col items-center justify-center gap-2">
      <Loader2 className="size-8 animate-spin text-blue-600" />
      <p className="text-sm font-medium">Generating image…</p>
      <p className="text-xs text-muted-foreground">{elapsed}s elapsed</p>
    </div>
  );
}
