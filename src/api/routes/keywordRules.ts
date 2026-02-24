import type { FastifyInstance } from 'fastify';
import {
  getKeywordRulesByGroup,
  getKeywordRuleById,
  createKeywordRule,
  updateKeywordRule,
  deleteKeywordRule,
} from '../../db/queries/keywordRules.js';

export default async function keywordRuleRoutes(fastify: FastifyInstance) {
  // GET /api/groups/:groupId/keyword-rules - all rules for a group
  fastify.get<{ Params: { groupId: string } }>(
    '/api/groups/:groupId/keyword-rules',
    { onRequest: [fastify.authenticate] },
    async (request) => {
      const { groupId } = request.params;
      return getKeywordRulesByGroup(groupId);
    },
  );

  // POST /api/groups/:groupId/keyword-rules - create a rule
  fastify.post<{ Params: { groupId: string } }>(
    '/api/groups/:groupId/keyword-rules',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { groupId } = request.params;
      const body = request.body as {
        name: string;
        pattern: string;
        isRegex?: boolean;
        responseType: string;
        responseText?: string;
        aiInstructions?: string;
        cooldownMs?: number;
      };

      if (body.responseType !== 'fixed' && body.responseType !== 'ai') {
        return reply
          .status(400)
          .send({ error: 'responseType must be "fixed" or "ai"' });
      }

      if (body.isRegex) {
        try {
          new RegExp(body.pattern);
        } catch {
          return reply
            .status(400)
            .send({ error: 'Invalid regex pattern' });
        }
      }

      if (body.responseType === 'fixed' && !body.responseText) {
        return reply
          .status(400)
          .send({ error: 'Fixed response type requires responseText' });
      }

      if (body.responseType === 'ai' && !body.aiInstructions) {
        return reply
          .status(400)
          .send({ error: 'AI response type requires aiInstructions' });
      }

      const id = crypto.randomUUID();
      createKeywordRule({
        id,
        groupJid: groupId,
        name: body.name,
        pattern: body.pattern,
        isRegex: body.isRegex ?? false,
        responseType: body.responseType,
        responseText: body.responseText ?? null,
        aiInstructions: body.aiInstructions ?? null,
        cooldownMs: body.cooldownMs ?? 60000,
      });

      return reply.status(201).send({ ok: true, id });
    },
  );

  // PATCH /api/keyword-rules/:id - update a rule
  fastify.patch<{ Params: { id: string } }>(
    '/api/keyword-rules/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const patch = request.body as Partial<{
        name: string;
        pattern: string;
        isRegex: boolean;
        responseType: string;
        responseText: string | null;
        aiInstructions: string | null;
        enabled: boolean;
        cooldownMs: number;
      }>;

      // Validate regex if pattern or isRegex is being updated
      const isRegex =
        patch.isRegex ?? getKeywordRuleById(id)?.isRegex ?? false;
      const pattern =
        patch.pattern ?? getKeywordRuleById(id)?.pattern;

      if (isRegex && pattern) {
        try {
          new RegExp(pattern);
        } catch {
          return reply
            .status(400)
            .send({ error: 'Invalid regex pattern' });
        }
      }

      // Validate responseType consistency
      if (patch.responseType === 'fixed' && patch.responseText === null) {
        return reply
          .status(400)
          .send({ error: 'Fixed response type requires responseText' });
      }
      if (patch.responseType === 'ai' && patch.aiInstructions === null) {
        return reply
          .status(400)
          .send({ error: 'AI response type requires aiInstructions' });
      }

      updateKeywordRule(id, patch);
      return getKeywordRuleById(id) ?? { ok: true };
    },
  );

  // DELETE /api/keyword-rules/:id - delete a rule
  fastify.delete<{ Params: { id: string } }>(
    '/api/keyword-rules/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      deleteKeywordRule(id);
      return reply.status(204).send();
    },
  );
}
