# IDX Exchange Multi-Agent Real Estate Assistant

AI Agentic Engineer internship project for IDX Exchange (Summer 2026).

An OpenClaw-based multi-agent assistant that answers real estate questions over real California MLS data: natural-language property search, multi-turn conversations, market analytics and semantic search today, with recommendations, RAG, WhatsApp and email workflows to come.

## Status

| Week | Module | Status |
|---|---|---|
| 0 | Environment setup | Done |
| 1 | Architecture fundamentals | Done ([architecture_documentation.md](architecture_documentation.md)) |
| 2 | Natural-language property search | Done |
| 3 | MLS database integration | Done |
| 4 | Conversational property search | Done |
| 5 | Market statistics agent | Done |
| 6 | Embeddings & semantic search | Done |
| — | OpenClaw integration (tool plugin) | Done: the agents answer over WhatsApp |
| 7–12 | Recommendations, RAG, orchestration, WhatsApp, email, capstone | Upcoming |

See [architecture_documentation.md](architecture_documentation.md) for how the pieces fit together and a file-by-file code map.

---

## Setup (Week 0)

### Prerequisites

- **Git**
- **Node.js 24.22.1+** (the OpenClaw submodule requires it; Node 26 also works). Project scripts run TypeScript directly with Node's built-in type stripping, so there is no build step.
- **MySQL 8.0+**: the market-stats queries use window functions (`ROW_NUMBER() OVER ...`), which MySQL 5.7 does not have.
- **A Gemini API key** for the LLM features
- **A phone with WhatsApp** for the channel setup
- **The MLS dumps** `rets_property.sql` and `california_sold.sql`, provided by IDX Exchange (not in this repo)

### 1. Clone the repo (with the OpenClaw submodule)

```bash
git clone --recurse-submodules https://github.com/agent-hah/IDX-Exchange-Agentic-AI.git
cd IDX-Exchange-Agentic-AI
npm install
```

If you already cloned without `--recurse-submodules`, run `git submodule update --init`.

### 2. Install and onboard OpenClaw

```bash
npm install -g openclaw@latest --allow-scripts=openclaw
openclaw onboard --install-daemon
openclaw gateway status
```

