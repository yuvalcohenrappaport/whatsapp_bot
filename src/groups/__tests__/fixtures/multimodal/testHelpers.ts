/**
 * Shared WAMessage factories for multimodal intake tests.
 *
 * Used by both Plan 52-02 unit tests (multimodalIntake.test.ts) and
 * Plan 52-03 integration tests. No test-framework coupling — just plain
 * factory functions that return Baileys WAMessage shapes.
 */

import type { WAMessage } from '@whiskeysockets/baileys';

export function mkImageMsg(
  groupJid: string,
  fileLength = 80_000,
  msgId = 'msg-img-1',
): WAMessage {
  return {
    key: {
      id: msgId,
      remoteJid: groupJid,
      fromMe: false,
      participant: 'alice@s.whatsapp.net',
    },
    message: { imageMessage: { mimetype: 'image/jpeg', fileLength } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  } as unknown as WAMessage;
}

export function mkPdfMsg(
  groupJid: string,
  fileLength = 40_000,
  msgId = 'msg-pdf-1',
): WAMessage {
  return {
    key: {
      id: msgId,
      remoteJid: groupJid,
      fromMe: false,
      participant: 'alice@s.whatsapp.net',
    },
    message: {
      documentMessage: { mimetype: 'application/pdf', fileLength },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
  } as unknown as WAMessage;
}

export function mkStickerMsg(
  groupJid: string,
  msgId = 'msg-sticker-1',
): WAMessage {
  return {
    key: {
      id: msgId,
      remoteJid: groupJid,
      fromMe: false,
      participant: 'alice@s.whatsapp.net',
    },
    message: { stickerMessage: { mimetype: 'image/webp' } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  } as unknown as WAMessage;
}
