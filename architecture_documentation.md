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

---

At a high level, the openclaw schema will take the user request from a channel of conversation that holds the session, e.g. WhatsApp, give it to the Orchestrator who will activate the appropriate skill to provide the proper context and tools in order to properly query the database and recieve the relevant information, which will be saved in session memory, to answer the query. When the proper answer is made, it will be sent through the channel to the user, in our case whatsapp. 