import type { FastifyInstance } from 'fastify';
import {
  getTodoTasks,
  getTodoTasksByStatus,
  countTodoTasksByStatus,
} from '../../db/queries/todoTasks.js';

export default async function taskRoutes(fastify: FastifyInstance) {
  // 1. GET /api/tasks (authenticated) -- paginated task list with optional status filter
  fastify.get<{
    Querystring: { status?: string; limit?: string; offset?: string };
  }>(
    '/api/tasks',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { status, limit: limitStr, offset: offsetStr } = request.query;
      const limit = parseInt(limitStr || '50', 10);
      const offset = parseInt(offsetStr || '0', 10);

      let tasks;
      let total: number;

      if (status && ['pending', 'synced', 'cancelled', 'failed'].includes(status)) {
        tasks = getTodoTasksByStatus(status, limit);
        total = countTodoTasksByStatus(status);
      } else {
        tasks = getTodoTasks(limit, offset);
        // Count all tasks across all statuses
        total =
          countTodoTasksByStatus('pending') +
          countTodoTasksByStatus('synced') +
          countTodoTasksByStatus('cancelled') +
          countTodoTasksByStatus('failed');
      }

      return { tasks, total };
    },
  );

  // 2. GET /api/tasks/stats (authenticated) -- counts by status
  fastify.get(
    '/api/tasks/stats',
    { onRequest: [fastify.authenticate] },
    async () => {
      return {
        pending: countTodoTasksByStatus('pending'),
        synced: countTodoTasksByStatus('synced'),
        cancelled: countTodoTasksByStatus('cancelled'),
        failed: countTodoTasksByStatus('failed'),
      };
    },
  );
}
