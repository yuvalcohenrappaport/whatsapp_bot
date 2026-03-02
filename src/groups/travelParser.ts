import { z } from 'zod';
import { config } from '../config.js';
import pino from 'pino';
import { generateJson } from '../ai/provider.js';

const logger = pino({ level: config.LOG_LEVEL });

// --- Zod schema for Gemini structured output ---

const TravelIntentSchema = z.object({
  isTravelRelated: z
    .boolean()
    .describe('True if this is a travel search request'),
  isVague: z
    .boolean()
    .describe(
      'True if essential info (at minimum destination) is missing',
    ),
  clarificationQuestion: z
    .string()
    .nullable()
    .describe(
      'Question to ask if vague, in the detected language; null if clear',
    ),
  queryType: z
    .enum([
      'flights',
      'hotels',
      'restaurants',
      'activities',
      'car_rental',
      'general',
      'history_search',
    ])
    .nullable()
    .describe('Type of travel query'),
  searchQuery: z
    .string()
    .nullable()
    .describe('Optimized Google search query string'),
  destination: z.string().nullable().describe('Travel destination'),
  dates: z
    .string()
    .nullable()
    .describe('Date range as natural language string'),
  budget: z.string().nullable().describe('Budget constraints if mentioned'),
  preferences: z
    .string()
    .nullable()
    .describe('Any additional preferences mentioned'),
});

export type TravelIntent = z.infer<typeof TravelIntentSchema>;

const TRAVEL_INTENT_JSON_SCHEMA = z.toJSONSchema(TravelIntentSchema);

// --- Intent parsing ---

/**
 * Use Gemini to parse a travel @mention message into structured intent.
 * Returns null on any error -- never crashes the pipeline.
 */
export async function parseTravelIntent(
  messageText: string,
  recentGroupContext: string,
  lang: 'he' | 'en',
): Promise<TravelIntent | null> {
  const langLabel = lang === 'he' ? 'Hebrew' : 'English';

  const systemInstruction = `You are a travel assistant parsing @mention requests from a WhatsApp group. Determine if the message is travel-related. If yes, extract all available details and build an optimized Google search query. If essential info is missing (especially destination), set isVague=true and provide a clarification question in ${langLabel}. Consider the recent group context to infer missing details (e.g., if the group discussed a trip to Barcelona, a "find hotels" request should auto-fill Barcelona as destination). If the user is asking about a past decision, what was decided, or recalling something the group discussed (e.g., 'what hotel did we pick?', 'what did we decide about transport?', 'מה החלטנו על המלון?'), set queryType to 'history_search' and isVague to false. Do not set isVague for recall questions -- they are valid even without a destination. Respond in JSON.`;

  const userContent = `Message: ${messageText}\n\nRecent group context:\n${recentGroupContext || '(no recent context)'}`;

  try {
    const raw = await generateJson<unknown>({
      systemPrompt: systemInstruction,
      userContent,
      jsonSchema: TRAVEL_INTENT_JSON_SCHEMA as Record<string, unknown>,
      schemaName: 'travel_intent',
    });

    if (!raw) {
      logger.debug({ messageText }, 'AI returned empty response for travel intent parsing');
      return null;
    }

    const validated = TravelIntentSchema.safeParse(raw);
    if (!validated.success) {
      logger.warn(
        { err: validated.error.message, messageText },
        'AI travel intent response failed Zod validation',
      );
      return null;
    }

    return validated.data;
  } catch (err) {
    logger.error(
      { err, messageText },
      'Error during travel intent parsing -- skipping',
    );
    return null;
  }
}
