# OpenAI Desktop, ChatGPT, and Codex MCP Integration Plan

**Status:** Planning only — not implemented  
**Date:** 2026-08-10  
**Scope:** Model Context Protocol access to RSS Reader articles, sources, and collections

## 1. Recommendation

Build one headless TypeScript MCP companion around the existing trusted RSS Reader services, with two transports delivered in phases:

1. **Local STDIO first** for the ChatGPT desktop app and local Codex clients. It runs as a child process, connects directly to the same local PostgreSQL database, and does not expose a port.
2. **Remote streamable HTTP later** for ChatGPT web through an OpenAI plugin. This is a separately deployed, authenticated integration service; it is not a local HTTP server inside Electron.

This split matches current OpenAI behavior: the ChatGPT desktop app, Codex CLI, and Codex IDE extension can use MCP servers configured on the same Codex host, including local STDIO servers, while ChatGPT web consumes remote MCP-backed tools through plugins. See OpenAI's current [Model Context Protocol setup guide](https://learn.chatgpt.com/docs/extend/mcp).

The local phase should be implemented and evaluated before any remote publishing work. A remote server cannot safely reach a user's localhost PostgreSQL database, so ChatGPT web requires a deliberate sync/relay architecture and user authentication; that is a later product decision, not something to hide inside this prototype.

## 2. Official OpenAI guidance used

