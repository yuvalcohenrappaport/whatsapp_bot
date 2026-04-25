/**
 * PinDecisionPicker smoke tests (Phase 57 Plan 04).
 *
 * Covers all CONTEXT-locked behaviors:
 *   1. Pre-fills input with decisionTitle on mount
 *   2. Debounced (300ms) autocomplete fires with the right args
 *   3. Pick fires fetchPlacePreview AND disables Save until preview lands
 *   4. Save calls onSave with FULL optimistic payload (incl. real lat/lng) — D9
 *   5. onSave === false → 'Pin failed — try again' inline + picker stays open — D11
 *   6. onSave === true → 'Pinned' success then onCancel() after ~1s
 *   7. Retry button re-fires autocomplete via retryNonce
 *   8. Cancel button calls onCancel
 *   9. 'No matches' renders when autocomplete returns []
 *  10. Hebrew query threads languageCode='iw'
 *  11. Preview-fetch failure → 'Could not load place details — try another place'
 *      AND picked-preview row is gone AND onSave NOT called
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PinDecisionPicker } from '../PinDecisionPicker';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockAutocomplete = vi.fn();
const mockFetchPlacePreview = vi.fn();
vi.mock('@/api/trips', () => ({
  autocompletePlaces: (...args: unknown[]) => mockAutocomplete(...args),
  fetchPlacePreview: (...args: unknown[]) => mockFetchPlacePreview(...args),
}));

// crypto.randomUUID — deterministic so we can assert sessionToken value
const FIXED_UUID = 'test-uuid-1';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SUGGESTION_PIER = {
  placeId: 'p1',
  primaryText: 'Pier 39',
  secondaryText: 'San Francisco',
};

const PREVIEW_PIER = {
  placeId: 'p1',
  lat: 37.81,
  lng: -122.41,
  canonicalAddress: 'Pier 39, SF',
  metadata: {
    rating: 4.5,
    userRatingCount: 1234,
    openNow: true,
    types: ['tourist_attraction'],
    primaryType: 'tourist_attraction',
    displayName: 'Pier 39',
  },
};

// ─── Setup ──────────────────────────────────────────────────────────────────

const baseProps = {
  groupJid: 'group-1@g.us',
  decisionId: 'd-1',
  decisionTitle: 'Pier 39',
};

beforeEach(() => {
  vi.useFakeTimers();
  mockAutocomplete.mockReset();
  mockFetchPlacePreview.mockReset();
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(
    FIXED_UUID as `${string}-${string}-${string}-${string}-${string}`,
  );
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advance fake timers past the 300ms debounce + flush microtasks. */
async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  // Let any in-flight Promise.resolve() chains run.
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

