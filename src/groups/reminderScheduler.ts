import * as cron from 'node-cron';
import pino from 'pino';
import { config } from '../config.js';
import { getActiveGroups } from '../db/queries/groups.js';
import { getGroupMessagesSince } from '../db/queries/groupMessages.js';
import { listUpcomingEvents } from '../calendar/calendarService.js';
import { getState } from '../api/state.js';
import { generateText } from '../ai/provider.js';

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/** Map of group JID -> active cron job */
const scheduledJobs = new Map<string, cron.ScheduledTask>();

/** Map day name -> cron day number (0 = Sunday) */
const DAY_TO_CRON: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Extract the calendar ID from a calendar link URL.
 * Returns null if the link is absent or malformed.
 */
function extractCalendarId(calendarLink: string | null): string | null {
  if (!calendarLink) return null;
  try {
    const url = new URL(calendarLink);
    const src = url.searchParams.get('src');
    return src ? decodeURIComponent(src) : null;
  } catch {
    return null;
  }
}

/**
 * Format a Unix timestamp in milliseconds to a human-readable relative label.
 * e.g. "2 days ago", "5 hours ago", "just now"
 */
function relativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays >= 1) return `${diffDays}d ago`;
  if (diffHours >= 1) return `${diffHours}h ago`;
  return 'just now';
}

/**
 * Generate a weekly digest for a group using Gemini.
 * Returns the formatted digest string, or null if there is nothing to report.
 */
export async function generateWeeklyDigest(
  groupJid: string,
  groupName: string | null,
  calendarId: string | null,
): Promise<string | null> {
  // Fetch last 7 days of group messages (cap at 200)
  const sinceMs = Date.now() - 7 * 86400000;
  const messages = getGroupMessagesSince(groupJid, sinceMs, 200);

  // Fetch upcoming events (next 14 days)
  const events = calendarId ? await listUpcomingEvents(calendarId, 14) : [];

  // Skip silently if nothing to report
  if (messages.length === 0 && events.length === 0) {
    logger.info({ groupJid }, 'Nothing to report for weekly digest — skipping');
    return null;
  }

  // Format messages: "[senderName] (relative time): body"
  const messagesText =
    messages.length > 0
      ? messages
          .map((m) => {
            const sender = m.fromMe ? 'You' : (m.senderName ?? 'Unknown');
            return `${sender} (${relativeTime(m.timestamp)}): ${m.body}`;
          })
          .join('\n')
      : 'No messages this week.';

  // Format events: "- title — date"
  const eventsText =
    events.length > 0
      ? events
          .map((e) => {
            const dateStr = e.date ? new Date(e.date).toLocaleDateString('he-IL', { weekday: 'short', month: 'short', day: 'numeric' }) : e.date;
            return `- ${e.title} — ${dateStr}`;
          })
          .join('\n')
      : 'None';

  const systemInstruction =
    'You are a helpful group chat assistant. Generate a weekly digest for a WhatsApp group. The digest should read like a friend summarizing "here\'s what\'s coming up and what we still need to sort out". Keep it concise but comprehensive. Use the structured format provided. Write in the dominant language of the group messages (Hebrew or English). Use casual, friendly tone.';

  const userContent = `Group: ${groupName ?? groupJid}

=== Recent Messages (last 7 days) ===
${messagesText}

=== Upcoming Calendar Events (next 14 days) ===
${eventsText}

Generate a weekly digest with these sections:
1. Events - upcoming events from the calendar (formatted with dates)
2. Tasks - AI-inferred unresolved tasks or commitments from the chat (things people said they would do but haven't confirmed doing)
3. Notes - brief summary of notable discussion topics from the week

If a section has nothing to report, omit it entirely.
Format with these exact emoji headers:
📅 Events
📝 Tasks
💬 Notes`;

  try {
    const text = await generateText({
      systemPrompt: systemInstruction,
      messages: [{ role: 'user', content: userContent }],
    });

    if (!text) {
      logger.warn({ groupJid }, 'AI returned empty digest');
      return null;
    }
    return text;
  } catch (err) {
    logger.error({ err, groupJid }, 'Failed to generate weekly digest');
    return null;
  }
}

/**
 * Schedule (or re-schedule) a weekly reminder cron job for a specific group.
 */
export function scheduleGroupReminder(
  groupJid: string,
  groupName: string | null,
  reminderDay: string,
  reminderHour: number,
  calendarLink: string | null,
): void {
  // Cancel existing job for this group if any
  scheduledJobs.get(groupJid)?.stop();
  scheduledJobs.delete(groupJid);

  const dayNumber = DAY_TO_CRON[reminderDay.toLowerCase()];
  if (dayNumber === undefined) {
    logger.warn({ groupJid, reminderDay }, 'Unknown reminderDay — skipping group');
    return;
  }

  // Cron: minute 0, at configured hour, any day/month, on the configured weekday
  const cronExpression = `0 ${reminderHour} * * ${dayNumber}`;

  const job = cron.schedule(
    cronExpression,
    async () => {
      const { sock } = getState();
      if (!sock) {
        logger.info({ groupJid }, 'Bot disconnected, skipping reminder');
        return;
      }

      const calendarId = extractCalendarId(calendarLink);
      const digest = await generateWeeklyDigest(groupJid, groupName, calendarId);

      if (digest === null) {
        logger.info({ groupJid }, 'Nothing to report for weekly digest — skipping post');
        return;
      }

      try {
        await sock.sendMessage(groupJid, { text: digest });
        logger.info({ groupJid }, 'Weekly reminder sent');
      } catch (err) {
        logger.error({ err, groupJid }, 'Failed to send weekly reminder');
      }
    },
    { timezone: 'Asia/Jerusalem' },
  );

  scheduledJobs.set(groupJid, job);
  logger.debug({ groupJid, cronExpression, reminderDay, reminderHour }, 'Scheduled weekly reminder');
}

/**
 * Initialize the reminder scheduler by reading all active groups with a reminderDay set.
 * Called once at bot startup.
 */
export function initReminderScheduler(): void {
  const activeGroups = getActiveGroups();
  let scheduled = 0;

  for (const group of activeGroups) {
    if (!group.reminderDay) continue;

    scheduleGroupReminder(
      group.id,
      group.name ?? null,
      group.reminderDay,
      group.reminderHour ?? 9,
      group.calendarLink ?? null,
    );
    scheduled++;
  }

  logger.info({ count: scheduled }, 'Reminder scheduler initialized');
}

/**
 * Stop all existing jobs and re-initialize from DB.
 * Call when group configuration changes (e.g. via dashboard).
 */
export function refreshScheduler(): void {
  scheduledJobs.forEach((job) => job.stop());
  scheduledJobs.clear();
  logger.info('Reminder scheduler refreshed');
  initReminderScheduler();
}
