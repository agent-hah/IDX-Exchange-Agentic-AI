import { handleMessage } from "./skills/searchSkill.ts";
import { marketStatsAgent } from "./skills/marketStatsSkill.ts";
import { isMarketQuestion } from "./skills/marketParser.ts";

/* Temporary OpenClaw router until the Week 9 orchestrator replaces it. */
export async function handleOpenClawPayload(payload: any) {
  try {
    const text = payload.message || payload.text || "";
    const userId = payload.userId || payload.from || "local_dev_user";

    if (isMarketQuestion(text)) {
      return await marketStatsAgent(text, userId);
    }
    return await handleMessage(text, userId);
  } catch (error) {
    console.error("Error handling OpenClaw payload:", error);
    return { response: "An error occurred while processing your request." };
  }
}