/** Type a value into the picker's search input. */
function typeQuery(value: string) {
  const input = screen.getByPlaceholderText('Search a place…') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PinDecisionPicker', () => {
  // 1
  it('pre-fills input with decisionTitle on mount', () => {
    mockAutocomplete.mockResolvedValue([]);
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle="Café de Flore"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByPlaceholderText('Search a place…') as HTMLInputElement;
    expect(input.value).toBe('Café de Flore');
  });

  // 2
  it('debounced autocomplete fires after 300ms with sessionToken + en lang', async () => {
    mockAutocomplete.mockResolvedValue([]);
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    typeQuery('pari');
    expect(mockAutocomplete).not.toHaveBeenCalled(); // debounce not yet elapsed
    await flushDebounce();
    expect(mockAutocomplete).toHaveBeenCalledTimes(1);
    expect(mockAutocomplete).toHaveBeenCalledWith(
      'group-1@g.us',
      'pari',
      FIXED_UUID,
      'en',
    );
  });

  // 3
  it('clicking suggestion fires fetchPlacePreview and Save is disabled until preview lands', async () => {
    mockAutocomplete.mockResolvedValue([SUGGESTION_PIER]);
    // Make preview pending so we can observe the disabled state.
    let resolvePreview!: (v: typeof PREVIEW_PIER) => void;
    mockFetchPlacePreview.mockImplementation(
      () =>
        new Promise<typeof PREVIEW_PIER>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    typeQuery('pier');
    await flushDebounce();

    const suggestionBtn = screen.getByText('Pier 39');
    await act(async () => {
      fireEvent.click(suggestionBtn);
    });

    // fetchPlacePreview called with same sessionToken
    expect(mockFetchPlacePreview).toHaveBeenCalledTimes(1);
    expect(mockFetchPlacePreview).toHaveBeenCalledWith(
      'group-1@g.us',
      'p1',
      FIXED_UUID,
      'en',
    );

    // Save button rendered but DISABLED while preview is in flight
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText('Fetching place details…')).toBeInTheDocument();

    // Resolve preview, advance timers, Save should be enabled
    await act(async () => {
      resolvePreview(PREVIEW_PIER);
      await vi.runAllTimersAsync();
    });

    expect(saveBtn).not.toBeDisabled();
  });

  // 4 — D9 verification: optimistic carries REAL lat/lng before Save fires
  it('Save calls onSave with full optimistic payload incl. real lat/lng + sessionToken', async () => {
    mockAutocomplete.mockResolvedValue([SUGGESTION_PIER]);
    mockFetchPlacePreview.mockResolvedValue(PREVIEW_PIER);
    const onSave = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    typeQuery('pier');
    await flushDebounce();

    await act(async () => {
      fireEvent.click(screen.getByText('Pier 39'));
      await vi.runAllTimersAsync();
    });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      placeId: 'p1',
      sessionToken: FIXED_UUID,
      languageCode: 'en',
      optimistic: {
        placeId: 'p1',
        lat: 37.81,
        lng: -122.41,
        canonicalAddress: 'Pier 39, SF',
        primaryType: 'tourist_attraction',
        rating: 4.5,
        openNow: true,
        types: ['tourist_attraction'],
        displayName: 'Pier 39',
      },
    });
  });

  // 5 — D11 dual-surface: false → inline error AND picker stays open
  it('onSave returning false renders inline "Pin failed — try again" and keeps picker open', async () => {
    mockAutocomplete.mockResolvedValue([SUGGESTION_PIER]);
    mockFetchPlacePreview.mockResolvedValue(PREVIEW_PIER);
    const onSave = vi.fn().mockResolvedValue(false);
    const onCancel = vi.fn();
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    typeQuery('pier');
    await flushDebounce();

    await act(async () => {
      fireEvent.click(screen.getByText('Pier 39'));
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await vi.runAllTimersAsync();
    });

    expect(screen.getByText('Pin failed — try again')).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  // 6
  it('onSave returning true shows "Pinned" success then calls onCancel after ~1s', async () => {
    mockAutocomplete.mockResolvedValue([SUGGESTION_PIER]);
    mockFetchPlacePreview.mockResolvedValue(PREVIEW_PIER);
    const onSave = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    typeQuery('pier');
    await flushDebounce();

    await act(async () => {
      fireEvent.click(screen.getByText('Pier 39'));
      await vi.runAllTimersAsync();
    });
    // Click Save and let only the awaited promise chain settle (NOT all
    // pending timers — that would also fire the 1s onCancel timeout).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    // Flush microtasks (the awaited onSave promise) without advancing fake
    // timers past the 1s success timeout.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    // Now advance ~1.1s past the success timeout
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // 7 — Retry button uses retryNonce to re-fire autocomplete
  it('Retry button re-fires autocomplete after a search failure', async () => {
    mockAutocomplete
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        { placeId: 'p2', primaryText: 'X', secondaryText: 'Y' },
      ]);
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    typeQuery('foo');
    await flushDebounce();

    expect(screen.getByText('Search failed — retry')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(retryBtn);
    });
    await flushDebounce();

    expect(mockAutocomplete).toHaveBeenCalledTimes(2);
    // Second call uses the same query
    expect(mockAutocomplete.mock.calls[1][1]).toBe('foo');
    // New suggestion rendered
    expect(screen.getByText('X')).toBeInTheDocument();
  });

  // 8
  it('Cancel button calls onCancel', async () => {
    mockAutocomplete.mockResolvedValue([]);
    const onCancel = vi.fn();
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // 9
  it('renders "No matches" when autocomplete returns []', async () => {
    mockAutocomplete.mockResolvedValue([]);
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    typeQuery('xyz');
    await flushDebounce();
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  // 10 — Hebrew threading
  it('Hebrew query threads languageCode="iw"', async () => {
    mockAutocomplete.mockResolvedValue([]);
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    typeQuery('מסעדה');
    await flushDebounce();
    expect(mockAutocomplete).toHaveBeenCalledTimes(1);
    expect(mockAutocomplete.mock.calls[0][3]).toBe('iw');
  });

  // 11 — Preview fetch failure: error AND picked-preview cleared AND onSave NOT called
  it('preview fetch failure shows fallback error, clears picked row, does not call onSave', async () => {
    mockAutocomplete.mockResolvedValue([SUGGESTION_PIER]);
    mockFetchPlacePreview.mockRejectedValue(new Error('preview boom'));
    const onSave = vi.fn();
    render(
      <PinDecisionPicker
        {...baseProps}
        decisionTitle=""
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    typeQuery('pier');
    await flushDebounce();

    await act(async () => {
      fireEvent.click(screen.getByText('Pier 39'));
      await vi.runAllTimersAsync();
    });

    expect(
      screen.getByText('Could not load place details — try another place'),
    ).toBeInTheDocument();
    // Picked-preview row gone — no Save button visible
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    // No optimistic save fired
    expect(onSave).not.toHaveBeenCalled();
  });
});
