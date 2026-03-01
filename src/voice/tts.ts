import type pino from 'pino';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { elevenLabsClient } from './client.js';
import { config } from '../config.js';

async function streamToBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function transcodeToOgg(
  mp3Buffer: Buffer,
  logger: pino.Logger,
): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found');

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i',
      'pipe:0',
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      '-f',
      'ogg',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const stderrText = Buffer.concat(stderrChunks).toString().slice(-500);
        reject(new Error(`ffmpeg exited with code ${code}: ${stderrText}`));
      } else {
        resolve(Buffer.concat(stdoutChunks));
      }
    });

    proc.on('error', reject);

    proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') reject(err);
    });

    proc.stdin.end(mp3Buffer);
  });
}

export async function textToSpeech(
  text: string,
  logger: pino.Logger,
): Promise<Buffer> {
  const stream = await elevenLabsClient.textToSpeech.convert(
    config.ELEVENLABS_DEFAULT_VOICE_ID,
    {
      text,
      modelId: 'eleven_v3',
      outputFormat: 'mp3_44100_128',
    },
  );

  const mp3Buffer = await streamToBuffer(stream);
  logger.debug({ bytes: mp3Buffer.length }, 'TTS MP3 received');

  const oggBuffer = await transcodeToOgg(mp3Buffer, logger);
  logger.info({ bytes: oggBuffer.length }, 'TTS OGG ready');

  return oggBuffer;
}
