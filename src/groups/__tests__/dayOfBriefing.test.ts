import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock ALL external dependencies BEFORE importing the module under test ────
// dayOfBriefing imports: config, api/state (sock), calendar/calendarService,
// integrations/openWeather, integrations/geminiGroundedSearch, db/queries/
// tripMemory, and ai/provider. All are mocked so tests stay offline and
// deterministic.

vi.mock('../../config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    GEMINI_API_KEY: 'fake',
    GEMINI_MODEL: 'gemini-2.5-flash',
    OPENWEATHER_API_KEY: 'fake-ow',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../integrations/openWeather.js', () => ({
  resolveCoords: vi.fn(),
  getDestinationForecast: vi.fn(),
}));

vi.mock('../../integrations/geminiGroundedSearch.js', () => ({
  transitAlerts: vi.fn(),
}));

vi.mock('../../calendar/calendarService.js', () => ({
  listUpcomingEvents: vi.fn(),
}));

vi.mock('../../db/queries/tripMemory.js', () => ({
  getUnresolvedOpenItems: vi.fn().mockReturnValue([]),
  getBudgetRollup: vi
    .fn()
    .mockReturnValue({ targets: {}, spent: {}, remaining: {} }),
  getDecisionsByGroup: vi.fn().mockReturnValue([]),
  getTripContext: vi.fn().mockReturnValue(null),
  upsertTripContext: vi.fn(),
}));

vi.mock('../../ai/provider.js', () => ({
  generateText: vi.fn(),
}));

// NOTE: vi.mock factories are hoisted — we cannot reference a top-level const
// from inside them. Instead, create the sendMessage mock inside the factory
// and read it back via `vi.mocked(state.getState)().sock.sendMessage` in the
// tests. Using `vi.hoisted` is the blessed way to share a handle.
const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../api/state.js', () => ({
  getState: vi.fn().mockReturnValue({ sock: { sendMessage: sendMessageMock } }),
}));

import * as ow from '../../integrations/openWeather.js';
import * as gs from '../../integrations/geminiGroundedSearch.js';
import * as cal from '../../calendar/calendarService.js';
import * as tm from '../../db/queries/tripMemory.js';
import * as ai from '../../ai/provider.js';
import * as state from '../../api/state.js';

const { runDayOfBriefing } = await import('../dayOfBriefing.js');

const GROUP = '120363111111@g.us';
const INPUT = {
  groupJid: GROUP,
  destination: 'Rome',
  calendarId: 'test-calendar-id',
  destTz: 'Europe/Rome',
  todayIso: '2026-05-10',
  coords: { lat: 41.9, lon: 12.5 },
  openWeatherApiKey: 'fake-ow',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore the default getState return — some tests override it and
  // vi.clearAllMocks() wipes the default mockReturnValue.
  vi.mocked(state.getState).mockReturnValue({
    sock: { sendMessage: sendMessageMock } as unknown as NonNullable<
      ReturnType<typeof state.getState>['sock']
    >,
    connection: 'connected',
    qr: null,
    botJid: null,
    botDisplayName: null,
    isShuttingDown: false,
  });
  // Re-establish default stubs that vi.clearAllMocks() wiped.
  vi.mocked(tm.getUnresolvedOpenItems).mockReturnValue([]);
  vi.mocked(tm.getBudgetRollup).mockReturnValue({
    targets: {
      flights: 0,
      lodging: 0,
      food: 0,
      activities: 0,
      transit: 0,
      shopping: 0,
      other: 0,
    },
    spent: {
      flights: 0,
      lodging: 0,
      food: 0,
      activities: 0,
      transit: 0,
      shopping: 0,
      other: 0,
    },
    remaining: {
      flights: 0,
      lodging: 0,
      food: 0,
      activities: 0,
      transit: 0,
      shopping: 0,
      other: 0,
    },
  });
  vi.mocked(tm.getDecisionsByGroup).mockReturnValue([]);
  vi.mocked(tm.getTripContext).mockReturnValue(null);
});

