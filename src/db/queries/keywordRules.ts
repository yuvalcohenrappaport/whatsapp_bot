import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import { keywordRules } from '../schema.js';

export function getKeywordRulesByGroup(groupJid: string) {
  return db
    .select()
    .from(keywordRules)
    .where(eq(keywordRules.groupJid, groupJid))
    .all();
}

export function getActiveKeywordRulesByGroup(groupJid: string) {
  return db
    .select()
    .from(keywordRules)
    .where(
      and(
        eq(keywordRules.groupJid, groupJid),
        eq(keywordRules.enabled, true),
      ),
    )
    .all();
}

export function getKeywordRuleById(id: string) {
  return db
    .select()
    .from(keywordRules)
    .where(eq(keywordRules.id, id))
    .get();
}

export function createKeywordRule(rule: {
  id: string;
  groupJid: string;
  name: string;
  pattern: string;
  isRegex: boolean;
  responseType: string;
  responseText: string | null;
  aiInstructions: string | null;
  cooldownMs: number;
}) {
  return db.insert(keywordRules).values(rule).run();
}

export function updateKeywordRule(
  id: string,
  patch: Partial<{
    name: string;
    pattern: string;
    isRegex: boolean;
    responseType: string;
    responseText: string | null;
    aiInstructions: string | null;
    enabled: boolean;
    cooldownMs: number;
  }>,
) {
  return db
    .update(keywordRules)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(keywordRules.id, id))
    .run();
}

export function deleteKeywordRule(id: string) {
  return db.delete(keywordRules).where(eq(keywordRules.id, id)).run();
}

export function incrementMatchCount(id: string) {
  const rule = db
    .select({ matchCount: keywordRules.matchCount })
    .from(keywordRules)
    .where(eq(keywordRules.id, id))
    .get();

  if (rule) {
    db.update(keywordRules)
      .set({
        matchCount: rule.matchCount + 1,
        lastTriggeredAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(keywordRules.id, id))
      .run();
  }
}
