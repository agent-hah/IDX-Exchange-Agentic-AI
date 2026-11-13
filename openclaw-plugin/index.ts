/**
 * OpenClaw tool plugin: exposes the IDX agents as tools OpenClaw's model can call.
 *
 *   openclaw plugins install --link ./openclaw-plugin
 *
 * OpenClaw's model decides which tool fits a message (this replaces the
 * keyword router in src/index.ts) and fills in structured fields it
 * understood; those override the agents' regex parsers. Each conversation
 * gets its own session state, keyed by OpenClaw's session key.
 *
 * Tools are "direct-only" so the model always sees them, even when OpenClaw's
 * Code Mode would otherwise hide plugin tools behind a searchable catalog.
 *
 * The entry is a plain object with register(api), so it needs no runtime
 * import from the OpenClaw SDK, and OpenClaw loads this TypeScript directly
 * (no build step) for linked local installs.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { config, envFilePath, loadEnvFile } from "../src/config.ts";
import { marketStatsAgent } from "../src/agents/marketStats/agent.ts";
import type { MarketFilters } from "../src/agents/marketStats/queries.ts";
import { propertySearchAgent } from "../src/agents/propertySearch/agent.ts";
import type { PropertyFilters } from "../src/agents/propertySearch/parser.ts";
import { semanticSearchAgent } from "../src/agents/semanticSearch/agent.ts";
import type { HardFilters } from "../src/agents/semanticSearch/search.ts";
import { clearSession } from "../src/memory/session.ts";
import type { AgentResult } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Minimal local types for the parts of the OpenClaw plugin API we use
// (see openclaw/src/plugins/tool-types.ts for the full definitions).
// ---------------------------------------------------------------------------
interface ToolContext {
  sessionKey?: string;
  sessionId?: string;
  requesterSenderId?: string;
  nativeChannelId?: string;
}
interface ToolResult {
  content: { type: "text"; text: string }[];
  details?: unknown;
}
interface AgentTool {
  name: string;
  label?: string;
  description: string;
  parameters: JsonSchema;
  /**
   * "direct-only" keeps the tool in the model's tool list even when Code Mode /
   * Tool Search is active. Without it the tool sits in a searchable catalog,
   * and smaller models answer from memory instead of finding it.
   */
  catalogMode?: "direct-only";
  execute: (toolCallId: string, params: any, signal?: AbortSignal) => Promise<ToolResult>;
}
interface PluginApi {
  /** Original entry file (OpenClaw may run a copy from a temp folder). */
  source?: string;
  rootDir?: string;
  pluginConfig?: Record<string, unknown>;
  registerTool: (factory: (ctx: ToolContext) => AgentTool, opts: { name: string }) => void;
}
type JsonSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const PROPERTY_TYPES = ["SingleFamilyResidence", "Condominium", "Townhouse"] as const;

const str = (description: string): JsonSchema => ({ type: "string", description });
const int = (description: string, minimum = 0): JsonSchema => ({ type: "integer", minimum, description });
const propertyType: JsonSchema = {
  type: "string",
  enum: [...PROPERTY_TYPES],
  description: "Property type, only if the user named one: SingleFamilyResidence (houses), Condominium (condos) or Townhouse (townhomes).",
};
const propertyTypes: JsonSchema = {
  type: "array",
  items: { type: "string", enum: [...PROPERTY_TYPES] },
  minItems: 1,
  uniqueItems: true,
  description:
    "Property types the user asked for; include every one they named (e.g. condos AND townhomes → [\"Condominium\", \"Townhouse\"]). " +
    "SingleFamilyResidence = houses. Omit if the user didn't specify a type.",
};
const ONLY_IF_STATED = " Only set this if the user stated it; never guess or fill in a default.";

/**
 * One isolated search session per OpenClaw conversation. OpenClaw's sessionId
 * is regenerated on /new and /reset, so a fresh chat starts with no remembered
 * budget or filters; sessionKey stays the same for a WhatsApp chat across /new.
 */
export function sessionIdFor(ctx: ToolContext): string {
  return `openclaw:${ctx.sessionId ?? ctx.sessionKey ?? ctx.requesterSenderId ?? ctx.nativeChannelId ?? "default"}`;
}

