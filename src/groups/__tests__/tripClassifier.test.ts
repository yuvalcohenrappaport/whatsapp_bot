/**
 * Phase 51-02: Trip classifier accuracy harness + persistence wiring tests.
 *
 * Two suites:
 *   1. Accuracy (real Gemini, gated on GEMINI_API_KEY): runs all 10 Hebrew
 *      fixtures through `classifyBatch` and asserts ≥0.8 fixtures match every
 *      new structured field (type, value substring, category, cost_amount ±5%,
 *      cost_currency, proposed_by).
 *   2. Persistence (mocked Gemini): asserts processTripContext forwards the
 *      new fields to insertTripDecision with origin='inferred'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FIXTURES } from './tripClassifier.fixtures.js';

// NOTE: `classifyBatch` and `processTripContext` exports ship in Task 2 (GREEN).
// This RED-time import deliberately references symbols that do not exist yet;
// both suites will fail to compile/run until the classifier is extended.
import {
  TripClassifierSchema,
  classifyBatch,
  processTripContext,
} from '../tripContextManager.js';
import * as tripMemory from '../../db/queries/tripMemory.js';

describe('TripClassifierSchema', () => {
  it('accepts the extended shape with proposed_by / category / cost_amount / cost_currency', () => {
    const ok = TripClassifierSchema.safeParse({
      decisions: [
        {
          type: 'transport',
          value: 'EasyJet 450 EUR',
          confidence: 'high',
          category: 'flights',
          cost_amount: 450,
          cost_currency: 'EUR',
          proposed_by: 'יוסי',
        },
      ],
      openItems: [],
      resolvedQuestions: [],
      contextSummary: 'טיול איטליה',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts nulls for all new fields (orthogonal decisions)', () => {
    const ok = TripClassifierSchema.safeParse({
      decisions: [
        {
          type: 'destination',
          value: 'איטליה',
          confidence: 'high',
          category: null,
          cost_amount: null,
          cost_currency: null,
          proposed_by: null,
        },
      ],
      openItems: [],
      resolvedQuestions: [],
      contextSummary: null,
    });
    expect(ok.success).toBe(true);
  });
});

describe('tripClassifier accuracy (real Gemini)', () => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);

  it.skipIf(!hasKey)(
    'hits ≥0.8 accuracy on 10 Hebrew fixtures',
    async () => {
      let passed = 0;
      const failures: Array<{ name: string; reason: string }> = [];

      for (const f of FIXTURES) {
        const result = await classifyBatch(f.messages);
        if (!result) {
          failures.push({ name: f.name, reason: 'classifier returned null' });
          continue;
        }

        const allMatch = f.expected.every((exp) => {
          const hit = result.decisions.find(
            (d) =>
              d.type === exp.type &&
              d.value.toLowerCase().includes(exp.valueIncludes.toLowerCase()),
          );
          if (!hit) return false;
          if (hit.category !== exp.category) return false;
          if (exp.costAmount == null) {
            if (hit.cost_amount != null) return false;
          } else if (
            hit.cost_amount == null ||
            Math.abs(hit.cost_amount - exp.costAmount) / exp.costAmount > 0.05
          ) {
            return false;
          }
          if (hit.cost_currency !== exp.costCurrency) return false;
          if (exp.proposedByName == null) {
            if (hit.proposed_by != null) return false;
          } else if (
            !hit.proposed_by?.toLowerCase().includes(exp.proposedByName.toLowerCase())
          ) {
            return false;
          }
          return true;
        });

        if (allMatch) {
          passed++;
        } else {
          failures.push({
            name: f.name,
            reason: JSON.stringify(result.decisions),
          });
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[tripClassifier] accuracy ${passed}/${FIXTURES.length}. Failed: ${failures
          .map((f) => f.name)
          .join(', ')}`,
      );
      for (const f of failures) {
        // eslint-disable-next-line no-console
        console.log(`  - ${f.name}: ${f.reason}`);
      }

      expect(passed / FIXTURES.length).toBeGreaterThanOrEqual(0.8);
    },
    120_000,
  );
});

// Mock Gemini BEFORE importing processTripContext consumers (vi.mock is hoisted).
vi.mock('../../ai/provider.js', () => ({
  generateJson: vi.fn(),
  generateText: vi.fn().mockResolvedValue(null),
}));

describe('persistence (mocked Gemini)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls insertTripDecision with proposedBy, category, costAmount, costCurrency, origin=inferred', async () => {
    const { generateJson } = await import('../../ai/provider.js');
    (generateJson as ReturnType<typeof vi.fn>).mockResolvedValue({
      decisions: [
        {
          type: 'transport',
          value: 'EasyJet 450 EUR',
          confidence: 'high',
          category: 'flights',
          cost_amount: 450,
          cost_currency: 'EUR',
          proposed_by: 'יוסי',
        },
      ],
      openItems: [],
      resolvedQuestions: [],
      contextSummary: 'טיול איטליה',
    });

    const insertSpy = vi
      .spyOn(tripMemory, 'insertTripDecision')
      .mockImplementation(() => undefined as unknown as ReturnType<typeof tripMemory.insertTripDecision>);
    vi.spyOn(tripMemory, 'getTripContext').mockReturnValue(
      undefined as unknown as ReturnType<typeof tripMemory.getTripContext>,
    );
    vi.spyOn(tripMemory, 'getDecisionsByGroup').mockReturnValue([]);
    vi.spyOn(tripMemory, 'getUnresolvedOpenItems').mockReturnValue([]);
    vi.spyOn(tripMemory, 'upsertTripContext').mockImplementation(
      () => undefined as unknown as ReturnType<typeof tripMemory.upsertTripContext>,
    );

    // First fixture: יוסי's EasyJet message.
    const f = FIXTURES[0];
    const groupJid = 'fixtures-flight@g.us';
    await processTripContext(groupJid, f.messages);

    expect(insertSpy).toHaveBeenCalled();
    const call = insertSpy.mock.calls.find(
      (c) => c[0].type === 'transport',
    );
    expect(call, 'expected a transport decision to be inserted').toBeDefined();
    const args = call![0];
    expect(args.origin).toBe('inferred');
    expect(args.category).toBe('flights');
    expect(args.costAmount).toBe(450);
    expect(args.costCurrency).toBe('EUR');
    // resolveProposerJid maps `יוסי` → the message senderJid (there is exactly
    // one matching message in this fixture).
    expect(args.proposedBy).toBe('יוסי@s.whatsapp.net');
  });
});
