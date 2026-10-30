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

See [Section 8](#8-data-notes) for what the local copy of the data actually contains.

---

## Summary

At a high level, OpenClaw takes the user's request from a conversation channel that holds the session (WhatsApp, in our case) and hands it to the Orchestrator. The Orchestrator activates the appropriate skill, which supplies the context and tools needed to query the database. The results are saved in session memory and used to answer the query, and the answer goes back to the user through the same channel.

---

## 5. Current Implementation (Weeks 2–5)

Sections 1–4 describe the target design. This section describes what is built today.

### Request flow

```text
WhatsApp / OpenClaw Gateway
      │  payload { message | text, userId | from }
      ▼
src/index.ts  handleOpenClawPayload()          ← entry point named in openclaw.json
      │  temporary router until the Week 9 orchestrator
      │
      ├── isMarketQuestion(text)? ──yes──► marketStatsAgent()   (Week 5)
      │                                        └── california_sold, rets_property (inventory)
      │
      └── otherwise ─────────────────────► handleMessage()      (Weeks 2–4)
                                               └── rets_property
      ▼
{ status, intent, response, data? }  →  response text sent back to the user
```

Every agent follows the same three layers: **parse** free text into a typed filter object, **query** MySQL with parameterized SQL, then **format** the result for WhatsApp. Agents return structured `data` alongside the `response` text, so the Week 9 orchestrator can merge results without re-querying.

### Code map

| File | Week | Responsibility |
|---|---|---|
| `src/index.ts` | 1/5 | OpenClaw entry point; routes market questions vs. property search |
| `src/db/connection.ts` | 3 | mysql2 connection pool (credentials from `.env`); `query<T>(sql, params)` |
| `src/skills/propertySearch.ts` | 2 | `parsePropertyQuery()`: free text → `PropertyFilters` |
| `src/skills/propertyQueries.ts` | 3 | `searchActiveListings()` over `rets_property`; `getSoldComps()` over `california_sold` |
| `src/memory/session.ts` | 4 | In-memory per-user `UserSession` (`getSession`, `updateSession`, `clearSession`) |
| `src/skills/searchSkill.ts` | 4 | Conversational search: merges filters into the session, asks follow-ups, returns property cards |
| `src/skills/marketParser.ts` | 5 | `isMarketQuestion()`, `parseMarketQuery()`: free text → `MarketFilters` |
| `src/skills/marketQueries.ts` | 5 | All market analytics SQL; `getMarketReport()` assembles a full report |
| `src/skills/marketStatsSkill.ts` | 5 | `marketStatsAgent()`, WhatsApp formatting, buyer/seller market read |
| `src/scripts/exportMarketReports.ts` | 5→8 | Writes per-city Markdown summaries to `docs/market_reports/` for RAG indexing |
| `src/tests/*` | 2–5 | Parser tests (no DB) and integration tests (live DB) |

### Sessions

`session.ts` holds one `UserSession` per `userId` in a `Map`. It stores the accumulated property filters, `lastResults`, and `conversationStep`. State lives in memory, so it resets when the process restarts. The Week 5 market agent reads the session's `city` to answer follow-ups like *"how's the market there?"*, but never writes to the session.

---

## 6. Week 5: Market Statistics Agent

### Goal

Answer market questions (*"Is now a good time to buy in San Diego?"*, *"What is the average price per sq ft in Pasadena?"*) with data-backed summaries from `california_sold`: median price, days on market, list-to-close ratio, and a monthly trend for any California city.

### Pipeline

```text
"Median price for condos in Irvine over the last 6 months"
      │
      ▼ marketParser.parseMarketQuery()
{ city: "Irvine", zip: null, subType: "Condominium", months: 6 }
      │
      ▼ marketQueries.getMarketReport()   (runs these in parallel)
  getMarketSummary(current window)   ─┐
  getMarketSummary(prior-year window) ├─ california_sold
  getMonthlyTrend(current window)    ─┘
  getActiveInventory()               ─── rets_property
      │
      ▼ marketStatsSkill.formatReportForWhatsApp() + marketRead()
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

- `npm run test:market-parser` runs 19 checks on parsing and intent detection; no database needed.
- `npm run test:market` runs live against MySQL:
  - six sample questions, covering city, ZIP, condo filter, no location, and unknown city
  - sanity checks on the numbers
  - a cross-check of the SQL median against one computed in TypeScript
  - checks that the trend matches the covered months, YoY is suppressed without a prior year, months of supply is right, and partial months have no %
  - routing checks through `handleOpenClawPayload`

---

## 7. Runtime and Tooling

- TypeScript runs directly on Node (24.22.1+, which the OpenClaw submodule requires) using built-in type stripping; there is no build step.
- Because of that, type-only imports must use `import type` / `import { type X }`, and relative imports include the `.ts` extension.
- `ts-node` is not used; it is incompatible with TypeScript 7.
- `npm run typecheck` runs `tsc --noEmit` (`allowImportingTsExtensions` is enabled in `tsconfig.json`).

---

## 8. Data Notes

Profiling the local `california_sold` import (October 2026):

- **98,552 rows**, all `PropertyType = 'Residential'`
- Close dates run **Mar 18 – Sep 17, 2026**, about 16–17k sales per full month. March and September are partial.
- **4 rows have typo close dates** (2028, 2030 ×2, 2072); they are ignored because they are after today
- Every `CloseDate` is well-formed `YYYY-MM-DD`
- The handbook describes 2021–2025 coverage. With ~6 months of data, market reports show a 6-month trend and no year-over-year comparison. Importing a longer dataset turns YoY on automatically, with no code changes.
