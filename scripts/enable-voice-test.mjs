// Temporary script: Enable voice for testing (14-02)
// Uses better-sqlite3 directly to avoid importing the full app

import Database from 'better-sqlite3';

const db = new Database('./data/bot.db');

// Step 1: Check/set voice_replies_enabled in settings
const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'voice_replies_enabled'").get();
console.log(`\n--- Settings ---`);
console.log(`Current voice_replies_enabled: ${settingRow ? settingRow.value : '(not set)'}`);

if (!settingRow || settingRow.value !== 'true') {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('voice_replies_enabled', 'true')").run();
  console.log(`Updated voice_replies_enabled to 'true'`);
} else {
  console.log(`Already set to 'true' — no change needed`);
}

// Verify
const verify1 = db.prepare("SELECT value FROM settings WHERE key = 'voice_replies_enabled'").get();
console.log(`Verified: voice_replies_enabled = ${verify1.value}`);

// Step 2: Find auto-mode contacts
console.log(`\n--- Auto-mode contacts ---`);
const autoContacts = db.prepare("SELECT jid, name, mode, voice_reply_enabled FROM contacts WHERE mode = 'auto'").all();

if (autoContacts.length === 0) {
  console.log('ERROR: No contacts in auto mode found!');
  process.exit(1);
}

for (const c of autoContacts) {
  console.log(`  JID: ${c.jid}, Name: ${c.name}, Mode: ${c.mode}, VoiceEnabled: ${c.voice_reply_enabled}`);
}

// Step 3: Enable voice for the first auto-mode contact (if not already enabled)
const target = autoContacts[0];
if (target.voice_reply_enabled === 1) {
  console.log(`\nContact ${target.name} (${target.jid}) already has voice enabled`);
} else {
  db.prepare("UPDATE contacts SET voice_reply_enabled = 1 WHERE jid = ?").run(target.jid);
  console.log(`\nEnabled voice for: ${target.name} (${target.jid})`);
}

// Verify
const verify2 = db.prepare("SELECT jid, name, voice_reply_enabled FROM contacts WHERE voice_reply_enabled = 1").all();
console.log(`\n--- Contacts with voice enabled ---`);
for (const c of verify2) {
  console.log(`  JID: ${c.jid}, Name: ${c.name}, VoiceEnabled: ${c.voice_reply_enabled}`);
}

db.close();
console.log('\nDone. Database updated successfully.');
