/**
 * OpenQuestions — list of unresolved open-question decisions.
 *
 * Props expect a pre-filtered list (already filtered to unresolved by the parent).
 * Resolve action calls onResolve(id), which triggers the useTrip mutation.
 * readOnly hides Resolve buttons.
 */
import type { TripDecision } from '@/api/tripSchemas';
import { Button } from '@/components/ui/button';

interface OpenQuestionsProps {
  questions: TripDecision[];
  onResolve: (id: string) => void;
  readOnly: boolean;
}

export function OpenQuestions({ questions, onResolve, readOnly }: OpenQuestionsProps) {
  return (
    <section id="open-questions" className="space-y-3">
      <h2 className="text-lg font-semibold">Open Questions</h2>

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open questions.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((q) => (
            <li
              key={q.id}
              className="flex items-start justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <p className="text-sm text-foreground leading-relaxed flex-1 min-w-0">
                {q.value}
              </p>
              {!readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onResolve(q.id)}
                  className="shrink-0"
                >
                  Resolve
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
