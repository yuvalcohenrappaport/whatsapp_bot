/**
 * One variant card for the variant-finalization page.
 *
 * Layout: full-width card containing:
 *   - Header row: variant.kind label (lesson_story | lesson_claim) + focus tick
 *   - VariantImageSlot (aspect-video)
 *   - Bilingual content: Hebrew on top (dir=rtl, if content_he present), English below
 *   - Collapsible "Show image prompt" details block (closed by default)
 *   - GenerationMetadata strip
 *
 * CONTEXT §Area 2: 2 columns on desktop, stacked on mobile. Parent grid handles responsive.
 *
 * NOTE: post.content_he is post-level (both variants share it). Variants only differ
 * in the English content. This is the pm-authority reality — see Plan 37-03
 * research_facts #3. If the owner wants per-variant Hebrew, it requires a pm-authority
 * schema change and is out of scope.
 *
 * Plan: 37-03.
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GenerationMetadata } from './GenerationMetadata';
import { VariantImageSlot, type VariantImageMode } from './VariantImageSlot';
import type { DashboardVariant, DashboardPost } from '@/api/linkedinSchemas';

export interface VariantCardProps {
  variant: DashboardVariant;
  post: DashboardPost; // needed to know the post id + he content + image state
  focused: boolean;
  onFocus: () => void;
  imageMode: VariantImageMode;
}

export function VariantCard({
  variant,
  post,
  focused,
  onFocus,
  imageMode,
}: VariantCardProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus();
        }
      }}
      className={cn(
        'p-5 cursor-pointer transition-all hover:shadow-md flex flex-col gap-4',
        focused && 'ring-2 ring-blue-500 bg-blue-50/60 dark:bg-blue-950/30',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge variant="outline" className="font-mono text-xs">
          {variant.kind}
        </Badge>
        {focused && (
          <span className="text-xs font-medium text-blue-600">Selected</span>
        )}
      </div>

      <VariantImageSlot mode={imageMode} postId={post.id} />

      <div className="space-y-3 text-sm leading-relaxed">
        {post.content_he && (
          <p dir="rtl" lang="he" className="whitespace-pre-wrap">
            {post.content_he}
          </p>
        )}
        <p dir="ltr" lang="en" className="whitespace-pre-wrap">
          {variant.content}
        </p>
      </div>

      <details
        open={promptOpen}
        onClick={(e) => {
          // prevent card onClick from firing when the user toggles the details
          e.stopPropagation();
        }}
        onToggle={(e) => {
          setPromptOpen((e.target as HTMLDetailsElement).open);
        }}
        className="mt-auto"
      >
        <summary className="text-xs uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground">
          {promptOpen ? 'Hide' : 'Show'} image prompt
        </summary>
        <div className="mt-2 text-xs p-3 rounded bg-slate-50 dark:bg-slate-900/50 whitespace-pre-wrap">
          {variant.image_prompt ?? '(no image prompt)'}
        </div>
      </details>

      <GenerationMetadata createdAt={variant.created_at} />
    </Card>
  );
}
