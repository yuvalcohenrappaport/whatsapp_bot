/**
 * One lesson candidate card. Plan 37-02 Task 2.
 *
 * Layout: full-width card with:
 *   - Letter tag (A / B / C / D) in a round badge, top-left
 *   - Lesson text (bold, leading-relaxed)
 *   - Rationale (text-muted-foreground, smaller)
 *   - GenerationMetadata strip at the bottom
 *
 * Click toggles focus. Focused state: ring-2 ring-blue-500 + bg-blue-50.
 * Freely switchable — there is no destructive action. A sticky
 * StickyConfirmBar at the page level commits the choice.
 *
 * Replaces the Plan 37-01 stub body.
 */
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { GenerationMetadata } from './GenerationMetadata';
import type { DashboardLessonCandidate } from '@/api/linkedinSchemas';

export interface LessonCandidateCardProps {
  candidate: DashboardLessonCandidate;
  letter: 'A' | 'B' | 'C' | 'D';
  focused: boolean;
  onFocus: () => void;
}

export function LessonCandidateCard({
  candidate,
  letter,
  focused,
  onFocus,
}: LessonCandidateCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`Lesson candidate ${letter}`}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus();
        }
      }}
      className={cn(
        'p-5 cursor-pointer transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        focused && 'ring-2 ring-blue-500 bg-blue-50/60 dark:bg-blue-950/30',
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'shrink-0 size-9 rounded-full flex items-center justify-center font-semibold',
            focused
              ? 'bg-blue-500 text-white'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
          )}
          aria-hidden="true"
        >
          {letter}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">
            {candidate.lesson_text}
          </p>
          <p className="text-sm text-muted-foreground leading-snug whitespace-pre-wrap">
            {candidate.rationale}
          </p>
          <GenerationMetadata createdAt={candidate.created_at} />
        </div>
      </div>
    </Card>
  );
}