const GUIDANCE: Record<AgentResult["status"], string> = {
  success: "Answer the user from this result. You may shorten or reformat it for chat, but do not add listings, prices or statistics that are not in it.",
  needs_input: "The search needs more information. Ask the user this follow-up question, then call the same tool again with their answer.",
  empty: "Nothing matched. Tell the user, and suggest loosening the criteria as described. Do not make up listings.",
  not_ready: "This feature is not set up yet. Tell the user what is missing.",
  error: "The MLS database could not be queried (MySQL offline or misconfigured). Tell the user the data is temporarily unavailable. Do not answer from general knowledge.",
};

/** What the model sees: status + how to use it + the agent's reply. */
export function toToolResult(r: AgentResult): ToolResult {
  return {
    content: [{ type: "text", text: `status: ${r.status}\n${GUIDANCE[r.status]}\n---\n${r.response}` }],
    details: { status: r.status, intent: r.intent, data: r.data ?? null },
  };
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}

async function safely(intent: AgentResult["intent"], run: () => Promise<AgentResult>): Promise<ToolResult> {
  try {
    return toToolResult(await run());
  } catch (err) {
    console.error(`[idx-exchange] ${intent} failed:`, err);
    return toToolResult({ status: "error", intent, response: "The MLS data source could not be reached." });
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export const TOOL_NAMES = ["idx_property_search", "idx_market_stats", "idx_semantic_search"] as const;

function propertySearchTool(ctx: ToolContext): AgentTool {
  return {
    name: "idx_property_search",
    label: "MLS property search",
    catalogMode: "direct-only",
    description:
      "Search ACTIVE California MLS listings (rets_property) by concrete criteria: city, max price, bedrooms, bathrooms, square feet, property type, pool, view. " +
      "Use for requests like 'find 3-bed condos in Irvine'. Multi-turn: if the result asks a follow-up (budget, bedrooms), ask the user and call again with THEIR answer; never invent a budget or bedroom count to skip the question. " +
      "Set newSearch=true when the user starts a different search. Always use this instead of general knowledge for current listings.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: str("The user's request, copied in their own words."),
        newSearch: { type: "boolean", description: "True to forget earlier search criteria in this conversation and start over." },
        city: str("California city, e.g. 'Irvine'."),
        maxPrice: int("The user's maximum price, converted to whole dollars (they say '$850K' → 850000)." + ONLY_IF_STATED),
        minBeds: int("Minimum bedrooms." + ONLY_IF_STATED),
        minBaths: { type: "number", minimum: 0, description: "Minimum bathrooms (half baths allowed, e.g. 2.5)." + ONLY_IF_STATED },
        minSqft: int("Minimum living area in square feet." + ONLY_IF_STATED),
        propertyTypes,
        pool: { type: "boolean", description: "True if a private pool is required." },
        view: { type: "boolean", description: "True if a view is required." },
      },
    },
    async execute(_id, p) {
      return safely("property_search", async () => {
        const userId = sessionIdFor(ctx);
        if (p.newSearch) clearSession(userId);
        const hints: Partial<PropertyFilters> = definedOnly({
          city: p.city,
          maxPrice: p.maxPrice,
          beds: p.minBeds,
          baths: p.minBaths,
          sqft: p.minSqft,
          types: Array.isArray(p.propertyTypes) && p.propertyTypes.length ? p.propertyTypes : undefined,
          pool: p.pool ? "True" : undefined,
          hasView: p.view ? "True" : undefined,
        }) as Partial<PropertyFilters>;
        return propertySearchAgent(String(p.query ?? ""), userId, hints);
      });
    },
  };
}

function marketStatsTool(ctx: ToolContext): AgentTool {
  return {
    name: "idx_market_stats",
    label: "California market stats",
    catalogMode: "direct-only",
    description:
      "Market analytics from closed California sales (california_sold): median and average price, price per sq ft, days on market, list-to-close ratio, " +
      "months of supply, monthly trend and a buyer's/seller's market read, for a city, ZIP code or property type. " +
      "Use for questions like 'is now a good time to buy in San Diego?', 'average price per sq ft in Pasadena', 'are prices rising in Irvine?'. " +
      "With no city or ZIP it returns the most active markets statewide.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: str("The user's question in their own words."),
        city: str("California city, e.g. 'Pasadena'."),
        zip: { type: "string", pattern: "^9[0-6][0-9]{3}$", description: "California ZIP code, e.g. '92618'." },
        propertyType,
        months: { type: "integer", minimum: 1, maximum: 48, description: "Length of the analysis window in months (default 12)." },
      },
    },
    async execute(_id, p) {
      return safely("market_stats", async () => {
        const hints: Partial<MarketFilters> = definedOnly({
          city: p.city,
          zip: p.zip,
          subType: p.propertyType,
          months: p.months,
        }) as Partial<MarketFilters>;
        return marketStatsAgent(String(p.question ?? ""), sessionIdFor(ctx), hints);
      });
    },
  };
}