Onboarding checks model access, creates the workspace, and starts the Gateway. `openclaw dashboard` opens the Control UI if you want to send a test message there. (The `openclaw/` submodule is the framework source for reference; you don't need to build it.)

### 3. Create the database and import the MLS data

```bash
mysql -h 127.0.0.1 -u root -p -e "CREATE DATABASE idx_exchange CHARACTER SET utf8mb4;"

mysql -h 127.0.0.1 -u root -p idx_exchange < rets_property.sql     # active listings, 130+ columns
mysql -h 127.0.0.1 -u root -p idx_exchange < california_sold.sql   # sold comps, 46 columns
```

The `rets_property` import also builds a `FULLTEXT` index on `L_Remarks`, so allow it extra time.

Verify the row counts:

```bash
mysql -h 127.0.0.1 -u root -p idx_exchange -e "SELECT
  (SELECT COUNT(*) FROM rets_property)   AS active_listings,
  (SELECT COUNT(*) FROM california_sold) AS sold_comps;"
```

> Use `-h 127.0.0.1`. Without it, the `mysql` client looks for a socket file (`/tmp/mysql.sock`), and fails with `ERROR 2002` on setups that don't create one (e.g. Docker).

### 4. Configure environment variables

```bash
cp .env.example .env
```

Then fill in `.env`:

```bash
GEMINI_API_KEY=...

MYSQL_HOST=127.0.0.1
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=idx_exchange

EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_gmail_app_password   # a Gmail app password, not your login password

# Optional: pin the end of market-stats windows (YYYY-MM-DD).
# MARKET_ANCHOR_DATE=2026-09-17

# Optional: Week 6 embedding settings (defaults shown).
# GEMINI_EMBED_MODEL=gemini-embedding-2
# EMBED_DIMS=768
# EMBED_TPM=25000   # tokens/min budget for the indexer; raise on a paid tier
```

`.env` is git-ignored. Never commit it.

### 5. Link WhatsApp

```bash
openclaw channels login --channel whatsapp
```

Scan the QR code from WhatsApp → **Settings → Linked Devices → Link a device**.

### 6. Connect the agents to OpenClaw

The agents reach OpenClaw through a tool plugin in `openclaw-plugin/`. Install it from the repo root (it runs straight from the repo, no build step):

```bash
openclaw plugins install --link ./openclaw-plugin
openclaw plugins inspect idx-exchange --runtime     # should list idx_property_search, idx_market_stats, idx_semantic_search
openclaw skills list | grep idx-real-estate          # the bundled skill that tells the agent to use these tools
```

OpenClaw asks you to approve the plugin's capabilities on install. Then start a fresh conversation (send `/new` in WhatsApp) so the agent picks up the new tools.

Check it end to end:

```bash
openclaw agent --message "Is now a good time to buy in San Diego?"
```

The answer should quote numbers from your data (e.g. the closed-sales count and the Mar–Sep 2026 date range), not general knowledge. **MySQL must be running** (external drive attached) whenever OpenClaw answers real estate questions; if it isn't, the agent says the data is unavailable instead of guessing.

After editing agent code, reload the plugin with `openclaw plugins reload idx-exchange`.

### 7. Build the listing embeddings (Week 6)

Semantic search needs every active listing embedded once. The indexer saves each batch as it goes, so it's safe to stop and re-run.

```bash
npm run embed:listings -- --dry-run                               # counts + time estimate, no API calls
npm run embed:listings -- --city Pasadena --city Irvine --city "San Diego"   # a few cities first (minutes)
npm run embed:listings                                            # everything (free tier: overnight)
```

On the Gemini free tier, the full ~55K listings takes many hours because of the tokens-per-minute limit. If it hits the daily quota, it stops cleanly; run it again later and it picks up where it left off.

### 8. Check that everything works

```bash
npm test                # unit tests: parsers, routing, vector math, formatting (no database or API key)
npm run test:db         # Weeks 2–5 against MySQL
npm run test:semantic   # Week 6 against MySQL + Gemini (needs some embedded listings)
npm run typecheck
```

Then send a test message to the agent over WhatsApp, e.g. *"Find homes in Irvine"*, *"Is now a good time to buy in San Diego?"* or *"charming craftsman with mountain views and character"*

---

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (`test/unit/`, no database or API key): Week 2 and Week 5 parsers, Week 6 routing, vector math and listing text, shared SQL/formatting helpers, and a guard that the embedded text hasn't changed |
| `npm run test:db` | Integration tests against MySQL (`test/integration/`): multi-turn search, filters and the 50-row cap, market reports and SQL sanity checks, routing |
| `npm run test:semantic` | Week 6 against MySQL + Gemini: semantic queries, ordering, hard filters, self-retrieval, routing |
| `npm run export:market` | Writes Markdown market summaries to `docs/market_reports/` (Week 8 RAG source). Pass city names to override the default list: `npm run export:market -- Irvine "San Diego"` |
| `npm run embed:listings` | Week 6: embed active listings into `listing_embeddings`. Flags: `--dry-run`, `--city <name>` (repeatable), `--limit <n>`, `--max-chars <n>`, `--force` |
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`) |

Tests use Node's built-in runner (`node:test`); run one file with `node --test test/unit/marketParser.test.ts`.

---

## What each week added

**Week 2: Natural-language property search.** `src/agents/propertySearch/parser.ts` parses free text like *"3-bedroom condos in Irvine under $1.5M with a pool"* into structured filters (city, max price, beds, baths, sqft, type, pool, view).

**Week 3: MLS database integration.** `src/db/connection.ts` (mysql2 connection pool) and `src/agents/propertySearch/queries.ts` turn those filters into parameterized SQL over `rets_property`, with pagination, plus a sold-comps query over `california_sold`.

**Week 4: Conversational property search.** `src/memory/session.ts` keeps per-user state. `src/agents/propertySearch/agent.ts` merges each new message into it, asks follow-ups (city → budget → bedrooms) until it has enough to search, then returns formatted property cards.

**Week 5: Market statistics agent.** `marketStatsAgent` answers questions like *"Is now a good time to buy in San Diego?"* from `california_sold`. For a city, ZIP or property type it reports:
- median and average close price, and price per sq ft
- days on market
- list-to-close ratio and % sold at or above list
- months of supply, with active inventory from `rets_property`
- a monthly trend
- year-over-year changes, when the data covers a prior year
- a buyer's/seller's market read

Questions without a location get a statewide leaderboard of the busiest cities. See the Week 5 section of the architecture doc for details.

**Week 6: Embeddings & semantic search.** `semanticSearchAgent` handles descriptive queries like *"charming craftsman with mountain views and character"*.
- **Indexing (once):** each active listing's details and remarks are embedded with Gemini (`gemini-embedding-2`, 768 dimensions) and stored in a new `listing_embeddings` table.
- **Search:** the query is embedded with one API call, compared against every stored vector in memory (cosine similarity), and the top 5 active listings come back.
- **Hybrid filters:** limits the Week 2 parser finds (city, max price, beds, baths, sqft, type) narrow the candidates first.
- **Session:** results are saved to `lastResults` for the Week 7 recommendation engine.

---

## Repository structure

```text
src/
  index.ts                Temporary keyword router: route(text, userId) → the right agent
  config.ts               All environment settings (reads .env once)
  types.ts                AgentResult: the shape every agent returns
  agents/                 One folder per agent: parser → queries → agent
    propertySearch/       Weeks 2–4
      parser.ts             free text → PropertyFilters
      queries.ts            SQL over rets_property / california_sold
      agent.ts              conversational search (follow-ups, property cards)
    marketStats/          Week 5
      parser.ts             free text → MarketFilters, market-question detection
      queries.ts            market analytics SQL, getMarketReport()
      agent.ts              market snapshot formatting + buyer/seller read
    semanticSearch/       Week 6
      intent.ts             detects descriptive (semantic) queries
      search.ts             hybrid filter + vector ranking (reused by Week 7)
      agent.ts              WhatsApp cards + session results
  db/
    connection.ts         MySQL connection pool + query() helper
    listingFilters.ts     The one place filters become SQL over rets_property
  embeddings/             Week 6 building blocks
    gemini.ts             Gemini embedding client (rate limiting, retries)
    listingText.ts        the text embedded for each listing
    store.ts              listing_embeddings table + in-memory vector index
    vectorMath.ts         normalize, dot product, BLOB encoding, top-k
  memory/session.ts       Per-user session state
  utils/format.ts         Money, percent and date formatting
  scripts/
    buildListingEmbeddings.ts  Week 6: resumable listing indexer
    exportMarketReports.ts     Week 5 → Week 8: Markdown market summaries
test/
  unit/                   No database or API key needed (npm test)
  integration/            Need MySQL, and Gemini for semantic search (npm run test:db / test:semantic)
openclaw-plugin/          OpenClaw tool plugin: exposes the agents as tools
  index.ts                register(api): idx_property_search, idx_market_stats, idx_semantic_search
  openclaw.plugin.json    manifest (tool contracts, bundled skills)
  skills/idx-real-estate/ SKILL.md telling OpenClaw's agent when to use the tools
openclaw/                 OpenClaw framework (git submodule)
architecture_documentation.md
```

---

## Data and security

The MLS datasets are stored locally in MySQL and are **not** committed. `.gitignore` excludes:

- `.env` and any credentials
- SQL dumps (`*.sql`) and raw data files (`*.csv`)
- `node_modules/`

Agent queries return at most 50 rows at a time, and no email will ever be sent without explicit human approval (Week 11).

### Notes on the dataset

The handbook describes `california_sold` as covering 2021–2025. The copy used here has **98,552 residential sales closed Mar 18 – Sep 17, 2026**, plus 4 rows with typo close dates in 2028–2072, which the code ignores. As a result, market reports cover about 6 months and year-over-year comparisons are not available. The code adapts automatically if a longer dataset is imported.

---

## Troubleshooting

- **`ERROR 2002 ... /tmp/mysql.sock`**: add `-h 127.0.0.1` to the `mysql` command.
- **`npx ts-node` crashes with `Cannot read properties of undefined (reading 'fileExists')`**: ts-node does not support TypeScript 7. Run files with `node` instead (see Commands).
- **WhatsApp answers sound generic and don't match your data**: OpenClaw isn't calling the tools. Check `openclaw plugins inspect idx-exchange --runtime`, reload with `openclaw plugins reload idx-exchange`, then send `/new` to start a fresh session. To see which tools a run used: `openclaw agent --agent coordinator --json --message "…"` and look at `successfulToolNames`.
- **`openclaw: command not found`**: if you run OpenClaw from the submodule, use `pnpm openclaw …` inside `openclaw/`, or add `alias openclaw="pnpm --silent --dir <repo>/openclaw openclaw"` to your shell config. Commands that take an agent need `--agent coordinator` when several agents are configured.
- **The agent says the MLS data is unavailable**: the plugin couldn't query MySQL. Find the reason with `openclaw logs --limit 3000 --plain | grep -A2 -E "Skill Error|\[idx-exchange\]"`:
  - `ECONNREFUSED`: MySQL isn't running (external drive unplugged, or the MySQL container stopped).
  - `Access denied`: wrong credentials. Check the `[idx-exchange] settings from …` line in the logs to see which `.env` the plugin loaded. To point it at a different file: `openclaw config set plugins.entries.idx-exchange.config.envFile /path/to/IDX-Exchange/.env`, then `openclaw plugins reload idx-exchange`.
  - Values in the repo's `.env` take priority over environment variables the OpenClaw Gateway inherited.
- **Adding a new agent**: create `src/agents/<name>/` with `parser.ts`, `queries.ts` and `agent.ts`; return an `AgentResult` (`src/types.ts`); build any rets_property filters with `activeListingWhere()` (`src/db/listingFilters.ts`). Then expose it as a tool in `openclaw-plugin/index.ts`, add the tool name to `contracts.tools` in `openclaw.plugin.json`, and mention it in the skill.
- **`SyntaxError: ... does not provide an export named 'X'`**: a type is being imported without the `type` keyword. Use `import type { X }` or `import { type X }`, and include the `.ts` extension in relative imports.
- **Market stats SQL errors near `OVER`**: MySQL is older than 8.0.
- **Semantic search says "isn't set up yet"**: no embeddings exist; run `npm run embed:listings`.
- **`Gemini embeddings 429` repeating, or the indexer stops with "daily embedding quota reached"**: that's the free-tier limit. Leave it and re-run later, or lower `EMBED_TPM` in `.env` if 429s are frequent.
