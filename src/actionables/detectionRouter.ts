import pino from 'pino';
import { config } from '../config.js';
import { getSetting } from '../db/queries/settings.js';
import { processCommitment } from '../commitments/commitmentPipeline.js';
import { processDetection } from './detectionService.js';

// Phase 40 (v1.8) — gate between the new detection pipeline (dark_launch, default)
// and the legacy commitments→{reminders,todoTasks} path (rollback).
//
// Lives in its own module (separate from messageHandler.ts) so unit tests can
// import `routeDetection` without transitively loading the full pipeline graph
// (which includes voice/client.ts + ElevenLabs SDK, config.env validation, etc.).

const logger = pino({ level: config.LOG_LEVEL });

export function routeDetection(params: {
  messageId: string;
  contactJid: string;
  contactName: string | null;
  text: string;
  timestamp: number;
  fromMe: boolean;
}): void {
  const mode = getSetting('v1_8_detection_pipeline') ?? 'dark_launch';
  if (mode === 'legacy') {
    processCommitment(params).catch((err) =>
      logger.error(
        { err, messageId: params.messageId },
        'legacy processCommitment failed',
      ),
    );
  } else {
    processDetection(params).catch((err) =>
      logger.error(
        { err, messageId: params.messageId },
        'processDetection failed',
      ),
    );
  }
}
