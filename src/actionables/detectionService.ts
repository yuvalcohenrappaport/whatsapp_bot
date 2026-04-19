import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { config } from '../config.js';
import { getSetting } from '../db/queries/settings.js';
import { commitmentDetection } from '../commitments/CommitmentDetectionService.js';
import { detectMessageLanguage } from '../calendar/calendarApproval.js';
import { createActionable } from '../db/queries/actionables.js';
import { enqueueForPreview } from '../approval/debounceBuckets.js';

// Phase 40 (v1.8): Unified detection pipeline.
//
// Replaces the split commitments→{reminders, todoTasks} write paths with
// a single writer that persists one `actionables` row per extracted item in
// status='pending_approval'. Google Tasks is not called at detection time
// (Phase 42 pushes on approval). No self-chat notifications are sent from
// this module — Phase 41 ships the batched-preview UX.
//
// Guards are MIRRORED FROM commitmentPipeline.ts — keep in sync until Phase 41
// retires the legacy module entirely.

const logger = pino({ level: config.LOG_LEVEL });

// ─── Guards — MIRRORED FROM commitmentPipeline.ts — keep in sync ─────────────

/** Per-chat JID -> last Gemini call timestamp (ms). Module-local, matches legacy. */
const chatCooldowns = new Map<string, number>();

/** 5-minute cooldown per chat to avoid rapid-fire Gemini calls. */
const COOLDOWN_MS = 5 * 60 * 1000;

function isOnCooldown(chatJid: string): boolean {
  const last = chatCooldowns.get(chatJid);
  if (last === undefined) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function isBlocklisted(contactJid: string): boolean {
  const raw = getSetting('commitment_blocklist');
  if (!raw) return false;
  try {
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.includes(contactJid);
  } catch {
    return false;
  }
}

function isIncomingAllowed(contactJid: string): boolean {
  const raw = getSetting('commitment_incoming_allowlist');
  if (!raw) return false;
  try {
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.includes(contactJid);
  } catch {
    return false;
  }
}

// ─── Main pipeline entry point ───────────────────────────────────────────────

/**
 * Write one `pending_approval` actionable per extracted commitment/task.
 * No Google Tasks call, no self-chat message — this is the v1.8 dark-launch writer.
 */
export async function processDetection(params: {
  messageId: string;
  contactJid: string;
  contactName: string | null;
  text: string;
  timestamp: number;
  fromMe: boolean;
}): Promise<void> {
  try {
    const { messageId, contactJid, contactName, text, timestamp, fromMe } = params;

    // Guards in the exact order of commitmentPipeline.processCommitment steps a-g.
    // a. Master switch
    if (getSetting('commitment_detection_enabled') === 'false') return;
    // b. Skip self-chat
    if (contactJid === config.USER_JID) return;
    // c. Incoming messages: must be on allowlist
    if (!fromMe && !isIncomingAllowed(contactJid)) return;
    // d. Blocklist
    if (isBlocklisted(contactJid)) return;
    // e. Cheap pre-filter (action verbs / temporal markers)
    if (!commitmentDetection.passesPreFilter(text, fromMe)) return;
    // f. Per-chat cooldown
    if (isOnCooldown(contactJid)) return;
    // g. Set cooldown BEFORE async Gemini call to avoid race conditions.
    chatCooldowns.set(contactJid, Date.now());

    // Gemini extraction (reuse the existing service verbatim)
    const results = await commitmentDetection.extractCommitments(text, {
      contactName,
      contactJid,
      fromMe,
    });
    if (results.length === 0) return;

    // Single write path: one actionable per extracted item.
    //
    // Pipeline gate (v1_8_detection_pipeline):
    //   - 'legacy'      → handled elsewhere (commitmentPipeline); not reached here
    //   - 'dark_launch' → write to actionables silently; NO preview bucket
    //   - 'interactive' → write AND enqueue into the 2-min debounce bucket so
    //                     the Phase 41 preview UX fires.
    const pipelineMode = getSetting('v1_8_detection_pipeline') ?? 'dark_launch';
    const detectedLanguage = detectMessageLanguage(text);
    for (const item of results) {
      const id = randomUUID();
      createActionable({
        id,
        sourceType: item.type, // 'commitment' | 'task' — persisted verbatim
        sourceContactJid: contactJid,
        sourceContactName: contactName,
        sourceMessageId: messageId,
        sourceMessageText: text,
        detectedLanguage,
        originalDetectedTask: item.task,
        task: item.task,
        status: 'pending_approval',
        detectedAt: timestamp,
        fireAt: item.dateTime ? item.dateTime.getTime() : null,
      });
      logger.info(
        {
          id,
          task: item.task,
          sourceType: item.type,
          contactJid,
          language: detectedLanguage,
          pipelineMode,
        },
        'Actionable detected (pending_approval)',
      );
      if (pipelineMode === 'interactive') {
        enqueueForPreview(id, contactJid);
      }
    }
  } catch (err) {
    logger.error(
      { err, messageId: params.messageId },
      'Error in detection pipeline — skipping',
    );
  }
}

// ─── Test-only helpers ────────────────────────────────────────────────────────

/** Reset the per-chat cooldown map — used by unit tests to isolate scenarios. */
export function __resetCooldownsForTest(): void {
  chatCooldowns.clear();
}
