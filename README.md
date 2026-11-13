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

### 6. Build the listing embeddings (Week 6)

Semantic search needs every active listing embedded once. The indexer saves each batch as it goes, so it's safe to stop and re-run.

```bash
npm run embed:listings -- --dry-run                               # counts + time estimate, no API calls
npm run embed:listings -- --city Pasadena --city Irvine --city "San Diego"   # a few cities first (minutes)
npm run embed:listings                                            # everything (free tier: overnight)
```

On the Gemini free tier, the full ~55K listings takes many hours because of the tokens-per-minute limit. If it hits the daily quota, it stops cleanly; run it again later and it picks up where it left off.

### 7. Check that everything works

```bash
npm run test:parser          # Week 2 parser tests (no database needed)
npm run test:market-parser   # Week 5 parser tests (no database needed)
npm run test:search          # Weeks 3–4 multi-turn search against MySQL
npm run test:market          # Week 5 market stats against MySQL
npm run test:semantic-offline   # Week 6 routing, vector math, listing text (no DB or API key)
npm run test:semantic           # Week 6 semantic search (needs MySQL, Gemini, and embedded listings)
```

Then send a test message to the agent over WhatsApp, e.g. *"Find homes in Irvine"*, *"Is now a good time to buy in San Diego?"* or *"charming craftsman with mountain views and character"*

---

## Commands

| Command | What it does |
|---|---|
| `npm run test:parser` | Week 2: 10 natural-language → filter parsing cases |
| `npm run test:search` | Weeks 3–4: multi-turn property search against `rets_property` |
| `npm run test:market-parser` | Week 5: market question parsing and intent detection |
| `npm run test:market` | Week 5: market reports end to end, plus SQL sanity checks |
| `npm run export:market` | Writes Markdown market summaries to `docs/market_reports/` (Week 8 RAG source). Pass city names to override the default list: `npm run export:market -- Irvine "San Diego"` |
| `npm run embed:listings` | Week 6: embed active listings into `listing_embeddings`. Flags: `--dry-run`, `--city <name>` (repeatable), `--limit <n>`, `--max-chars <n>`, `--force` |
| `npm run test:semantic-offline` | Week 6: routing heuristic, vector math, listing text (no DB or API key) |
| `npm run test:semantic` | Week 6: semantic search end to end, filters, self-retrieval and routing checks |
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`) |

Any file can also be run directly: `node src/tests/testMarketStats.ts`.

---

## What each week added

**Week 2: Natural-language property search.** `src/skills/propertySearch.ts` parses free text like *"3-bedroom condos in Irvine under $1.5M with a pool"* into structured filters (city, max price, beds, baths, sqft, type, pool, view).

**Week 3: MLS database integration.** `src/db/connection.ts` (mysql2 connection pool) and `src/skills/propertyQueries.ts` turn those filters into parameterized SQL over `rets_property`, with pagination, plus a sold-comps query over `california_sold`.

**Week 4: Conversational property search.** `src/memory/session.ts` keeps per-user state. `src/skills/searchSkill.ts` merges each new message into it, asks follow-ups (city → budget → bedrooms) until it has enough to search, then returns formatted property cards.

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
  index.ts              OpenClaw entry point: handleOpenClawPayload() routes each message
  db/connection.ts      MySQL connection pool + query() helper
  memory/session.ts     Per-user session state (Week 4)
  skills/
    propertySearch.ts   Week 2: NL → property filters
    propertyQueries.ts  Week 3: SQL over rets_property / california_sold
    searchSkill.ts      Week 4: conversational search agent
    marketParser.ts     Week 5: NL → market filters, market-question detection
    marketQueries.ts    Week 5: market analytics SQL
    marketStatsSkill.ts Week 5: market stats agent + WhatsApp formatting
    semanticIntent.ts   Week 6: detects descriptive (semantic) queries
    semanticSearch.ts   Week 6: semantic search agent + reusable vector ranking
  embeddings/
    gemini.ts           Week 6: Gemini embedding client (rate limiting, retries)
    listingText.ts      Week 6: the text embedded for each listing
    store.ts            Week 6: listing_embeddings table + in-memory vector index
    vectorMath.ts       Week 6: normalize, dot product, BLOB encoding, top-k
  scripts/
    exportMarketReports.ts  Week 5 → Week 8: Markdown market summaries
    buildListingEmbeddings.ts  Week 6: resumable listing indexer
  tests/                Test scripts (see Commands)
openclaw/               OpenClaw framework (git submodule)
openclaw.json           Points OpenClaw at src/index.ts → handleOpenClawPayload
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
- **`SyntaxError: ... does not provide an export named 'X'`**: a type is being imported without the `type` keyword. Use `import type { X }` or `import { type X }`, and include the `.ts` extension in relative imports.
- **Market stats SQL errors near `OVER`**: MySQL is older than 8.0.
- **Semantic search says "isn't set up yet"**: no embeddings exist; run `npm run embed:listings`.
- **`Gemini embeddings 429` repeating, or the indexer stops with "daily embedding quota reached"**: that's the free-tier limit. Leave it and re-run later, or lower `EMBED_TPM` in `.env` if 429s are frequent.
