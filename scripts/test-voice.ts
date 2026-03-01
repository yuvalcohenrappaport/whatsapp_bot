import { transcribe } from '../src/voice/transcriber.js';
import { textToSpeech } from '../src/voice/tts.js';
import { writeFileSync } from 'fs';
import pino from 'pino';

const logger = pino({ level: 'debug' });

function isOggContainer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  );
}

const HEBREW_SENTENCES = [
  'שלום, מה שלומך?',
  'אני יכול לעזור לך עם זה.',
  'הפגישה נדחתה לשבוע הבא.',
  'תודה רבה על עזרתך.',
  'הדוח המחקרי הוגש בזמן.',
];

async function main(): Promise<void> {
  console.log('=== Voice Service Integration Test ===\n');

  // --- TTS Test ---
  console.log('--- TTS Test: 5 Hebrew sentences ---\n');

  let successCount = 0;
  let firstAudio: Buffer | null = null;

  for (const sentence of HEBREW_SENTENCES) {
    const audio = await textToSpeech(sentence, logger);

    if (!isOggContainer(audio)) {
      throw new Error(`TTS output is not OGG for: "${sentence}"`);
    }

    successCount++;

    if (!firstAudio) {
      firstAudio = audio;
    }

    console.log(
      `TTS "${sentence.slice(0, 25)}..." => ${audio.length} bytes, OGG: true`,
    );
  }

  // Save first sentence audio for manual playback
  writeFileSync('./test-output-tts.ogg', firstAudio!);
  console.log('\nSaved test-output-tts.ogg for manual playback');

  // --- STT Round-trip Test ---
  console.log('\n--- STT Round-trip Test ---\n');

  const transcript = await transcribe(firstAudio!, logger);

  if (!transcript || transcript.length === 0) {
    throw new Error('STT returned empty transcript');
  }

  console.log(`STT round-trip transcript: "${transcript}"`);

  // --- Summary ---
  console.log('\n--- Results ---');
  console.log(`TTS: ${successCount}/5 sentences produced valid OGG`);
  console.log(`STT: Round-trip transcript: "${transcript}"`);
  console.log('Listen to test-output-tts.ogg to verify Hebrew naturalness');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
