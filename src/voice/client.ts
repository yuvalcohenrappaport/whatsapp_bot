import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type pino from 'pino';
import { config } from '../config.js';

export const elevenLabsClient = new ElevenLabsClient({
  apiKey: config.ELEVENLABS_API_KEY,
});

/**
 * Validates that the ElevenLabs API key is valid and the configured voice ID
 * exists. Called at startup — non-fatal if it fails (bot continues with text-only replies).
 *
 * Uses short timeout (5s) and no retries to avoid blocking startup.
 */
export async function validateElevenLabsConnection(
  logger: pino.Logger,
): Promise<boolean> {
  try {
    await elevenLabsClient.voices.get(config.ELEVENLABS_DEFAULT_VOICE_ID, {
      timeoutInSeconds: 5,
      maxRetries: 0,
    });
    logger.info('ElevenLabs connection validated — voice replies available');
    return true;
  } catch (err) {
    logger.warn(
      { err },
      'ElevenLabs validation failed — voice replies will fall back to text',
    );
    return false;
  }
}