OpenAI currently describes MCP servers as exposing structured tools, resources, prompts, and server instructions. Production remote servers should use stable HTTPS endpoints with streamable HTTP, and private data or user actions require authorization. Tool results should remain useful without custom UI ([MCP server concepts](https://developers.openai.com/plugins/concepts/mcp-server)).

OpenAI recommends focused tools mapped to recognizable user goals, explicit input/output schemas, stable identifiers, accurate safety annotations, and concise structured results. The official TypeScript SDK is `@modelcontextprotocol/sdk` ([Build an MCP server](https://developers.openai.com/plugins/build/mcp-server), [Define tools](https://developers.openai.com/plugins/plan/tools)).

For private data and write actions, OpenAI requires server-side authorization rather than relying on annotations or client behavior. Its current plugin guidance uses OAuth discovery, authorization code with PKCE, audience/scope validation, and per-tool security declarations; it recommends using an established identity provider instead of implementing authentication from scratch ([Authentication](https://developers.openai.com/plugins/build/auth)).

OpenAI's current developer workflow is to test the endpoint and tools with MCP Inspector, connect it in ChatGPT developer mode, evaluate positive/negative/write prompts, and refresh metadata after changes ([Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)).

These sources were checked on 2026-08-10. Availability can depend on the user's ChatGPT plan and workspace/admin policy, so implementation should verify the target accounts before promising a rollout.

## 3. Product boundary

The MCP integration is a second trusted entry point to the same application capabilities:

```text
ChatGPT desktop / Codex local
  → MCP STDIO process
  → validated MCP tool
  → shared RSS Reader application service
  → repository
  → PostgreSQL

ChatGPT web (later)
  → installed OpenAI plugin
  → authenticated streamable HTTPS MCP
  → remote RSS Reader integration data/service
```

The Electron renderer remains sandboxed and unchanged. The MCP process must not route through renderer IPC, automate the UI, expose database credentials, or start a localhost application server.

## 4. Proposed package structure

Future implementation should add:

```text
apps/mcp/
  src/server.ts                 # McpServer registration and instructions
  src/stdio.ts                  # local transport entry point
  src/http.ts                   # later remote transport adapter only
  src/auth.ts                   # later verified identity/scopes
  src/tools/articles.ts
  src/tools/sources.ts
  src/tools/collections.ts
  src/presenters.ts             # bounded structured results

packages/application/
  source-service.ts             # extracted from Electron main where necessary
  collection-service.ts
  article-query-service.ts
```

Repositories remain in `packages/db`, feed discovery/extraction remains in `packages/feeds`, and Electron-specific orchestration remains in `apps/desktop/main`. Move only reusable trusted logic; do not make the MCP package depend on Electron.

## 5. Server instructions

Keep the initialization instructions short and make the first 512 characters self-contained, following OpenAI's current Codex guidance. Proposed core instruction:

> Use read tools to resolve stable source, collection, and article IDs before writes. Never infer an ID from a name when multiple matches exist. Source deletion permanently removes that source's items, cached content, images, memberships, suppressions, and fetch history; require the server-issued confirmation token. Return article text, not raw publisher HTML.

Do not duplicate every tool description or use server instructions to change model personality.

## 6. Tool inventory

### 6.1 Article and reasoning tools

| Tool | Purpose | Key inputs | Result and limits | Annotation |
|---|---|---|---|---|
| `list_articles` | Browse recent/read/unread articles by source or collection | filters, date range, cursor, limit ≤ 100 | IDs, title, source, dates, read/cache state, short excerpt | read-only, closed-world |
| `search_articles` | Find articles for a topic or named entity | query, filters, cursor, limit ≤ 50 | ranked metadata and excerpts; no raw HTML | read-only, closed-world |
| `get_article` | Retrieve one article for reasoning | article ID, content mode | metadata plus bounded reader text or feed fallback; canonical URL | read-only, closed-world |
| `set_article_read_state` | Mark one article read or unread | article ID, boolean, expected update token | updated read state | write, non-destructive, closed-world |

`get_article` should prefer sanitized extracted `reader_text`, then sanitized feed-derived text, and clearly identify `complete`, `partial`, `failed`, `evicted`, or not-yet-extracted content. It must not return `raw_html`, image bytes, publisher-controlled markup, or internal extraction errors beyond safe user-facing diagnostics.

Search should initially use PostgreSQL full-text search over title, author, summary, and stored reader text. If full-text search is not implemented, name the first version `filter_articles` rather than advertising semantic search it cannot perform.

### 6.2 Source tools

| Tool | Purpose | Key inputs | Safety |
|---|---|---|---|
| `list_sources` | Inspect sources, enabled state, collections, and fetch status | enabled/collection filters | read-only |
| `get_source` | Resolve one source and its metadata | source ID | read-only |
| `add_source` | Add a website/feed URL and optional collections | URL, optional name, collection IDs | write; uses existing public-network discovery and atomic initial import |
| `update_source` | Rename, enable/disable, change validated URL, or replace memberships | source ID, expected update token, explicit fields | write; URL failure leaves source unchanged |
| `prepare_remove_source` | Explain cascade and mint a short-lived confirmation token | source ID | read-only preview |
| `remove_source` | Permanently delete a confirmed source | source ID, confirmation token | destructive write |

`add_source` and URL changes must call the same `SourceService` used by Electron so SSRF protections, advertised-feed discovery, initial-import limits, and atomic persistence cannot diverge.

Deletion uses a two-step server-enforced confirmation token bound to user, source ID, current `updated_at`, cascade summary, and a short expiry. Accurate `destructiveHint` metadata is still required, but annotations do not replace this check.

### 6.3 Collection tools

| Tool | Purpose | Key inputs | Safety |
|---|---|---|---|
| `list_collections` | Inspect collection names and source counts | optional text filter | read-only |
| `get_collection` | Resolve full source membership | collection ID | read-only |
| `create_collection` | Create an empty collection | name | write |
| `update_collection` | Rename and atomically replace complete membership | collection ID, name, complete source-ID list, expected update token | write; explicit final state |
| `prepare_delete_collection` | Explain that sources/items remain and mint confirmation | collection ID | read-only preview |
| `delete_collection` | Delete only a confirmed collection | collection ID, confirmation token | destructive annotation; sources retained |

Returning stable IDs and update tokens enables reliable follow-up calls and optimistic concurrency. Ambiguous names should return candidate IDs rather than guessing.

## 7. Tool schemas and results

- Define all inputs and outputs with Zod and register matching MCP schemas.
- Reuse or compose the existing `@rss-reader/contracts` schemas where their semantics match; do not expose Electron IPC channel details.
- Put reusable machine-readable data in `structuredContent` and a short human summary in `content`.
- Paginate all unbounded lists with opaque cursors and deterministic ordering.
- Cap article text per call, proposed default 20,000 characters and maximum 60,000, with truncation metadata and an optional continuation cursor.
- Include `id`, `updatedAt`, and canonical source/collection/article references in results needed by later tools.
- Return typed error categories: invalid input, not found, ambiguous match, conflict, authorization, source validation, network, and database.
- Never return secrets, connection strings, raw stack traces, raw HTML, or image blobs.

## 8. Local STDIO setup

The initial command should be deterministic, for example:

```powershell
pnpm --dir "C:\path\to\RSS Reader Prototype" mcp:start
```

For development, register it with Codex:

```powershell
codex mcp add rss-reader --env DATABASE_URL=postgresql://... -- pnpm --dir "C:\path\to\RSS Reader Prototype" mcp:start
codex mcp list
```

Prefer forwarding `DATABASE_URL` from the local environment rather than storing it directly in `config.toml`. The ChatGPT desktop app and Codex local surfaces can also add the STDIO command through **Settings → MCP servers**, then restart the relevant client. Current configuration syntax and surface instructions are documented in OpenAI's [MCP guide](https://learn.chatgpt.com/docs/extend/mcp).

The packaged desktop application need not be running for read tools if PostgreSQL is available. Mutations in the MCP process and Electron process must rely on database transactions and optimistic concurrency, not an in-memory cross-process lock.

## 9. ChatGPT web and plugin path

ChatGPT web does not read the user's local Codex configuration. A web-accessible integration therefore needs a remote streamable HTTPS MCP endpoint installed through an OpenAI plugin.

Recommended rollout:

1. Finish and evaluate the STDIO tool contracts.
2. Decide how local RSS Reader data becomes available remotely: explicit encrypted sync, a user-run secure tunnel for development, or a separately hosted reader account. Do not let a remote service connect directly to an exposed development PostgreSQL port.
3. Add user identity and tenant ownership to the remote data model.
4. Deploy the same tool contracts behind streamable HTTPS at a stable `/mcp` endpoint.
5. Package the connection in a plugin and test it in ChatGPT developer mode using OpenAI's [connection workflow](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The remote path is blocked from implementation until the operator chooses a sync/hosting and identity model. This is a genuine future product decision with materially different privacy and operational outcomes; it does not block the local STDIO phase.

## 10. Authentication and authorization

### Local phase

- Treat the OS account and local database access as the security boundary.
- Do not accept a database URL as a tool argument.
- Use Codex/desktop tool approval policies for user visibility, but enforce destructive confirmation in the server.
- Redact credentials and article bodies from logs.

### Remote phase

- Use an established OAuth 2.1 identity provider.
- Publish protected-resource and authorization-server metadata.
- Use authorization code with PKCE and validate signature, issuer, audience/resource, expiry, and scopes on every request.
- Proposed scopes: `reader.read`, `reader.articles.write`, `reader.sources.write`, and `reader.collections.write`.
- Declare per-tool security schemes and return the required authentication challenge for linking/reauthorization.
- Enforce tenant/resource ownership after token validation.

Follow OpenAI's current [MCP authentication guide](https://developers.openai.com/plugins/build/auth); client linking UI and annotations are not substitutes for server authorization.

## 11. Consistency and concurrency

- Add optimistic `updatedAt` or opaque version preconditions to every update/delete tool.
- Source URL changes continue to validate before mutation.
- Collection membership replacement remains one transaction.
- If Electron and MCP modify the same record, the stale writer receives a conflict plus current safe metadata.
- Publishing an MCP write should trigger normal database state only; the renderer will see it on refresh. A future database notification can improve immediacy but is not required.
- Keep MCP-side list/search transactions read-only and short.

## 12. Privacy and prompt-injection controls

Article text is untrusted publisher content. Tool descriptions and server instructions must tell the model to treat it as data, not instructions. Additionally:

- label content fields as untrusted article content;
- exclude scripts, raw attributes, hidden metadata, and remote-loading URLs;
- return canonical URLs separately from text;
- bound result sizes and list counts;
- never let article content select a write tool or supply an identifier without user intent and server validation;
- preserve the existing public-network URL policy for source discovery and article fetches;
- log operation metadata, IDs, timing, and categories, not full article text.

## 13. Testing and evaluation

Future implementation should include:

- schema tests for every valid, invalid, oversized, and ambiguous input;
- repository/service integration tests against isolated PostgreSQL records;
- tests proving MCP and Electron call the same source-validation and collection-update logic;
- read tests for empty, partial, cached, evicted, and long article content;
- two-step deletion, expired token, stale version, wrong-user, and replay tests;
- concurrent Electron/MCP update conflict tests;
- authentication and scope tests for the remote adapter;
- MCP Inspector contract tests;
- evaluation prompts for direct, indirect, follow-up, unsupported, and consequential requests as recommended by OpenAI;
- negative prompt-injection fixtures embedded in article content;
- type checking, full Vitest, clean migration if schema changes, Windows packaging, and local STDIO smoke tests from the ChatGPT desktop app and Codex.

## 14. Delivery sequence

1. Freeze the use-case and tool inventory with evaluation prompts.
2. Extract reusable trusted application services without changing renderer IPC behavior.
3. Add `apps/mcp`, the TypeScript SDK, schemas, instructions, and STDIO transport.
4. Implement bounded article/source/collection read tools.
5. Implement writes with optimistic concurrency and server-enforced confirmation.
6. Configure and smoke-test ChatGPT desktop plus Codex local clients.
7. Decide the web sync/hosting and identity architecture.
8. Only then add remote HTTP, OAuth, plugin packaging, developer-mode testing, and publication review.

## 15. Explicit non-goals for the first phase

- No AI summaries, embeddings, or semantic vector store inside RSS Reader.
- No local HTTP server.
- No renderer access to MCP, PostgreSQL, Node.js, or credentials.
- No raw article HTML/image transfer.
- No UI automation or Electron remote-control tool.
- No public unauthenticated endpoint.
- No background sync or cloud account until the remote product decision is made.
