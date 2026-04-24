/**
 * In-memory cache of groupJid → calendarId.
 *
 * Extracted into its own module (Phase 52-02) to break a circular import:
 * both `calendarHelpers.ts` and `groupMessagePipeline.ts` need to share the
 * same Map instance. Placing it in either of those files creates a cycle.
 */
export const calendarIdCache = new Map<string, string>();
