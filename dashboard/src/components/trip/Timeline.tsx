/**
 * Timeline — chronological list of calendar events.
 *
 * - Sorted ASC by eventDate (unix ms)
 * - Today's events highlighted with emerald ring + bold text
 * - Date format: "Mon, May 12 · 14:00" in Asia/Jerusalem timezone (via ist.ts pattern)
 * - Empty state: muted "No confirmed events yet"
 */
import type { CalendarEventInTrip } from '@/api/tripSchemas';
import { cn } from '@/lib/utils';

interface TimelineProps {
  events: CalendarEventInTrip[];
}

const IST_TZ = 'Asia/Jerusalem';

function formatEventDate(ms: number): string {
  const d = new Date(ms);
  const weekday = d.toLocaleDateString('en-US', { timeZone: IST_TZ, weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { timeZone: IST_TZ, month: 'short' });
  const day = d.toLocaleDateString('en-US', { timeZone: IST_TZ, day: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${weekday}, ${month} ${day} · ${time}`;
}

function getIstDateString(ms: number): string {
  // Returns YYYY-MM-DD in Asia/Jerusalem
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: IST_TZ }); // en-CA gives YYYY-MM-DD
}

export function Timeline({ events }: TimelineProps) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: IST_TZ });

  const sorted = [...events].sort((a, b) => a.eventDate - b.eventDate);

  return (
    <section id="timeline" className="space-y-3">
      <h2 className="text-lg font-semibold">Timeline</h2>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No confirmed events yet.</p>
      ) : (
        <ol className="relative space-y-0">
          {sorted.map((event, idx) => {
            const isToday = getIstDateString(event.eventDate) === todayStr;
            const isLast = idx === sorted.length - 1;

            return (
              <li key={event.id} className="flex gap-4">
                {/* Left rail */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'mt-1 h-3 w-3 rounded-full border-2 shrink-0',
                      isToday
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-muted-foreground bg-background',
                    )}
                  />
                  {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-1 min-h-[16px]" />}
                </div>

                {/* Content */}
                <div
                  className={cn(
                    'pb-4 min-w-0',
                    isToday && 'ring-2 ring-emerald-500 rounded-md px-3 py-2 -mx-3',
                  )}
                >
                  <p
                    className={cn(
                      'text-xs text-muted-foreground',
                      isToday && 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {formatEventDate(event.eventDate)}
                  </p>
                  <p
                    className={cn(
                      'text-sm text-foreground mt-0.5',
                      isToday && 'font-semibold',
                    )}
                  >
                    {event.title}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
