import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(), // WhatsApp message key.id — dedup key
    contactJid: text('contact_jid').notNull(),
    fromMe: integer('from_me', { mode: 'boolean' }).notNull(),
    body: text('body').notNull().default(''),
    timestamp: integer('timestamp').notNull(), // Unix ms
    processed: integer('processed', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_messages_contact_ts').on(table.contactJid, table.timestamp),
  ],
);

export const contacts = sqliteTable('contacts', {
  jid: text('jid').primaryKey(),
  name: text('name'),
  mode: text('mode').notNull().default('off'), // 'off' | 'draft' | 'auto'
  relationship: text('relationship'),
  customInstructions: text('custom_instructions'),
  styleSummary: text('style_summary'), // Gemini-generated style analysis text, nullable
  snoozeUntil: integer('snooze_until'), // Unix ms timestamp for snooze expiry, null = not snoozed
  consecutiveAutoCount: integer('consecutive_auto_count').default(0), // counter for auto-reply cap
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(), // UUID
  contactJid: text('contact_jid').notNull(),
  inReplyToMessageId: text('in_reply_to_message_id').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'rejected'
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  actionedAt: integer('actioned_at'),
});
