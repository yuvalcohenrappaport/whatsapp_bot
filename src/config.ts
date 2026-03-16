import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['silent', 'error', 'warn', 'info', 'debug'])
    .default('info'),
  AUTH_DIR: z.string().default('./data/auth'),
  DB_PATH: z.string().default('./data/bot.db'),
  GEMINI_API_KEY: z.string(),
  USER_JID: z.string(), // Bot owner's WhatsApp JID, e.g. 972501234567@s.whatsapp.net
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OWNER_EXPORT_NAME: z.string(), // User's display name as it appears in WhatsApp export files (e.g. "Yuval Cohen Rappaport")
  IMPORT_DIR: z.string().default('./data/imports'),
  PROCESSED_DIR: z.string().default('./data/processed'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  DASHBOARD_PASSWORD: z.string().min(6, 'DASHBOARD_PASSWORD must be at least 6 characters'),
  API_PORT: z.coerce.number().default(3000),
  API_HOST: z.string().default('100.124.47.99'),
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().optional(),
  LMS_BASE_URL: z.string().default('http://localhost:1234'),
  LMS_MODEL: z.string().default('qwen2.5-coder-7b-instruct'),
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  console.error(result.error.format());
  process.exit(1);
}

export const config: Config = result.data;