function semanticSearchTool(ctx: ToolContext): AgentTool {
  return {
    name: "idx_semantic_search",
    label: "Describe-a-home search",
    catalogMode: "direct-only",
    description:
      "Find the 5 active California listings that best match a free-text DESCRIPTION of a home's style, feel or features " +
      "(e.g. 'charming craftsman with mountain views and character', 'modern open floor plan with a big backyard'), using embeddings of the listing remarks. " +
      "Optional hard limits (city, max price, beds, baths, sqft, type) narrow the candidates first. " +
      "Use this when the request is about style or features; use idx_property_search for plain criteria.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["description"],
      properties: {
        description: str("What the user is looking for, in their words."),
        city: str("California city to restrict to."),
        maxPrice: int("The user's maximum price, converted to whole dollars." + ONLY_IF_STATED),
        minBeds: int("Minimum bedrooms." + ONLY_IF_STATED),
        minBaths: { type: "number", minimum: 0, description: "Minimum bathrooms." + ONLY_IF_STATED },
        minSqft: int("Minimum living area in square feet." + ONLY_IF_STATED),
        propertyTypes,
      },
    },
    async execute(_id, p) {
      return safely("semantic_search", async () => {
        const hints: Partial<HardFilters> = definedOnly({
          city: p.city,
          maxPrice: p.maxPrice,
          beds: p.minBeds,
          baths: p.minBaths,
          sqft: p.minSqft,
          types: Array.isArray(p.propertyTypes) && p.propertyTypes.length ? p.propertyTypes : undefined,
        }) as Partial<HardFilters>;
        return semanticSearchAgent(String(p.description ?? ""), sessionIdFor(ctx), hints);
      });
    },
  };
}

const expandHome = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/**
 * OpenClaw runs a copy of this plugin from ~/.openclaw/tmp, so the .env can't
 * be found relative to the running file. Find the repo's .env from the
 * plugin's real install location instead (or an explicit envFile setting).
 */
export function loadProjectEnv(api: Pick<PluginApi, "source" | "rootDir" | "pluginConfig">): string | null {
  const explicit = api.pluginConfig?.envFile;
  const candidates = [
    typeof explicit === "string" && explicit ? expandHome(explicit) : null,
    api.source ? join(dirname(expandHome(api.source)), "..", ".env") : null,
    api.rootDir ? join(expandHome(api.rootDir), "..", ".env") : null,
  ].filter((p): p is string => Boolean(p));
  const used = candidates.find((p) => loadEnvFile(p)) ?? null;
  if (used) {
    const db = config.mysql;
    console.log(`[idx-exchange] settings from ${used} (MySQL ${db.user}@${db.host}:${db.port}/${db.database})`);
  } else {
    console.warn(
      `[idx-exchange] no .env found (tried ${candidates.join(", ") || "nothing"}; current: ${envFilePath() ?? "none"}). ` +
        `Set it with: openclaw config set plugins.entries.idx-exchange.config.envFile /path/to/IDX-Exchange/.env`,
    );
  }
  return used;
}

const plugin = {
  id: "idx-exchange",
  name: "IDX Exchange Real Estate",
  description: "California MLS property search, market statistics and semantic search over the IDX Exchange datasets.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      envFile: { type: "string", description: "Path to the IDX-Exchange .env (defaults to the repo's .env next to the plugin)." },
    },
  },
  register(api: PluginApi) {
    loadProjectEnv(api);
    api.registerTool((ctx) => propertySearchTool(ctx), { name: "idx_property_search" });
    api.registerTool((ctx) => marketStatsTool(ctx), { name: "idx_market_stats" });
    api.registerTool((ctx) => semanticSearchTool(ctx), { name: "idx_semantic_search" });
  },
};

export default plugin;
