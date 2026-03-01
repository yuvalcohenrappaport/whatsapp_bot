import type pino from 'pino';
import type { SpeechToTextChunkResponseModel } from '@elevenlabs/elevenlabs-js/api';
import { elevenLabsClient } from './client.js';

export async function transcribe(
  audioBuffer: Buffer,
  logger: pino.Logger,
): Promise<string> {
  const result = (await elevenLabsClient.speechToText.convert({
    modelId: 'scribe_v2',
    file: { data: audioBuffer, filename: 'audio.ogg', contentType: 'audio/ogg' },
    languageCode: 'heb',
  })) as SpeechToTextChunkResponseModel;

  logger.info({ chars: result.text.length }, 'transcription complete');
  return result.text;
}
