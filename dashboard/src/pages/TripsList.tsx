/**
 * /trips — navigable list of all trip groups.
 *
 * Fetches GET /api/trips on mount, parses with TripsListResponseSchema.
 * Sort order comes from the backend (upcoming → past → archived); no FE re-sort.
 * Archived rows render with a muted badge and reduced opacity.
 *
 * Each card navigates to /trips/:groupJid on click.
 *
 * Plan 55-03.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/api/client';
import {
  TripsListResponseSchema,
  type TripListEntry,
} from '@/api/tripSchemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateRange(
  startDate: string | null,
  endDate: string | null,
): string {
  if (!startDate && !endDate) return '';
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  if (startDate) return `from ${startDate}`;
  return `until ${endDate!}`;
}

// ─── TripCard ─────────────────────────────────────────────────────────────────

function TripCard({ trip, onClick }: { trip: TripListEntry; onClick: () => void }) {
  const isArchived = trip.status === 'archived';
  const dateRange = formatDateRange(trip.startDate, trip.endDate);

  return (
    <div
      onClick={onClick}
      className={`
        group cursor-pointer rounded-xl border bg-card p-5 shadow-sm transition-all
        hover:border-primary/40 hover:shadow-md
        ${isArchived ? 'opacity-60' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-snug text-card-foreground group-hover:text-primary transition-colors">
            {trip.destination ?? (
              <span className="text-muted-foreground italic">(no destination yet)</span>
            )}
          </h3>
          {dateRange && (
            <p className="mt-0.5 text-sm text-muted-foreground">{dateRange}</p>
          )}
          <p className="mt-1 text-xs font-mono text-muted-foreground/60 truncate">
            {trip.groupJid}
          </p>
        </div>
        <span
          className={`
            shrink-0 mt-0.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
            ${isArchived
              ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
            }
          `}
        >
          {trip.status}
        </span>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function TripCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-2/3 opacity-50" />
        </div>
        <div className="h-5 w-14 bg-muted rounded-full" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TripsList() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<unknown>('/api/trips')
      .then((json) => {
        if (cancelled) return;
        const result = TripsListResponseSchema.safeParse(json);
        if (result.success) {
          setTrips(result.data.trips);
        } else {
          console.error('[TripsList] schema drift:', result.error.issues);
          setError('Unexpected response shape from server');
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Trips</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trip groups detected by the bot — click to view decisions, timeline, map, and budget.
        </p>
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <TripCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">
          Could not load trips: {error}
        </div>
      )}

      {!isLoading && !error && trips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground max-w-sm">
            No trips yet. The bot creates trip contexts when a group&apos;s messages
            start mentioning a destination.
          </p>
        </div>
      )}

      {!isLoading && !error && trips.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <TripCard
              key={trip.groupJid}
              trip={trip}
              onClick={() => navigate(`/trips/${encodeURIComponent(trip.groupJid)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
