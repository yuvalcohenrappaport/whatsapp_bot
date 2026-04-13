/**
 * Translates client.ts errors into Fastify replies.
 *
 * Contract:
 * - UpstreamError{kind:'http'}         → pass-through: use err.status + err.body verbatim
 * - UpstreamError{kind:'timeout'}      → 504 + UPSTREAM_FAILURE envelope
 * - UpstreamError{kind:'connection_refused'} → 503 + UNAVAILABLE envelope
 * - UpstreamError{kind:'network'|'parse'}   → 502 + UPSTREAM_FAILURE envelope
 * - SchemaMismatchError                → 500 + INTERNAL_ERROR envelope (details includes path + issues)
 * - Anything else                      → rethrow (Fastify default handler logs + responds)
 */
import type { FastifyReply } from 'fastify';
import { SchemaMismatchError, UpstreamError } from './client.js';

interface WireErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function mapUpstreamErrorToReply(
  err: unknown,
  reply: FastifyReply,
): FastifyReply {
  if (err instanceof SchemaMismatchError) {
    const body: WireErrorEnvelope = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'upstream response schema mismatch',
        details: {
          path: err.path,
          issues: err.zodIssues,
        },
      },
    };
    return reply.status(500).send(body);
  }

  if (err instanceof UpstreamError) {
    switch (err.kind) {
      case 'http': {
        // Pass-through: preserve status + body verbatim. If the body isn't
        // a parsed envelope (e.g. pm-authority returned a stray string),
        // still send it — the dashboard can decide how to handle it.
        return reply.status(err.status).send(err.body);
      }
      case 'timeout': {
        const body: WireErrorEnvelope = {
          error: {
            code: 'UPSTREAM_FAILURE',
            message: 'upstream timed out',
          },
        };
        return reply.status(504).send(body);
      }
      case 'connection_refused': {
        const body: WireErrorEnvelope = {
          error: {
            code: 'UNAVAILABLE',
            message: 'pm-authority is not reachable',
          },
        };
        return reply.status(503).send(body);
      }
      case 'network':
      case 'parse': {
        const body: WireErrorEnvelope = {
          error: {
            code: 'UPSTREAM_FAILURE',
            message: err.message,
          },
        };
        return reply.status(502).send(body);
      }
    }
  }

  // Unknown error: rethrow so Fastify logs it and emits a 500.
  throw err;
}

// Re-export classification for consumers that need it. (The client already
// classifies internally — this is a convenience for routes that want to
// inspect a kind after catching.)
export type { UpstreamErrorKind } from './client.js';
export { UpstreamError, SchemaMismatchError } from './client.js';
