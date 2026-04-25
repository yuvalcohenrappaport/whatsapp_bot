/**
 * PinDecisionPicker — inline drop-a-pin picker for a single trip decision.
 *
 * Self-contained leaf component. Renders inline (NOT a Radix Dialog), pre-fills
 * the input with the decision title, debounces autocomplete keystrokes, and
 * uses a two-step Pick → Save flow. Between Pick and Save it fires
 * `fetchPlacePreview` so the optimistic payload at Save time carries REAL
 * lat/lng/canonicalAddress/metadata (CONTEXT D9 — off-map badge must
 * decrement in the same React tick as the map pin appears).
 *
 * Phase 57 — Plan 04.
 *
 * Contract:
 *   <PinDecisionPicker
 *     groupJid={trip.groupJid}
 *     decisionId={decision.id}
 *     decisionTitle={decision.value}
 *     onSave={(input) => mutations.pinDecision(decision.id, input.optimistic, {
 *                          placeId: input.placeId,
 *                          sessionToken: input.sessionToken,
 *                          languageCode: input.languageCode,
 *                        })}
 *     onCancel={() => setEditingDecisionId(null)}
 *   />
 *
 * `onSave` returns Promise<boolean> (Plan 03 contract): true → ~1s success
 * state then onCancel(); false → inline 'Pin failed — try again' AND picker
 * stays open (CONTEXT D11 dual-surface — useTrip already fired the toast).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MapPin, Loader2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { autocompletePlaces, fetchPlacePreview } from '@/api/trips';
import type {
  AutocompleteSuggestion,
  PinOptimisticInput,
  PlacePreview,
} from '@/api/tripSchemas';

// ─── Public types ────────────────────────────────────────────────────────────

export interface PinSaveInput {
  placeId: string;
  sessionToken: string;
  languageCode?: 'iw' | 'en';
  optimistic: PinOptimisticInput; // FULL payload from fetchPlacePreview (D9)
}

export interface PinDecisionPickerProps {
  groupJid: string;
  decisionId: string;
  /** Pre-fills the input on mount (saves typing for the common case). */
  decisionTitle: string;
  /** Returns true on success, false on failure (D11 dual-surface). */
  onSave: (input: PinSaveInput) => Promise<boolean>;
  onCancel: () => void;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

// Mirrors the server-side detection module — Hebrew query → languageCode='iw'.
const HEBREW_REGEX = /[֐-׿]/;
const detectLanguageCode = (q: string): 'iw' | 'en' =>
  HEBREW_REGEX.test(q) ? 'iw' : 'en';

// CONTEXT.md grants debounce duration as Claude's discretion → 300ms.
const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const SUCCESS_DURATION_MS = 1000;

// Possible inline error messages.
type PickerError =
  | 'No matches'
  | 'Search failed — retry'
  | 'Could not load place details — try another place'
  | 'Pin failed — try again'
  | null;

// ─── Component ───────────────────────────────────────────────────────────────

