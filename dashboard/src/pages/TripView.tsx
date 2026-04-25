/**
 * TripView — polished trip detail page.
 *
 * Replaces the Plan 55-03 placeholder with the full CONTEXT-ordered layout:
 *   Header → Timeline → Map → DecisionsBoard → OpenQuestions → BudgetBar
 *
 * State lifted here:
 *   - filteredOrigins (Set<DecisionOrigin>) — shared between DecisionsBoard chip
 *     filter and TripMap visible markers. Defaults to all four origins active.
 *
 * Scroll-to-row: handleMarkerClick(id) scrolls #decision-{id} into view and
 * briefly applies a ring-2 ring-emerald-500 highlight for ~1500ms via DOM class toggle.
 */
import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTrip } from '@/hooks/useTrip';
import type { DecisionOrigin } from '@/api/tripSchemas';
import type { PinSaveInput } from '@/components/trip/PinDecisionPicker';

import { TripHeader } from '@/components/trip/TripHeader';
import { Timeline } from '@/components/trip/Timeline';
import { TripMap } from '@/components/trip/TripMap';
import { DecisionsBoard } from '@/components/trip/DecisionsBoard';
import { OpenQuestions } from '@/components/trip/OpenQuestions';
import { BudgetBar } from '@/components/trip/BudgetBar';
import { ExportButton } from '@/components/trip/ExportButton';
import { BackfillGeocodeButton } from '@/components/trip/BackfillGeocodeButton';

const ALL_ORIGINS: DecisionOrigin[] = ['multimodal', 'inferred', 'self_reported', 'dashboard'];

export default function TripView() {
  const { groupJid } = useParams<{ groupJid: string }>();
  const { bundle, isLoading, error, sseStatus, mutations } = useTrip(groupJid);

  // Chip filter state lifted here so both DecisionsBoard and TripMap share it
  const [filteredOrigins, setFilteredOrigins] = useState<Set<DecisionOrigin>>(
    new Set(ALL_ORIGINS),
  );

  // Active pin picker state — single-row-edit invariant. Lifted to TripView so
  // TripMap's badge click can also open a picker (badge → first un-geocoded row).
  const [activePinPickerId, setActivePinPickerId] = useState<string | null>(null);

  // ─── Scroll-to-decision-row ────────────────────────────────────────────────
  const handleMarkerClick = (decisionId: string) => {
    const el = document.getElementById(`decision-${decisionId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief ring highlight
    el.classList.add('ring-2', 'ring-emerald-500', 'rounded-md');
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-emerald-500', 'rounded-md');
    }, 1500);
  };

  // ─── Save handler — wraps useTrip.mutations.pinDecision ────────────────────
  // Plan 03 contract: mutations.pinDecision returns Promise<boolean>.
  //   true  → success (toast + canonical row replaced optimistic in the hook)
  //   false → failure (toast already fired in hook; picker shows inline error per D11)
  // Pass the boolean back unchanged so PinDecisionPicker can drive its own
  // inline 'Pin failed — try again' UI when ok===false.
  const handleSavePin = useCallback(
    async (decisionId: string, input: PinSaveInput): Promise<boolean> => {
      return mutations.pinDecision(decisionId, input.optimistic, {
        placeId: input.placeId,
        sessionToken: input.sessionToken,
        languageCode: input.languageCode,
      });
    },
    [mutations],
  );

  // ─── Badge click handler — scroll to first un-geocoded row + open picker ───
  const handleBadgeClick = useCallback(() => {
    if (!bundle) return;
    // First un-geocoded ACTIVE decision (CONTEXT-locked: badge click lands the
    // user on a specific row, never a decision-less picker).
    const target = bundle.decisions.find(
      (d) => d.status === 'active' && (d.lat == null || d.lng == null),
    );
    if (!target) return;
    setActivePinPickerId(target.id);
    // Defer scroll until the picker has mounted (1 tick).
    setTimeout(() => {
      const el = document.getElementById(`decision-${target.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, [bundle]);

  // ─── Loading / error states ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground animate-pulse">Loading trip…</div>
    );
  }

  if (error) {
    return <div className="p-6 text-destructive">Error: {error}</div>;
  }

  if (!bundle) {
    return <div className="p-6 text-muted-foreground">Trip not found.</div>;
  }

  // ─── Main layout ───────────────────────────────────────────────────────────

  return (
    <div>
      <TripHeader
        context={bundle.context}
        budget={bundle.budget}
        sseStatus={sseStatus}
        readOnly={bundle.readOnly}
      />

      <div className="container mx-auto px-6 pt-4 flex justify-end gap-2">
        <BackfillGeocodeButton groupJid={groupJid!} readOnly={bundle.readOnly} />
        <ExportButton groupJid={groupJid!} />
      </div>

      <main className="container mx-auto px-6 py-6 space-y-10">
        <Timeline events={bundle.calendarEvents} />

        <TripMap
          // Soft-deleted rows must NOT appear on the map (CONTEXT lock)
          decisions={bundle.decisions.filter((d) => d.status === 'active')}
          filteredOrigins={filteredOrigins}
          onMarkerClick={handleMarkerClick}
          // D13 lock — archived dashboards get the unchanged informational variant
          onBadgeClick={bundle.readOnly ? null : handleBadgeClick}
        />

        <DecisionsBoard
          groupJid={groupJid!}
          // Full list — board has its own Show-deleted toggle
          decisions={bundle.decisions}
          filteredOrigins={filteredOrigins}
          onFilteredOriginsChange={setFilteredOrigins}
          onDeleteDecision={mutations.deleteDecision}
          onRestoreDecision={mutations.restoreDecision}
          readOnly={bundle.readOnly}
          activePinPickerId={activePinPickerId}
          onOpenPicker={(id) => setActivePinPickerId(id)}
          onCancelPicker={() => setActivePinPickerId(null)}
          onSavePin={handleSavePin}
        />

        <OpenQuestions
          // Parent filters to unresolved before passing (resolved ones drop off optimistically)
          questions={bundle.openQuestions.filter((q) => !q.resolved)}
          onResolve={mutations.resolveQuestion}
          readOnly={bundle.readOnly}
        />

        <BudgetBar
          budget={bundle.budget}
          onUpdateBudget={mutations.updateBudget}
          readOnly={bundle.readOnly}
        />
      </main>
    </div>
  );
}
