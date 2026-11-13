/**
 * The one shape every agent returns. The router (and later the OpenClaw
 * plugin and the Week 9 orchestrator) can rely on it without knowing which
 * agent answered.
 */

export type AgentIntent = "property_search" | "market_stats" | "semantic_search";

export type AgentStatus =
  | "success" // answered with data
  | "needs_input" // asked the user a follow-up question
  | "empty" // query ran, nothing matched
  | "not_ready" // a prerequisite is missing (e.g. no embeddings yet)
  | "error";

export interface AgentResult<D = unknown> {
  status: AgentStatus;
  intent: AgentIntent;
  /** Ready-to-send text (WhatsApp formatting). */
  response: string;
  /** Structured payload for other agents/orchestration. */
  data?: D;
}
