# IDX Exchange Multi-Agent Real Estate Assistant
## System Architecture & Workflow Documentation

This document outlines the architecture and execution flow for the production-grade multi-agent AI assistant built on the OpenClaw orchestration framework. The system handles natural language property searches, market analytics, and semantic recommendations by interacting with real-world Multiple Listing Service (MLS) datasets.

---

## 1. High-Level Workflow Diagram

The system operates on a linear, multi-step execution flow to process incoming requests and generate grounded data responses. 

```text
User WhatsApp  
      │
      ▼
OpenClaw Runtime (Channel Interface)
      │
      ▼
Orchestrator (Intent Routing)
      │
      ▼
Skill Selector 
      │
      ▼
Tool Execution (Database & APIs)
      │
      ▼
Memory Update (Session State)
      │
      ▼
Response User (WhatsApp)
```

### Request Lifecycle
1. **Ingestion:** A user sends a message via the WhatsApp communication channel.
2. **Runtime & Orchestration:** The OpenClaw runtime receives the payload and passes it to the Orchestrator, which acts as a central coordinator. The Orchestrator analyzes the query to determine the user's intent (e.g., search, market, recommend, or mixed) and routes it to the correct specialized agent.
3. **Skill & Tool Execution:** The target Skill evaluates the request and triggers typed async Tools. These tools translate the natural language intent into actionable code, such as parameterized MySQL queries or OpenAI embedding generation.
4. **Data Retrieval:** The tools execute against the core MLS datasets (`rets_property` for active listings or `california_sold` for historical comps). 
5. **Memory & State:** The agent updates the per-user Session Memory with the latest context and search results to support multi-turn conversational follow-ups.
6. **Delivery:** The structured data is synthesized into a formatted text response and returned to the user via WhatsApp.

---

## 2. Core Architectural Components

The OpenClaw runtime manages several modular components to ensure seamless multi-agent functionality:

* **Channels:** The communication interfaces that connect the AI to the user. The primary channels are WhatsApp (for real-time chat) and Email (for alerts and reports).
* **Orchestrator:** The routing engine responsible for analyzing incoming natural language queries and directing them to the appropriate specialized skill or agent. It can also split complex "mixed-intent" queries across multiple agents.
* **Sessions:** The per-user tracking layer that maintains conversation state, allowing the agent to remember applied filters, budget constraints, and recent property results across multi-turn interactions.
* **Skills:** Modular units of capability assigned to specific tasks, such as property search, generating market statistics, or executing Retrieval-Augmented Generation (RAG).
* **Tools:** Typed asynchronous functions that agents call to perform concrete actions, such as fetching current time, executing database queries, or generating vector embeddings.
* **Memory:** The storage system managing both short-term session state and long-term vector embeddings for semantic search.

---

## 3. Specialized Skill Directory

The Orchestrator dynamically equips the core cognitive engine with modular skills to handle diverse user intents. By hot-swapping these capability packages, the system can execute the following specialized workflows:

- **Property Search Skill:** Parses free-text queries into structured filters (e.g., city, price, beds) and executes them against the active listings table.
- **Market Stats Skill:** Aggregates historical transaction data to provide trends, average days on market, and list-to-close ratios.
- **Recommendation Skill:** Generates hybrid similarity scores (combining structured SQL filters and vector embeddings) to surface similar properties, validating list prices against recent comps.
- **RAG Skill:** Answers conceptual questions regarding real estate terminology and MLS field definitions using indexed source documents.
- **Email Draft Skill:** Composes formatted property or market summaries for email delivery.

---

## 4. Data Layer

The system connects to a local MySQL schema.

* **`rets_property`:** The active listing database containing 130+ fields, used for live search and discovery. It features a `FULLTEXT` index on listing remarks to support semantic vector search.
* **`california_sold`:** The historical comps table containing 46 fields, utilized for market analytics, trend validation, and price modeling.