export function PinDecisionPicker({
  groupJid,
  // decisionId is part of the public prop contract but the picker itself
  // doesn't use it — Plan 05's wiring closes over decisionId in the onSave
  // callback. Keeping it in the props so consumers can't accidentally wire
  // a callback to the wrong row.
  decisionId: _decisionId,
  decisionTitle,
  onSave,
  onCancel,
}: PinDecisionPickerProps) {
  // ─── State ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState(decisionTitle);
  const [retryNonce, setRetryNonce] = useState(0);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PickerError>(null);
  const [picked, setPicked] = useState<AutocompleteSuggestion | null>(null);
  const [preview, setPreview] = useState<PlacePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // ─── Refs ──────────────────────────────────────────────────────────────
  // Single sessionToken per picker open — reused for autocomplete + preview
  // + final pin. Phase 56 RESEARCH.md billing lock.
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  // Race protection — last-write-wins for both autocomplete and preview.
  const reqIdRef = useRef(0);
  const previewReqIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Debounced autocomplete effect ─────────────────────────────────────
  // Re-fires on query OR retryNonce change. The retryNonce dep is what makes
  // the "Retry" button work after a search failure — clicking it bumps the
  // nonce, the effect re-runs with the same query.
  useEffect(() => {
    // Skip when a pick is being previewed (we're past the search step).
    if (picked !== null) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setError(null);
      return;
    }
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const lang = detectLanguageCode(trimmed);
        const result = await autocompletePlaces(
          groupJid,
          trimmed,
          sessionTokenRef.current,
          lang,
        );
        if (reqIdRef.current !== myReqId) return; // raced — newer request in flight
        setSuggestions(result);
        setError(result.length === 0 ? 'No matches' : null);
      } catch {
        if (reqIdRef.current !== myReqId) return;
        setError('Search failed — retry');
        setSuggestions([]);
      } finally {
        if (reqIdRef.current === myReqId) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, groupJid, picked, retryNonce]);

  // ─── Autofocus + Escape handler ────────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select(); // pre-fill is selected so first keystroke replaces title
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // ─── Pick a suggestion (fires preview fetch — does NOT save yet) ──────
  const handlePick = useCallback(
    async (s: AutocompleteSuggestion) => {
      setPicked(s);
      setError(null);
      setPreview(null);
      setPreviewing(true);
      const myReqId = ++previewReqIdRef.current;
      try {
        const lang = detectLanguageCode(query);
        const result = await fetchPlacePreview(
          groupJid,
          s.placeId,
          sessionTokenRef.current,
          lang,
        );
        if (previewReqIdRef.current !== myReqId) return; // raced
        setPreview(result);
      } catch {
        if (previewReqIdRef.current !== myReqId) return;
        // D9 fallback: without a preview we can't optimistically decrement
        // the badge, so refuse to enable Save. Pop the user back to the
        // suggestion list with an inline error.
        setError('Could not load place details — try another place');
        setPicked(null);
      } finally {
        if (previewReqIdRef.current === myReqId) setPreviewing(false);
      }
    },
    [groupJid, query],
  );

  // ─── Save (explicit user confirmation, requires preview) ──────────────
  const handleSave = useCallback(async () => {
    if (!picked || !preview || saving || previewing) return;
    setSaving(true);
    setError(null);

    // Build the FULL optimistic payload from the preview fetch (D9 lock).
    // Real lat/lng → TripMap re-renders pin position AND offMapCount
    // decrements in the SAME React tick (TripMap formula:
    // `(d.lat == null || d.lng == null)`).
    const optimistic: PinOptimisticInput = {
      placeId: preview.placeId,
      canonicalAddress: preview.canonicalAddress,
      lat: preview.lat,
      lng: preview.lng,
      primaryType: preview.metadata.primaryType,
      rating: preview.metadata.rating,
      openNow: preview.metadata.openNow,
      types: preview.metadata.types,
      displayName: preview.metadata.displayName,
    };

    // onSave returns Promise<boolean> per Plan 03's contract.
    const ok = await onSave({
      placeId: picked.placeId,
      sessionToken: sessionTokenRef.current,
      languageCode: detectLanguageCode(query),
      optimistic,
    });

    if (ok) {
      setSavedSuccess(true);
      // Brief success state (~1s), then unmount via parent's onCancel.
      setTimeout(() => onCancel(), SUCCESS_DURATION_MS);
    } else {
      // CONTEXT D11 dual-surface: useTrip already fired the toast.
      // Picker shows the inline error AND stays open so the user can retry.
      setError('Pin failed — try again');
    }

    setSaving(false);
  }, [picked, preview, saving, previewing, onSave, onCancel, query]);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2 shadow-sm">
      {/* Header / input row */}
      <div className="flex items-center gap-2">
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Re-typing after a pick clears the preview row + preview state.
            if (picked) {
              setPicked(null);
              setPreview(null);
            }
            setSavedSuccess(false);
          }}
          placeholder="Search a place…"
          disabled={saving || savedSuccess}
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          title="Cancel"
          disabled={saving}
        >
          <X size={14} />
        </Button>
      </div>

      {/* Saved success state */}
      {savedSuccess && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Check size={14} />
          Pinned
        </div>
      )}

      {/* Picked-preview row + Save button. The picked-preview confirmation
          row is a single-item confirmation surface (NOT a list per CONTEXT
          D5), so a MapPin glyph here is appropriate. */}
      {picked && !savedSuccess && (
        <div className="flex items-center gap-2 rounded-md border bg-accent/30 px-2 py-1.5">
          <MapPin size={14} className="shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{picked.primaryText}</p>
            {picked.secondaryText && (
              <p className="text-xs text-muted-foreground truncate">{picked.secondaryText}</p>
            )}
            {previewing && (
              <p className="text-xs text-muted-foreground italic mt-0.5">
                Fetching place details…
              </p>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || previewing || !preview}
            className="shrink-0"
            title={
              previewing
                ? 'Loading place details…'
                : !preview
                  ? 'Place details not loaded'
                  : 'Save pin'
            }
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}

      {/* Suggestions list — only when not in preview/success mode.
          Plain text per CONTEXT D5 (no glyphs in list rows). */}
      {!picked && !savedSuccess && (
        <div className="space-y-1">
          {error && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground italic flex items-center gap-2">
              <span>{error}</span>
              {error === 'Search failed — retry' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setRetryNonce((n) => n + 1)}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              onClick={() => void handlePick(s)}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/60 transition-colors"
            >
              <p className="text-sm leading-snug truncate">{s.primaryText}</p>
              {s.secondaryText && (
                <p className="text-xs text-muted-foreground leading-snug truncate">
                  {s.secondaryText}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Inline error after a failed Save (D11 dual-surface) */}
      {error === 'Pin failed — try again' && picked && (
        <div className="text-xs text-destructive italic px-2 py-1">{error}</div>
      )}
    </div>
  );
}
