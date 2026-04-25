/**
 * /trips/:groupJid — placeholder trip detail view.
 *
 * Plan 55-03: proves the data layer (useTrip) end-to-end.
 * Plan 55-04 replaces this with the full TripHeader / Timeline / Map /
 * DecisionsBoard / OpenQuestions / BudgetBar layout.
 *
 * Shows SSE status transition (idle → connecting → open) so we can verify
 * the data layer works before the polished UI lands.
 */
import { useParams } from 'react-router-dom';
import { useTrip } from '@/hooks/useTrip';

export default function TripView() {
  const { groupJid } = useParams<{ groupJid: string }>();
  const { bundle, isLoading, error, sseStatus } = useTrip(groupJid);

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground animate-pulse">
        Loading trip&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-destructive">
        Error: {error}
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="p-6 text-muted-foreground">
        Trip not found.
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Title row */}
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold text-foreground">
          {bundle.context?.destination ?? '(unnamed trip)'}
        </h1>
        {bundle.readOnly && (
          <span className="text-sm text-muted-foreground">
            [archived — read only]
          </span>
        )}
      </div>

      {/* Live status indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            sseStatus === 'open'
              ? 'bg-emerald-500'
              : sseStatus === 'reconnecting'
                ? 'bg-amber-500 animate-pulse'
                : 'bg-muted'
          }`}
        />
        <span>SSE: {sseStatus}</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{bundle.decisions.length} decisions</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{bundle.openQuestions.length} open questions</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{bundle.calendarEvents.length} events</span>
      </div>

      {/* Raw bundle dump — placeholder only, removed in Plan 55-04 */}
      <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-[60vh]">
        {JSON.stringify({ context: bundle.context, budget: bundle.budget }, null, 2)}
      </pre>
    </div>
  );
}