See [Section 10](#10-data-notes) for what the local copy of the data actually contains. Week 6 adds a third table, `listing_embeddings` ([Section 7](#7-week-6-embeddings--semantic-search)).

---

## Summary

At a high level, OpenClaw takes the user's request from a conversation channel that holds the session (WhatsApp, in our case) and hands it to the Orchestrator. The Orchestrator activates the appropriate skill, which supplies the context and tools needed to query the database. The results are saved in session memory and used to answer the query, and the answer goes back to the user through the same channel.

---

## 5. Current Implementation (Weeks 2–6)

Sections 1–4 describe the target design. This section describes what is built today.

### Request flow

```text
message text + userId
      │
      ▼
src/index.ts  route(text, userId)
      │  keyword router for tests/scripts; in OpenClaw the model chooses (Section 8)
      │
      ├── isMarketQuestion(text)? ──yes──► marketStatsAgent()     (Week 5)
      │                                        └── california_sold, rets_property (inventory)
      │
      ├── isSemanticQuery(text)?  ──yes──► semanticSearchAgent()  (Week 6)
      │                                        └── Gemini (query embedding), listing_embeddings, rets_property
      │
      └── otherwise ─────────────────────► propertySearchAgent()  (Weeks 2–4)
                                               └── rets_property
      ▼
AgentResult { status, intent, response, data? }
```

In production, messages don't go through `route()`: OpenClaw's model picks the agent by calling one of the plugin's tools (see [Section 8](#8-openclaw-integration)). `route()` remains for tests and local scripts.

Every agent lives in its own folder under `src/agents/` and follows the same three layers: **parse** free text into a typed filter object (`parser.ts`), **query** MySQL with parameterized SQL (`queries.ts`), then **format** the result for WhatsApp (`agent.ts`). Every agent returns the same `AgentResult` type (`src/types.ts`):

| Field | Meaning |
|---|---|
| `status` | `success`, `needs_input` (asked a follow-up), `empty` (nothing matched), `not_ready` (e.g. no embeddings yet), `error` |
| `intent` | `property_search`, `market_stats`, `semantic_search` |
| `response` | ready-to-send WhatsApp text |
| `data` | structured payload, so other agents and the orchestrator can reuse results without re-querying |

Shared code lives outside the agent folders: `db/` (connection pool, and `listingFilters.ts`, the one place filters become SQL over `rets_property`), `embeddings/`, `memory/`, `utils/format.ts`, and `config.ts` (every environment setting).

### Code map

| File | Week | Responsibility |
|---|---|---|
| `src/index.ts` | — | Temporary keyword router: `route(text, userId)` → agent |
| `src/config.ts` | — | All environment settings, read once from `.env` |
| `src/types.ts` | — | `AgentResult`, `AgentStatus`, `AgentIntent` |
| `src/db/connection.ts` | 3 | mysql2 connection pool; `query<T>(sql, params)` |
| `src/db/listingFilters.ts` | 3/6 | `activeListingWhere()`: filters → SQL over active `rets_property` listings |
| `src/memory/session.ts` | 4 | In-memory per-user `UserSession` |
| `src/utils/format.ts` | — | `fmtPrice`, `fmtMoney`, `fmtPct`, `fmtInt`, `fmtMonth`, `fmtDate` |
| `src/agents/propertySearch/parser.ts` | 2 | `parsePropertyQuery()`, `extractCity()` |
| `src/agents/propertySearch/queries.ts` | 3 | `searchActiveListings()` (≤ 50 rows); `getSoldComps()` (anchored on the data's latest close date) |
| `src/agents/propertySearch/agent.ts` | 4 | `propertySearchAgent()`: session merge, follow-ups, property cards |
| `src/agents/marketStats/parser.ts` | 5 | `isMarketQuestion()`, `parseMarketQuery()` |
| `src/agents/marketStats/queries.ts` | 5 | Market analytics SQL; `getMarketReport()` |
| `src/agents/marketStats/agent.ts` | 5 | `marketStatsAgent()`, WhatsApp formatting, `marketRead()` |
| `src/agents/semanticSearch/intent.ts` | 6 | `isSemanticQuery()` |
| `src/agents/semanticSearch/search.ts` | 6 | `semanticSearch()`, `candidateIds()`, reusable `rankBySimilarity()`, `fetchListings()` |
| `src/agents/semanticSearch/agent.ts` | 6 | `semanticSearchAgent()`: cards + session results |
| `src/embeddings/gemini.ts` | 6 | Gemini `batchEmbedContents` client: task prefixes, rate limiting, 429 retries, daily-quota stop |
| `src/embeddings/listingText.ts` | 6 | `buildListingText()`; `textHash()` for change detection |
| `src/embeddings/store.ts` | 6 | `listing_embeddings` table, upserts, in-memory `VectorIndex` |
| `src/embeddings/vectorMath.ts` | 6 | normalize, dot product, float32 ⇄ BLOB, top-k |
| `src/scripts/buildListingEmbeddings.ts` | 6 | Resumable indexer (`npm run embed:listings`) |
| `src/scripts/exportMarketReports.ts` | 5→8 | Per-city Markdown summaries for RAG indexing |
| `openclaw-plugin/index.ts` | — | OpenClaw tool plugin: three tools wrapping the agents |
| `openclaw-plugin/openclaw.plugin.json` | — | Plugin manifest: tool contracts, bundled skill |
| `openclaw-plugin/skills/idx-real-estate/SKILL.md` | — | Instructions for OpenClaw's agent: which tool, how to answer |
| `test/unit/*.test.ts` | — | `npm test`: no database or API key |
| `test/integration/*.test.ts` | — | `npm run test:db`, `npm run test:semantic` |

### Sessions

`session.ts` holds one `UserSession` per `userId` in a `Map`. It stores the accumulated property filters, `lastResults` (the last listings shown, written by property search and semantic search), and `conversationStep`. State lives in memory, so it resets when the process restarts. The Week 5 market agent reads the session's `city` to answer follow-ups like *"how's the market there?"*, but never writes to the session. The Week 6 semantic agent reads `city` too, and writes `lastResults` (and `city`, when the query names one) so the Week 7 recommendation engine can find listings similar to one the user just saw.

---

## 6. Week 5: Market Statistics Agent

### Goal

Answer market questions (*"Is now a good time to buy in San Diego?"*, *"What is the average price per sq ft in Pasadena?"*) with data-backed summaries from `california_sold`: median price, days on market, list-to-close ratio, and a monthly trend for any California city.

### Pipeline

```text
"Median price for condos in Irvine over the last 6 months"
      │
      ▼ marketStats/parser.ts  parseMarketQuery()
{ city: "Irvine", zip: null, subType: "Condominium", months: 6 }
      │
      ▼ marketStats/queries.ts  getMarketReport()   (runs these in parallel)
  getMarketSummary(current window)   ─┐
  getMarketSummary(prior-year window) ├─ california_sold
  getMonthlyTrend(current window)    ─┘
  getActiveInventory()               ─── rets_property
      │
      ▼ marketStats/agent.ts  formatReportForWhatsApp() + marketRead()
📊 Irvine · Condos — Market Snapshot ...
```

- **Location fallback:** if the message has no city or ZIP, the agent uses the city in the user's search session. If there's still none, it returns a leaderboard of the 10 busiest cities (`getCityLeaderboard()`).
- **Edge cases:** unknown locations get a "check the spelling" reply, and windows with fewer than 10 sales get a small-sample warning.

### Metrics

| Metric | Definition |
|---|---|
| Median / average close price | `ClosePrice`; median is the headline because a few luxury sales skew the average |
| Price per sq ft | `ClosePrice / LivingArea`, only where `LivingArea >= 200` |
| Days on market (DOM) | `DaysOnMarket`, median and average (negative values excluded) |
| List-to-close ratio | `ClosePrice / ListPrice` × 100; above 100% means homes sell over asking |
| Original-list-to-close | `ClosePrice / OriginalListPrice` × 100; captures price cuts before the sale |
| % sold at/above list | Share of sales with `ClosePrice >= ListPrice` |
| Months of supply | Active `rets_property` listings ÷ average monthly sales in the window |
| Monthly trend | Per-month sales, median and average price, $/sqft, DOM, list-to-close, and month-over-month change in median price |
| YoY | Same metrics vs. the same window one year earlier (only when the data covers it) |

Ratios outside 0.5–1.5 are treated as data-entry errors and excluded. This handles rows where, for example, `ListPrice = 1`.

### Key design decisions

1. **Windows end at the latest close date in the data, not on `CURDATE()`.** `california_sold` is a static snapshot, so "last 12 months from today" would return nothing once the data ages. The window ends at the latest residential `CloseDate` up to today; dates after today are typos and are ignored. `MARKET_ANCHOR_DATE` in `.env` can pin the end date.
2. **The report knows how much data the window actually covers.** If the requested window starts before the data does, the report:
   - shows the real date range in the header
   - computes months of supply from the months actually covered
   - hides YoY when no full prior year exists, and shows the change between the first and last full months instead
3. **Partial months are flagged.** A month that is only partly inside the window or the data is marked *(partial)* and gets no month-over-month %. Half a month of sales isn't comparable to a full one.
4. **Medians are computed with window functions.** MySQL has no `MEDIAN()`, so each median ranks rows with `ROW_NUMBER() OVER (ORDER BY v)` and averages the middle one or two. Per-month medians do the same with `PARTITION BY` month. This requires MySQL 8.0+.
5. **Dates are compared as strings.** `CloseDate` is a `VARCHAR` in `YYYY-MM-DD` format, which sorts correctly as text, so window filters compare strings directly.
6. **The market read is explainable.** Three signals each vote seller (+1) or buyer (−1):
   - list-to-close ≥ 100% votes seller; ≤ 97% votes buyer
   - median DOM ≤ 21 days votes seller; ≥ 45 days votes buyer
   - months of supply < 3 votes seller; > 6 votes buyer

   The sum maps to Seller's / Leaning seller's / Balanced / Leaning buyer's / Buyer's market, and only the reasons that agree with the label are shown.

### Report object

`getMarketReport()` returns a `MarketReport` with these fields:
- `filters` and `window`
- `coverage` (data start, months covered, whether the window was truncated, whether YoY is available)
- `current` and `priorYear` summaries, plus `yoy` and `window_change`
- `trend`, a list of `TrendPoint`
- `inventory`

The agent returns it as `data`, so later weeks can reuse it:
- **Week 7:** comp validation uses the same `california_sold` patterns.
- **Week 8:** `npm run export:market` turns reports into Markdown for RAG.
- **Week 9:** the orchestrator calls `marketStatsAgent` for market and mixed-intent questions.
- **Week 11:** the weekly market report email.

### Testing

- `npm test` (`test/unit/marketParser.test.ts`) runs 19 checks on parsing and intent detection; no database needed.
- `npm run test:db` (`test/integration/marketStats.test.ts`) runs live against MySQL:
  - six sample questions, covering city, ZIP, condo filter, no location, and unknown city
  - sanity checks on the numbers
  - a cross-check of the SQL median against one computed in TypeScript
  - checks that the trend matches the covered months, YoY is suppressed without a prior year, months of supply is right, and partial months have no %
  - routing checks through `route()`

---

## 7. Week 6: Embeddings & Semantic Search

### Goal

Go beyond keyword filters: a query like *"charming craftsman with mountain views and character"* should find matching listings even when no listing uses those exact words. Deliverable: a skill that takes a free-text description and returns the **top 5 most similar active listings** from `rets_property`, ranked by embedding cosine similarity.

### Design

```text
INDEXING (once, offline)                          SEARCH (every query)
──────────────────────────                        ─────────────────────────────
rets_property (Active)                            "charming craftsman with mountain views"
   │ buildListingText()                               │ parsePropertyQuery() → hard filters
   ▼                                                  │   (city, max price, beds, baths, sqft, type)
"Single Family Residence in Pasadena, CA.             │ embedQuery() ── 1 Gemini call
 3 beds, 2 baths, 1850 sq ft, built 1924.             ▼
 Price $1,495,000. Style: Craftsman. ..."         query vector (768-d, normalized)
   │ embedBatch() ── Gemini batchEmbedContents        │ candidateIds() ── SQL over rets_property
   ▼                                                  ▼
listing_embeddings (MySQL BLOBs)  ── load ──►     in-memory VectorIndex ── dot products ── top 5
                                                      │ fetchListings()
                                                      ▼
                                                  WhatsApp cards + session.lastResults
```

**Why embed listings once instead of per query** (the handbook's sample code embeds on the fly):
- Each search costs one API call instead of thousands.
- Search latency is one call plus milliseconds of math.
- Week 7 reuses the same stored vectors to find listings similar to a given listing.

### Model and settings

| Setting | Value | Why |
|---|---|---|
| Model | `gemini-embedding-2` | The project already uses a Gemini key; this is Google's current embedding model |
| Dimensions | 768 | One of Google's recommended sizes; 4× smaller than the 3072 default, with little quality loss |
| Task format | documents `title: <type in city> \| text: <listing>`; queries `task: search result \| query: <text>` | `gemini-embedding-2` takes the task as a text prefix instead of a `task_type` field |
| Normalization | Every vector is L2-normalized | Cosine similarity becomes a plain dot product |

All of these are configurable in `.env` (`GEMINI_EMBED_MODEL`, `EMBED_DIMS`). Vectors are tagged with model and dims, so switching either re-embeds automatically instead of mixing incompatible vectors.

### What gets embedded

`buildListingText()` combines the handbook's structured fields (type, city, beds, baths, sqft, year built, price) with the descriptive ones (`ArchitecturalStyle`, `View`, private pool, `AssociationAmenities`, `SubdivisionName`), then appends `L_Remarks`. Remarks are cleaned of HTML and entities and capped at 1,000 characters, cut at a sentence boundary when possible; the average is about 1,300. The cap keeps the full index around 15M tokens on the free tier, and the opening of a listing description is usually the most descriptive part.

### Storage

MySQL 8.4 has no vector column type, so `listing_embeddings` stores each vector as a `MEDIUMBLOB` of float32s:

| Column | Notes |
|---|---|
| `L_ListingID` | Primary key; copies `rets_property.L_ListingID`'s exact type and collation, so joins never fail |
| `model`, `dims` | Which embedding space the vector belongs to |
| `text_hash` | SHA-1 of the embedded text; unchanged listings are skipped on re-runs |
| `embedding` | 768 × 4 bytes ≈ 3 KB |

At search time, all vectors for the current model load into one flat `Float32Array`: 55K × 768 ≈ 170 MB, loaded in pages of 5,000. Scoring all of them takes tens of milliseconds, so a separate vector database isn't needed at this scale. The index reloads automatically when the row count changes, e.g. while the indexer is still running.

### Hybrid filtering

Pure semantic search ignores hard limits: a "$500K" in the query only nudges the vector. So before ranking, the Week 2 parser extracts city, max price, beds, baths, sqft and type, and SQL narrows the candidates to active listings that satisfy them. Two details:
- **City check:** the parsed city is checked against the actual `L_City` values, so a phrase like "in the hills" isn't treated as a city.
- **Left to the embedding:** pool and view are not hard filters, because the remarks describe them better than the Y/N flags.

### Indexer (`npm run embed:listings`)

- **Free tier pacing:** a sliding-window limiter keeps requests under `EMBED_TPM` tokens and `EMBED_RPM` requests per minute (defaults 25,000 and 90, below the free-tier limits). Batches are sized to half the per-minute token budget, at most 100 listings each.
- **429 errors:** retried after the delay Gemini suggests (`RetryInfo`), otherwise with exponential backoff.
- **Daily quota:** raises `DailyQuotaError`, and the run stops cleanly.
- **Resumable:** every batch is upserted as soon as it returns, and Ctrl-C finishes the current batch first. Re-running skips listings whose text hash, model and dims are unchanged.
- **Flags:** `--dry-run` (counts, time estimate, sample text), `--city` (repeatable), `--limit`, `--max-chars`, `--force`.

At the free-tier budget the full ~55K listings takes many hours, so the practical order is: a few cities first for development and demos, then the full run overnight.

### Routing

`isSemanticQuery()` strips everything the structured parser understands, plus filler words. That covers city, prices and numbers, beds/baths, sqft, property type, pool/view, and words like "find", "homes", "under". If two or more descriptive words remain, the query goes to semantic search:

| Message | Leftover words | Route |
|---|---|---|
| charming craftsman with mountain views and character | charming, craftsman, mountain, character | semantic |
| 3-bedroom condos in Irvine under $1.5M with a pool | (none) | structured |
| my maximum budget is 900k | (none) | structured |

Phrases like "similar to" or "vibe", and a `semantic:` prefix, force semantic search. Market questions are checked first. The Week 9 orchestrator will replace this heuristic with proper intent classification.

### Testing

- `npm test` (`test/unit/semantic.test.ts`) runs without a database or API key: routing cases, vector math (normalization, BLOB round-trip, unaligned buffers, top-k), listing-text building and hashing, and a **golden-hash guard**: the embedded text for a fixed sample listing must hash to a known value. If a code change alters the embedded text, this test fails before the indexer would silently re-embed everything.
- `npm run test:semantic` (`test/integration/semanticSearch.test.ts`) runs live:
  - four descriptive queries, including the handbook example
  - top-5 count, results sorted by similarity, similarities in range
  - hard filters respected (Pasadena, ≤ $2M)
  - re-embedding a stored listing reproduces its vector, and that listing finds itself in the top 3
  - routing across all three agents
- Before release, the indexer and search were also run against SQLite with a mock Gemini endpoint. That covered the request format, 429 retry, daily-quota stop, resume, skipping unchanged listings, `--force`, and filter handling.

---

## 8. OpenClaw Integration

### How a WhatsApp message reaches the agents

```text
WhatsApp ──► OpenClaw Gateway (channel + session) ──► OpenClaw agent (LLM)
                                                         │ reads skill idx-real-estate
                                                         │ picks a tool, fills its parameters
                                                         ▼
                              openclaw-plugin/index.ts  tool.execute(params)
                                                         │ sessionKey → per-conversation session
                                                         ▼
                              propertySearchAgent / marketStatsAgent / semanticSearchAgent
                                                         │ MySQL (+ Gemini for semantic search)
                                                         ▼
                              "status: … / guidance / --- / reply"  ──► LLM writes the answer ──► WhatsApp
```

Before this plugin existed, OpenClaw answered real estate questions from its own model's general knowledge: plausible, but not MLS data (no real listings, guessed prices). The plugin makes the agents callable tools, and the bundled skill tells the model to use them instead of answering from memory.

### The plugin

`openclaw-plugin/` is an OpenClaw **tool plugin**, installed with `openclaw plugins install --link ./openclaw-plugin`:

- **No SDK import, no build step.** The entry is a plain object with `register(api)`; OpenClaw accepts that shape, so the plugin needs no runtime import from the OpenClaw SDK. For linked local installs OpenClaw loads the TypeScript directly with its own transformer (`jiti`), so the plugin imports the agents straight from `src/`.
- **Manifest** (`openclaw.plugin.json`): the tool names in `contracts.tools` (OpenClaw requires them, to know what a plugin owns without loading it), `activation.onStartup`, and `skills: ["./skills"]`.
- **`.env` loading.** OpenClaw doesn't run the plugin from the repo: it runs a copy from `~/.openclaw/tmp/plugin-captures/…`, so a `.env` can't be found relative to the running file. At registration the plugin calls `loadProjectEnv(api)`, which loads the repo's `.env` using the plugin's real install path (`api.source` / `api.rootDir`), or an explicit `envFile` plugin setting. It logs which file it used (never the password).
- **The project `.env` wins over inherited variables.** `src/config.ts` parses `.env` into its own map, and values there take priority over `process.env`. In the first live test, the Gateway process had inherited a different `MYSQL_PASSWORD`, which produced `Access denied for user 'root'` even though MySQL was up. `process.env` itself is never modified, so OpenClaw is unaffected. Settings are read on access, and the MySQL pool is created on first query, so a `.env` loaded during registration applies everywhere.

### Tools

| Tool | Agent | Required | Optional structured fields |
|---|---|---|---|
| `idx_property_search` | `propertySearchAgent` | `query` | `newSearch`, `city`, `maxPrice`, `minBeds`, `minBaths`, `minSqft`, `propertyType`, `pool`, `view` |
| `idx_market_stats` | `marketStatsAgent` | `question` | `city`, `zip`, `propertyType`, `months` |
| `idx_semantic_search` | `semanticSearchAgent` | `description` | `city`, `maxPrice`, `minBeds`, `minBaths`, `minSqft`, `propertyType` |

- **The model's understanding beats the regexes.** The model always passes the user's own words, and fills in the structured fields it understood. Agents take these as `hints`: non-null hints override what the regex parsers extracted. A request like "pasadena houses, 4 bedrooms, max 1.6m" therefore works even though the Week 2 parser only finds cities after the word "in". With no hints, behavior is unchanged; all 20 baseline replies were re-verified as identical.
- **Sessions per conversation.** Each tool gets OpenClaw's trusted tool context. `sessionIdFor()` keys the agents' session on OpenClaw's `sessionKey` (falling back to the sender id), so two WhatsApp chats never share search state. `newSearch: true` clears it.
- **What the model sees.** Each result is `status: <status>`, then one line of guidance for that status, then the agent's reply. The guidance tells the model to answer only from the result, to ask the follow-up on `needs_input`, and not to fall back to general knowledge on `error` (e.g. MySQL offline). The structured `data` goes in the result's `details`, not the model's text.
- **Errors.** Every tool call is wrapped: an exception becomes a `status: error` result instead of a failed tool call.
- **Always visible (`catalogMode: "direct-only"`).** With OpenClaw's Code Mode on (as in this setup), plugin tools normally sit in a searchable catalog, and the model only sees a few generic tools (`exec`, `openclaw`, …). In the first live test, `gemini-3.5-flash-lite` never searched that catalog and answered "is now a good time to buy in San Diego?" from general knowledge: the run showed `codeModeEngaged: true` and no tool calls. Marking the three tools direct-only keeps them in the model's tool list on every turn.

### The skill

`skills/idx-real-estate/SKILL.md` covers:
- **Scope:** use the tools for any California listing or market question; never answer those from general knowledge or web search.
- **Which tool:** property search for criteria, semantic search for style and features, market stats for market conditions; mixed questions call two tools.
- **Calling:** pass the user's words plus the structured fields, follow up on `needs_input`, and use `newSearch` when the user starts over.
- **Answering:** keep the numbers exactly as returned, add nothing, and note that market numbers describe the dataset's date range.

### Testing

- `npm test` (`test/unit/plugin.test.ts`) checks that:
  - the manifest, package entry and registered tools agree
  - every tool schema is well-formed
  - sessions are isolated per conversation
  - results carry status and guidance
  - the skill's frontmatter is valid and mentions every tool
- Before release, the plugin was also driven the way OpenClaw would call it, against SQLite and a mock Gemini:
  - a three-turn search where the model's structured fields supply the budget and bedrooms
  - two chats with independent sessions
  - `newSearch`
  - ZIP and city/type/month hints for market stats
  - city and price hints for semantic search
  - a simulated MySQL outage, which returns `status: error`
- The real proof is on your machine: `openclaw agent --agent coordinator --json --message "Is now a good time to buy in San Diego?"` should list `idx_market_stats` in `result.meta.agentMeta.terminalReceipt.successfulToolNames`, and the answer should quote numbers from your data.

---

## 9. Runtime and Tooling

- TypeScript runs directly on Node (24.22.1+, which the OpenClaw submodule requires) using built-in type stripping; there is no build step.
- Because of that, type-only imports must use `import type` / `import { type X }`, and relative imports include the `.ts` extension.
- `ts-node` is not used; it is incompatible with TypeScript 7.
- `npm run typecheck` runs `tsc --noEmit` over `src/` and `test/` (`allowImportingTsExtensions` is enabled in `tsconfig.json`; `openclaw/` is excluded).
- Tests use Node's built-in runner (`node:test` + `node:assert/strict`), so there are no test dependencies.
- Configuration is read only in `src/config.ts`; no other module touches `process.env`.

---

## 10. Data Notes

Profiling the local `california_sold` import (October 2026):

- **98,552 rows**, all `PropertyType = 'Residential'`
- Close dates run **Mar 18 – Sep 17, 2026**, about 16–17k sales per full month. March and September are partial.
- **4 rows have typo close dates** (2028, 2030 ×2, 2072); they are ignored because they are after today
- Every `CloseDate` is well-formed `YYYY-MM-DD`
- The handbook describes 2021–2025 coverage. With ~6 months of data, market reports show a 6-month trend and no year-over-year comparison. Importing a longer dataset turns YoY on automatically, with no code changes.
- `rets_property` has **55,212 rows, all active and residential**; 54,891 have remarks, averaging about 1,300 characters. Biggest cities: Los Angeles (4,015), San Diego (2,198), San Jose (1,047), Irvine (723). MySQL version is 8.4.
