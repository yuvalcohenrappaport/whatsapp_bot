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
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});
