import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { config } from '../../config.js';
import {
  isMicrosoftConfigured,
  isMicrosoftConnected,
  getAuthUrl,
  handleAuthCallback,
  disconnectMicrosoft,
  getMicrosoftUserInfo,
  getAccessToken,
} from '../../todo/todoAuthService.js';
import {
  countTodoTasksByStatus,
  getTodoTasksByStatus,
  updateTodoTaskStatus,
} from '../../db/queries/todoTasks.js';

const logger = pino({ level: config.LOG_LEVEL });

export default async function integrationsRoutes(fastify: FastifyInstance) {
  // 1. GET /api/integrations/microsoft/status (authenticated)
  fastify.get(
    '/api/integrations/microsoft/status',
    { onRequest: [fastify.authenticate] },
    async () => {
      const configured = isMicrosoftConfigured();
      const connected = configured ? await isMicrosoftConnected() : false;
      const user = connected ? getMicrosoftUserInfo() : null;
      return { configured, connected, user };
    },
  );

  // 2. GET /api/auth/microsoft (authenticated) -- get OAuth consent URL
  fastify.get(
    '/api/auth/microsoft',
    { onRequest: [fastify.authenticate] },
    async (_request, reply) => {
      const url = await getAuthUrl();
      if (!url) {
        return reply.status(503).send({ error: 'Microsoft OAuth not configured' });
      }
      return { url };
    },
  );

  // 3. GET /api/auth/microsoft/callback (NO auth -- redirect from Microsoft)
  fastify.get(
    '/api/auth/microsoft/callback',
    async (request, reply) => {
      const { code } = request.query as { code?: string };
      if (!code) {
        return reply.redirect('/integrations?microsoft=error');
      }

      const result = await handleAuthCallback(code);
      if (result.success) {
        return reply.redirect('/integrations?microsoft=connected');
      }
      logger.error({ error: result.error }, 'Microsoft OAuth callback failed');
      return reply.redirect('/integrations?microsoft=error');
    },
  );

  // 4. POST /api/integrations/microsoft/disconnect (authenticated)
  fastify.post(
    '/api/integrations/microsoft/disconnect',
    { onRequest: [fastify.authenticate] },
    async () => {
      // Count pending tasks before disconnect
      const pendingCount = countTodoTasksByStatus('pending');

      // Cancel all pending tasks
      if (pendingCount > 0) {
        const pendingTasks = getTodoTasksByStatus('pending');
        for (const task of pendingTasks) {
          updateTodoTaskStatus(task.id, 'cancelled');
        }
      }

      await disconnectMicrosoft();
      return { ok: true, pendingTasksCancelled: pendingCount };
    },
  );

  // 5. GET /api/integrations/microsoft/health (authenticated)
  fastify.get(
    '/api/integrations/microsoft/health',
    { onRequest: [fastify.authenticate] },
    async () => {
      let healthy = false;
      try {
        const token = await getAccessToken();
        healthy = token !== null;
      } catch {
        healthy = false;
      }
      return { healthy, lastChecked: new Date().toISOString() };
    },
  );
}
