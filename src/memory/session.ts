import type { PropertyFilters } from "../agents/propertySearch/parser.ts";

/**
 * Per-user conversation state (Week 4). In memory, so it resets when the
 * process restarts; revisit before the WhatsApp weeks.
 *
 * Writers: propertySearch (filters), semanticSearch (lastResults, city).
 * Readers: all agents (city as a fallback location).
 */
export interface UserSession extends Partial<PropertyFilters> {
  lastResults?: unknown[];
  conversationStep: number;
}

const sessions = new Map<string, UserSession>();

export function getSession(userId: string): UserSession {
  let s = sessions.get(userId);
  if (!s) {
    s = { conversationStep: 0 };
    sessions.set(userId, s);
  }
  return s;
}

export function updateSession(userId: string, updates: Partial<UserSession>) {
  sessions.set(userId, { ...getSession(userId), ...updates });
}

export function clearSession(userId: string) {
  sessions.delete(userId);
}
