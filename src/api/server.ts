import Fastify from 'fastify';
import corsPlugin from './plugins/cors.js';
import jwtPlugin from './plugins/jwt.js';
import staticPlugin from './plugins/static.js';
import authRoutes from './routes/auth.js';
import contactRoutes from './routes/contacts.js';
import draftRoutes from './routes/drafts.js';
import groupRoutes from './routes/groups.js';
import statusRoutes from './routes/status.js';

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // 1. CORS — allow Vite dev server origin
  await fastify.register(corsPlugin);

  // 2. JWT plugin — adds fastify.authenticate decorator
  await fastify.register(jwtPlugin);

  // 3. Auth routes (login) — no auth guard
  await fastify.register(authRoutes);

  // 4. Protected API routes
  await fastify.register(contactRoutes);
  await fastify.register(draftRoutes);
  await fastify.register(groupRoutes);
  await fastify.register(statusRoutes);

  // 5. Static file serving (last — catch-all for SPA)
  await fastify.register(staticPlugin);

  return fastify;
}
