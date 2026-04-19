import Fastify from 'fastify';
import corsPlugin from './plugins/cors.js';
import jwtPlugin from './plugins/jwt.js';
import staticPlugin from './plugins/static.js';
import authRoutes from './routes/auth.js';
import contactRoutes from './routes/contacts.js';
import draftRoutes from './routes/drafts.js';
import groupRoutes from './routes/groups.js';
import keywordRuleRoutes from './routes/keywordRules.js';
import settingsRoutes from './routes/settings.js';
import statusRoutes from './routes/status.js';
import personalCalendarRoutes from './routes/personalCalendar.js';
import reminderRoutes from './routes/reminders.js';
import actionablesRoutes from './routes/actionables.js';
import integrationsRoutes from './routes/integrations.js';
import taskRoutes from './routes/tasks.js';
import scheduledMessageRoutes from './routes/scheduledMessages.js';
import linkedinRoutes from './routes/linkedin.js';

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
  await fastify.register(keywordRuleRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(statusRoutes);
  await fastify.register(personalCalendarRoutes);
  await fastify.register(reminderRoutes);
  await fastify.register(actionablesRoutes);
  await fastify.register(integrationsRoutes);
  await fastify.register(taskRoutes);
  await fastify.register(scheduledMessageRoutes);
  await fastify.register(linkedinRoutes);

  // 5. Static file serving (last — catch-all for SPA)
  await fastify.register(staticPlugin);

  return fastify;
}
