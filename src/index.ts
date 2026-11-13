import { marketStatsAgent } from "./agents/marketStats/agent.ts";
import { isMarketQuestion } from "./agents/marketStats/parser.ts";
import { propertySearchAgent } from "./agents/propertySearch/agent.ts";
import { semanticSearchAgent } from "./agents/semanticSearch/agent.ts";
import { isSemanticQuery } from "./agents/semanticSearch/intent.ts";
import type { AgentResult } from "./types.ts";

/**
 * Temporary keyword router. Step 2 (the OpenClaw tool plugin) replaces this:
 * OpenClaw's LLM will choose the agent instead of these heuristics.
 */
export async function route(text: string, userId: string): Promise<AgentResult> {
  if (isMarketQuestion(text)) return marketStatsAgent(text, userId); // Week 5
  if (isSemanticQuery(text)) return semanticSearchAgent(text, userId); // Week 6
  return propertySearchAgent(text, userId); // Weeks 2–4
}

/** Back-compat entry point used by the tests: { message | text, userId | from }. */
export async function handleOpenClawPayload(payload: {
  message?: string;
  text?: string;
  userId?: string;
  from?: string;
}): Promise<AgentResult | { response: string }> {
  try {
    const text = payload.message || payload.text || "";
    const userId = payload.userId || payload.from || "local_dev_user";
    return await route(text, userId);
  } catch (error) {
    console.error("Error handling payload:", error);
    return { response: "An error occurred while processing your request." };
  }
}
