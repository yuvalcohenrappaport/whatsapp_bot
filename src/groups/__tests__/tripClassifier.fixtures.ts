/**
 * Phase 51-02: 10-fixture Hebrew dataset for the trip-classifier accuracy harness.
 *
 * Each fixture is a realistic-ish WhatsApp group chat snippet framed around an
 * Italy trip. The classifier (extended in 51-02) is expected to extract the
 * four new structured fields (category, cost_amount, cost_currency,
 * proposed_by) alongside the existing type/value/confidence triple.
 *
 * Match rules (enforced by the test harness):
 *   - type: exact
 *   - value: substring match (case-insensitive) on `valueIncludes`
 *   - category: exact (or both null)
 *   - costAmount: ±5% tolerance, or both null
 *   - costCurrency: exact ISO-4217, or both null
 *   - proposedByName: substring match (case-insensitive) on senderName; null=null
 */

export interface ExpectedDecision {
  type: 'destination' | 'accommodation' | 'activity' | 'transport' | 'dates' | 'budget';
  valueIncludes: string;
  category:
    | 'flights'
    | 'lodging'
    | 'food'
    | 'activities'
    | 'transit'
    | 'shopping'
    | 'other'
    | null;
  costAmount: number | null;
  costCurrency: string | null;
  proposedByName: string | null;
}

export interface FixtureMessage {
  id: string;
  senderJid: string;
  senderName: string;
  body: string;
  timestamp: number;
}

export interface Fixture {
  name: string;
  messages: FixtureMessage[];
  expected: ExpectedDecision[];
}

// Base timestamp used to build plausible per-message timestamps without
// colliding across fixtures.
const NOW = Date.UTC(2026, 3, 23, 10, 0, 0); // 2026-04-23T10:00:00Z
const MINUTE = 60_000;

function msg(
  fixIdx: number,
  msgIdx: number,
  senderName: string,
  body: string,
): FixtureMessage {
  return {
    id: `fx${fixIdx}-m${msgIdx}`,
    senderJid: `${senderName}@s.whatsapp.net`,
    senderName,
    body,
    timestamp: NOW + fixIdx * 10 * MINUTE + msgIdx * MINUTE,
  };
}

export const FIXTURES: Fixture[] = [
  {
    name: 'flight-booked-eur',
    messages: [msg(1, 0, 'יוסי', 'סגרנו טיסה ל-EasyJet 450 יורו לאדם')],
    expected: [
      {
        type: 'transport',
        valueIncludes: 'EasyJet',
        category: 'flights',
        costAmount: 450,
        costCurrency: 'EUR',
        proposedByName: 'יוסי',
      },
    ],
  },
  {
    name: 'hotel-reserved-trastevere',
    messages: [msg(2, 0, 'דני', 'הזמנתי את המלון ב-Trastevere 800 יורו ל-3 לילות')],
    expected: [
      {
        type: 'accommodation',
        valueIncludes: 'Trastevere',
        category: 'lodging',
        costAmount: 800,
        costCurrency: 'EUR',
        proposedByName: 'דני',
      },
    ],
  },
  {
    name: 'activity-no-price-colosseum',
    messages: [msg(3, 0, 'מאיה', 'החלטנו ללכת לקולוסיאום ביום הראשון')],
    expected: [
      {
        type: 'activity',
        valueIncludes: 'קולוסיאום',
        category: 'activities',
        costAmount: null,
        costCurrency: null,
        proposedByName: 'מאיה',
      },
    ],
  },
  {
    name: 'restaurant-roscioli',
    messages: [msg(4, 0, 'רותם', 'יש לי הזמנה ב-Roscioli למחר בערב 60 אירו לאדם')],
    expected: [
      {
        type: 'activity',
        valueIncludes: 'Roscioli',
        category: 'food',
        costAmount: 60,
        costCurrency: 'EUR',
        proposedByName: 'רותם',
      },
    ],
  },
  {
    name: 'transit-train-rome-florence',
    messages: [msg(5, 0, 'נעם', 'ניקח רכבת מרומא לפירנצה, 45 יורו')],
    expected: [
      {
        type: 'transport',
        valueIncludes: 'רכבת',
        category: 'transit',
        costAmount: 45,
        costCurrency: 'EUR',
        proposedByName: 'נעם',
      },
    ],
  },
  {
    name: 'shopping-florence-leather',
    messages: [msg(6, 0, 'טלי', 'אני הולכת לקנות עור ב-Florence, תקציב 200 יורו')],
    expected: [
      {
        type: 'activity',
        valueIncludes: 'עור',
        category: 'shopping',
        costAmount: 200,
        costCurrency: 'EUR',
        proposedByName: 'טלי',
      },
    ],
  },
  {
    name: 'proposer-resolution-multi-message-wizz',
    messages: [
      msg(7, 0, 'יוסי', 'אני מציע שנסגור Wizz'),
      msg(7, 1, 'דני', 'סגרנו'),
    ],
    expected: [
      {
        type: 'transport',
        valueIncludes: 'Wizz',
        category: 'flights',
        costAmount: null,
        costCurrency: null,
        proposedByName: 'יוסי',
      },
    ],
  },
  {
    name: 'usd-currency-restaurant',
    messages: [msg(8, 0, 'דני', 'הוספנו מסעדה ב-$80 לאיש')],
    expected: [
      {
        type: 'activity',
        valueIncludes: 'מסעדה',
        category: 'food',
        costAmount: 80,
        costCurrency: 'USD',
        proposedByName: 'דני',
      },
    ],
  },
  {
    name: 'destination-only-italy',
    messages: [msg(9, 0, 'מאיה', 'סגרנו — טסים לאיטליה')],
    expected: [
      {
        type: 'destination',
        valueIncludes: 'איטליה',
        category: null,
        costAmount: null,
        costCurrency: null,
        proposedByName: 'מאיה',
      },
    ],
  },
  {
    name: 'total-budget-eur',
    messages: [msg(10, 0, 'יוסי', 'תקציב כולל 5000 אירו')],
    expected: [
      {
        type: 'budget',
        valueIncludes: '5000',
        category: null,
        costAmount: 5000,
        costCurrency: 'EUR',
        proposedByName: 'יוסי',
      },
    ],
  },
];
