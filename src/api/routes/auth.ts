import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/login', async (request, reply) => {
    const { password } = request.body as { password: string };
    if (password !== config.DASHBOARD_PASSWORD) {
      return reply.status(401).send({ error: 'Invalid password' });
    }
    const token = fastify.jwt.sign({ user: 'admin' }, { expiresIn: '30d' });
    return { token };
  });
}
