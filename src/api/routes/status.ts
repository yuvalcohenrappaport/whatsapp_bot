import type { FastifyInstance } from 'fastify';
import { getState, subscribe } from '../state.js';

export default async function statusRoutes(fastify: FastifyInstance) {
  // GET /api/status - current connection status (no QR exposed here)
  fastify.get(
    '/api/status',
    { onRequest: [fastify.authenticate] },
    async () => {
      const { connection } = getState();
      return { connection, qr: null };
    },
  );

  // GET /api/status/stream - SSE endpoint for live connection + QR updates
  // JWT is passed as ?token= query param because EventSource cannot send headers
  fastify.get(
    '/api/status/stream',
    async (request, reply) => {
      const { token } = request.query as { token?: string };

      try {
        fastify.jwt.verify(token ?? '');
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // Set SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders();

      const send = (data: object) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Send current state immediately
      const { connection, qr } = getState();
      send({ connection, qr });

      // Subscribe to state changes
      const unsub = subscribe((state) => {
        send({ connection: state.connection, qr: state.qr });
      });

      // Clean up on client disconnect
      request.raw.on('close', () => {
        unsub();
      });
    },
  );
}
