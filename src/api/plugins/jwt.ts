import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config.js';

export default fp(
  async (fastify: FastifyInstance) => {
    await fastify.register(jwt, { secret: config.JWT_SECRET });

    fastify.decorate(
      'authenticate',
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          await request.jwtVerify();
        } catch (_err) {
          reply.status(401).send({ error: 'Unauthorized' });
        }
      },
    );
  },
  { name: 'jwt-plugin' },
);

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