describe('runDayOfBriefing', () => {
  it('happy path: posts Gemini-composed message to group', async () => {
    vi.mocked(cal.listUpcomingEvents).mockResolvedValue([
      { title: 'Vatican Tour', date: '2026-05-10T09:00:00+02:00' },
    ]);
    vi.mocked(ow.getDestinationForecast).mockResolvedValue([
      { dt: 1746860400, temp: 22, description: 'sunny', icon: '01d' },
    ]);
    vi.mocked(gs.transitAlerts).mockResolvedValue('normal');
    vi.mocked(ai.generateText).mockResolvedValue(
      '🌅 בוקר טוב! היום יש סיור בוותיקן בשעה 09:00...',
    );

    await runDayOfBriefing(INPUT);

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [jidArg, payload] = sendMessageMock.mock.calls[0] as [
      string,
      { text: string },
    ];
    expect(jidArg).toBe(GROUP);
    expect(payload.text).toContain('בוקר טוב');
    expect(vi.mocked(ai.generateText)).toHaveBeenCalledTimes(1);
  });

  it('fallback: calendar throws → posts no-events fallback, does not call Gemini composition', async () => {
    vi.mocked(cal.listUpcomingEvents).mockRejectedValue(new Error('Calendar 500'));
    vi.mocked(gs.transitAlerts).mockResolvedValue('normal');

    await runDayOfBriefing(INPUT);

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const payload = sendMessageMock.mock.calls[0][1] as { text: string };
    // Calendar failed → calendarEvents stays [] → empty-fallback template.
    expect(payload.text).toBe('🌅 בוקר טוב! אין אירועים ביומן להיום.');
    // Gemini composition must NOT be called when fallback is forced.
    expect(vi.mocked(ai.generateText)).not.toHaveBeenCalled();
  });

  it('fallback: calendar succeeds but Gemini composition throws → posts fallback with event list', async () => {
    vi.mocked(cal.listUpcomingEvents).mockResolvedValue([
      { title: 'Colosseum', date: '2026-05-10T14:00:00+02:00' },
    ]);
    vi.mocked(gs.transitAlerts).mockResolvedValue('normal');
    vi.mocked(ow.getDestinationForecast).mockResolvedValue([]);
    vi.mocked(ai.generateText).mockRejectedValue(new Error('Gemini timeout'));

    await runDayOfBriefing(INPUT);

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const payload = sendMessageMock.mock.calls[0][1] as { text: string };
    expect(payload.text).toContain('🌅 בוקר טוב! היום ביומן:');
    expect(payload.text).toContain('• 14:00 — Colosseum');
  });

  it('fallback: OpenWeather throws → posts fallback template (not enriched briefing)', async () => {
    // Per locked spec: ANY enrichment source throws → fallback.
    // OpenWeather is an enrichment source, so its throw forces the fallback
    // even though calendar + transit succeeded.
    vi.mocked(cal.listUpcomingEvents).mockResolvedValue([
      { title: 'Dinner', date: '2026-05-10T19:00:00+02:00' },
    ]);
    vi.mocked(ow.getDestinationForecast).mockRejectedValue(new Error('429'));
    vi.mocked(gs.transitAlerts).mockResolvedValue('normal');
    vi.mocked(ai.generateText).mockResolvedValue('should not be called');

    await runDayOfBriefing(INPUT);

    // Gemini composition must NOT be called — fallback fires on OW failure.
    expect(vi.mocked(ai.generateText)).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const payload = sendMessageMock.mock.calls[0][1] as { text: string };
    expect(payload.text).toContain('🌅 בוקר טוב! היום ביומן:');
    expect(payload.text).toContain('• 19:00 — Dinner');
  });

  it('fallback: geminiGroundedSearch transit throws → posts fallback template', async () => {
    vi.mocked(cal.listUpcomingEvents).mockResolvedValue([
      { title: 'Museum', date: '2026-05-10T10:00:00+02:00' },
    ]);
    vi.mocked(ow.getDestinationForecast).mockResolvedValue([]);
    vi.mocked(gs.transitAlerts).mockRejectedValue(new Error('Gemini search failed'));
    vi.mocked(ai.generateText).mockResolvedValue('should not be called');

    await runDayOfBriefing(INPUT);

    expect(vi.mocked(ai.generateText)).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const payload = sendMessageMock.mock.calls[0][1] as { text: string };
    expect(payload.text).toContain('🌅 בוקר טוב! היום ביומן:');
    expect(payload.text).toContain('• 10:00 — Museum');
  });

  it('no-op when sock is null', async () => {
    vi.mocked(state.getState).mockReturnValue({
      sock: null,
      connection: 'disconnected',
      qr: null,
      botJid: null,
      botDisplayName: null,
      isShuttingDown: false,
    });
    vi.mocked(cal.listUpcomingEvents).mockResolvedValue([]);
    vi.mocked(gs.transitAlerts).mockResolvedValue('normal');
    vi.mocked(ow.getDestinationForecast).mockResolvedValue([]);
    vi.mocked(ai.generateText).mockResolvedValue('composed');

    await expect(runDayOfBriefing(INPUT)).resolves.not.toThrow();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
