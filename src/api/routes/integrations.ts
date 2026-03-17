import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { config } from '../../config.js';
import {
  isTasksConfigured,
  isTasksConnected,
  getTasksUserInfo,
} from '../../todo/todoAuthService.js';
import {
  countTodoTasksByStatus,
  getTodoTasksByStatus,
  updateTodoTaskStatus,
} from '../../db/queries/todoTasks.js';

const logger = pino({ level: config.LOG_LEVEL });

export default async function integrationsRoutes(fastify: FastifyInstance) {
  // 1. GET /api/integrations/google-tasks/status (authenticated)
  fastify.get(
    '/api/integrations/google-tasks/status',
    { onRequest: [fastify.authenticate] },
    async () => {
      const configured = isTasksConfigured();
      const connected = configured ? isTasksConnected() : false;
      const user = connected ? getTasksUserInfo() : null;
      return { configured, connected, user };
    },
  );

  // Keep legacy Microsoft endpoints as redirects to avoid dashboard errors
  fastify.get(
    '/api/integrations/microsoft/status',
    { onRequest: [fastify.authenticate] },
    async () => {
      return { configured: false, connected: false, user: null };
    },
  );

  fastify.get(
    '/api/integrations/microsoft/health',
    { onRequest: [fastify.authenticate] },
    async () => {
      return { healthy: false, lastChecked: new Date().toISOString() };
    },
  );
}
