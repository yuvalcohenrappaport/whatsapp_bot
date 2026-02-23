import fp from 'fastify-plugin';
import staticPlugin from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default fp(
  async (fastify: FastifyInstance) => {
    const root = path.resolve(__dirname, '../../../dashboard/dist');

    // If the dashboard hasn't been built yet, skip static serving and log a warning
    if (!fs.existsSync(root)) {
      fastify.log.warn(
        `Dashboard build not found at ${root} — static file serving disabled. Run 'npm run build' in dashboard/ to enable.`,
      );
      return;
    }

    await fastify.register(staticPlugin, {
      root,
      prefix: '/',
      wildcard: false,
    });

    fastify.setNotFoundHandler((_, reply) => {
      return reply.sendFile('index.html');
    });
  },
  { name: 'static-plugin' },
);
