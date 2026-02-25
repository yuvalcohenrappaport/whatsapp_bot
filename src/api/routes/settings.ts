import type { FastifyInstance } from 'fastify';
import { getSetting, setSetting } from '../../db/queries/settings.js';
import { checkLocalModelHealth } from '../../ai/local.js';

const VALID_PROVIDERS = ['gemini', 'local'] as const;

export default async function settingsRoutes(fastify: FastifyInstance) {
  // GET /api/settings — current settings + local model health
  fastify.get(
    '/api/settings',
    { onRequest: [fastify.authenticate] },
    async () => {
      const aiProvider = getSetting('ai_provider') ?? 'gemini';
      const localModelOnline = await checkLocalModelHealth();
      return { aiProvider, localModelOnline };
    },
  );

  // PATCH /api/settings — update settings
  fastify.patch(
    '/api/settings',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = request.body as { aiProvider?: string };

      if (body.aiProvider !== undefined) {
        if (!VALID_PROVIDERS.includes(body.aiProvider as typeof VALID_PROVIDERS[number])) {
          return reply.status(400).send({ error: 'Invalid aiProvider. Must be "gemini" or "local".' });
        }
        setSetting('ai_provider', body.aiProvider);
      }

      const aiProvider = getSetting('ai_provider') ?? 'gemini';
      const localModelOnline = await checkLocalModelHealth();
      return { aiProvider, localModelOnline };
    },
  );
}
