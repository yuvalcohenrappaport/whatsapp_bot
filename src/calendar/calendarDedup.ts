import { createHash } from 'crypto';
import type { WAMessage } from '@whiskeysockets/baileys';

/**
 * Normalize text and compute a SHA-256 hex prefix (16 chars) for dedup.
 */
export function computeContentHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Check if a WAMessage is forwarded by inspecting contextInfo across message types.
 */
export function isForwardedMessage(msg: WAMessage): boolean {
  const m = msg.message;
  if (!m) return false;

  // Check all message types that can carry forwarding metadata
  const candidates = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.conversation ? undefined : undefined, // plain conversation has no contextInfo
  ];

  for (const ctx of candidates) {
    if (!ctx) continue;
    if (ctx.isForwarded) return true;
    if ((ctx.forwardingScore ?? 0) > 0) return true;
  }

  return false;
}

/**
 * Check if two events are similar enough to be considered the same event.
 * Criteria: same chat + eventDate within 24h + title similarity.
 *
 * Title similarity uses normalized word overlap (Jaccard) or containment.
 */
export function isSimilarEvent(
  existing: { sourceChatJid: string; eventDate: number; title: string },
  candidate: { sourceChatJid: string; eventDate: number; title: string },
): boolean {
  // Must be same chat
  if (existing.sourceChatJid !== candidate.sourceChatJid) return false;

  // Event dates must be within 24 hours
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (Math.abs(existing.eventDate - candidate.eventDate) > DAY_MS) return false;

  // Title similarity check
  const existingWords = normalizeTitle(existing.title);
  const candidateWords = normalizeTitle(candidate.title);

  if (existingWords.length === 0 || candidateWords.length === 0) return false;

  // Containment check: if one title's words are a subset of the other
  const existingSet = new Set(existingWords);
  const candidateSet = new Set(candidateWords);

  const allExistingInCandidate = existingWords.every((w) => candidateSet.has(w));
  const allCandidateInExisting = candidateWords.every((w) => existingSet.has(w));
  if (allExistingInCandidate || allCandidateInExisting) return true;

  // Jaccard similarity > 50%
  const intersection = existingWords.filter((w) => candidateSet.has(w)).length;
  const union = new Set([...existingWords, ...candidateWords]).size;
  return union > 0 && intersection / union > 0.5;
}

/**
 * Normalize a title for comparison: lowercase, keep only alphanumeric + Hebrew chars,
 * split into words.
 */
function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // keep letters (incl Hebrew), numbers, spaces
    .split(/\s+/)
    .filter((w) => w.length > 0);
}
