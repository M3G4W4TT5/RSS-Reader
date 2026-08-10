# RSS Reader Prototype — Design and Implementation Plan

**Status:** Agreed prototype plan; Stages 0–5 complete  
**Target:** Windows desktop application  
**Purpose:** Technology-learning prototype; not the Reason MVP  

---

## 1. Objective

Build a small local desktop RSS/Atom reader to learn and validate technologies that may later be useful for Reason.

The prototype should provide one complete loop:

> **Add sources → organise sources → fetch content → browse items → read content**

It is intentionally narrower than Reason. It should not inherit Reason's research, evidence, AI, publishing, approval, MCP, or operational complexity.

### Primary learning goals

- Native Electron application development on Windows.
- Electron main/preload/renderer process separation.
- Typed IPC between renderer and trusted application code.
- React + TypeScript desktop UI development.
- PostgreSQL schema design, migrations, queries, transactions, and upserts.
- RSS/Atom ingestion and incremental fetching.
- Full-article extraction and safe internal rendering.
- Native Windows packaging and application lifecycle.
- Practical development with WebStorm and Codex on Windows.

### 1.1 Current implementation state and authoritative Stage 2 amendment

This section records the repository state through **2026-08-10** and is authoritative where it conflicts with older wording elsewhere in this document.

Completed and validated:

- Stage 0 project skeleton, secure Electron boundaries, PostgreSQL, migrations, tests, and packaging;
- Stage 1 source and collection management, including many-to-many membership and persistence;
- Stage 2 feed ingestion: Feedsmith 2.9.6, HTTP feed fetching, RSS/Atom normalization, deterministic item identity, transactional item upserts, conditional requests, Fetch Now, bounded-concurrency Fetch All, progress, fetch-run history, and fixtures;
- the amended automatic website-to-feed discovery flow: direct-feed-first validation, jsdom advertised-link discovery, relative URL resolution, bounded candidates, public-network validation on submissions/redirects/candidates, and atomic create/edit persistence;
- Stage 3 library and feed reader: All Items, Unread, source and collection filters, item selection, safely sanitized feed content, persistent read/unread state, and trusted Open Original handling;
- Stage 4 lazy linked-page retrieval, jsdom/Mozilla Readability extraction, DOMPurify sanitization, PostgreSQL `item_content` caching, explicit extraction states/retry/fallback, reader loading feedback, trusted external-link handling, and trusted optimized article-image caching through an internal Electron protocol;
- Stage 5 native application menu and shortcuts, monitor-safe persisted window state, detailed fetch completion status, error/empty states, and Windows packaging;
- migration `0004_article_content`, which adds cached raw and reader article content plus extraction state;
- a validation baseline of passing type checking, 50 Vitest tests, clean migrations from zero, a healthy Docker PostgreSQL service, Windows packaging, and packaged native Electron startup with successful typed preload/PostgreSQL health, article extraction, and independent-pane layout smoke checks.

Important implementation locations:

```text
packages/feeds/                         # HTTP fetch, Feedsmith parsing, normalization, identity
packages/feeds/src/discovery.ts         # website advertised-feed discovery
packages/feeds/src/url-policy.ts        # submitted/redirect/candidate public-network validation
packages/db/src/ingestion-repository.ts # item upserts, source metadata, fetch-run persistence
packages/db/src/items-repository.ts     # Stage 3 item filters, details, read state
packages/db/src/article-content-repository.ts # Stage 4 cache and extraction state
apps/desktop/main/article-images.ts      # bounded image download and Sharp optimization
apps/desktop/main/image-protocol.ts      # item-scoped cached-image protocol
apps/desktop/main/feed-service.ts       # single/all orchestration and progress
apps/desktop/main/article-service.ts    # lazy article fetch/extract/cache orchestration
apps/desktop/main/source-service.ts     # validation-before-persistence orchestration
apps/desktop/main/source-import.ts      # CSV/JSON parsing and bounded bulk import
apps/desktop/main/application-menu.ts   # native menu and renderer commands
apps/desktop/main/window-state.ts       # validated persisted window geometry
apps/desktop/main/ipc.ts                # narrow typed handlers
apps/desktop/preload/index.ts           # validated renderer bridge
apps/desktop/renderer/src/ReaderView.tsx# Stage 3 list and reader
tests/fixtures/feeds/                   # deterministic RSS/Atom fixtures
tests/fixtures/pages/                   # deterministic discovery fixtures
tests/fixtures/import/                  # deterministic CSV/JSON import fixtures
scripts/smoke-layout.mjs                # packaged renderer pane/layout smoke check
```

Continuation cautions:

- Preserve the existing worktree. Stages 0–2 were built directly in a repository that may still contain uncommitted, staged, and untracked project files; do not reset or discard them.
- Treat migrations `0001`–`0003` as immutable because they have already been applied. The existing `feed_url` and `site_url` columns should support discovery without a schema change unless implementation evidence proves otherwise.
- Do not assume the development database is empty and do not run Fetch All tests against every persisted development source. Tests must use isolated records or repository doubles and clean up only data they create.
- A legacy source created before this amendment may contain a website URL in `feed_url` and may have failed fetch runs. New add/edit behavior must follow the amended validation rules; do not silently delete existing user sources while implementing it.
- Close any running development or packaged RSS Reader process before `pnpm package`, because Windows will lock the generated `out` directory while the application is running.
- jsdom is externalized from the Vite main bundle because it reads packaged support files at runtime. Keep jsdom as a root production dependency and preserve the focused Forge copy rule that includes production `node_modules` while excluding bundled `@rss-reader/*` workspace links; otherwise development may work while the packaged app exits before creating a renderer page.

Stages 0–5 are complete. The prototype milestone is implemented; later experiments remain deferred unless the plan is amended explicitly.

### 1.2 Post-milestone source-import and scrolling amendment

The following refinements were explicitly requested after Stage 5 and are part of the implemented prototype:

- the green navigation sidebar remains fixed to the application window;
- sidebar navigation, the item list, the article reader, and management content each own their vertical scrolling, so scrolling one reader pane does not move another;
- sidebar navigation remains scrollable without displaying scrollbar chrome, and its Sources and Collections sections are independently collapsible;
- the Sources management screen accepts `.csv` and `.json` bulk imports through a native file picker and the narrow preload/IPC boundary;
- import records use `url` (required), `name` (optional), and `collection` (optional);
- ` | ` separates multiple collection assignments, while characters such as `>` remain part of the collection name;
- missing collections are created once and reused case-insensitively during the import;
- imported names override discovered names, and an already-confirmed feed is updated rather than duplicated;
- each URL still passes normal public-network checks and direct-feed/website discovery before persistence;
- bulk import uses bounded concurrency and partial-success reporting so an unusable URL does not discard successful rows.

The attached acceptance examples `tech-ai-information-sources-url-name-collection.csv` and `.json` both normalize to 568 identical records, including 26 multi-collection records.

### 1.3 Post-milestone collection-membership editing amendment

The Manage → Collections edit flow supports changing the collection name and its complete source membership as one staged operation:

- the edit dialog shows current sources in a simple independently scrollable stacked list;
- an `×` beside an existing source marks it for removal without a separate prompt; the source remains visible with a pending-removal treatment, and clicking the marked row cancels the removal before Save;
- Add sources opens an independently scrollable multi-select checklist with search across source names and feed URLs;
- sources already in the staged membership are highlighted and disabled in the picker;
- the picker confirmation adds its selections to the staged membership, while picker cancellation discards only the picker selection;
- the outer Save applies the final name and complete source membership atomically in PostgreSQL;
- the outer Cancel or close action discards all staged name and membership changes.

Collection creation remains intentionally minimal and creates an empty collection. Existing individual membership commands remain available to trusted code, but the collection editor persists through the single validated collection-update request so a partial UI save cannot occur.

### 1.4 Configurable initial article import amendment

New sources do not import an unlimited exposed feed history. A persisted application setting named **Import article limit** defaults to 25 and accepts values from 1 through 500. It is available through the cog button at the bottom-left of the sidebar and is edited in the Settings dialog under Import and fetch.

On a source's first successful fetch, and when an existing source is changed to a different feed URL, the trusted ingestion layer ranks normalized, deduplicated entries by publication date, then source-updated date, then original feed order for undated entries. It imports only the configured number of newest entries. The external identities of older exposed entries are retained as lightweight suppression records so a later refresh does not backfill the intentionally skipped initial history. Already-imported entries can still be updated, and identities first observed after the initial import are inserted normally.

The source, selected initial items, suppressed identities, source metadata, and fetch-run counts are persisted atomically. Fetch diagnostics distinguish entries received, inserted, updated, and skipped. Changing the setting is not retroactive: it does not delete existing articles or reconsider an existing source's suppression records.

### 1.5 Cached article image amendment

Lazy article extraction includes meaningful images from both a successfully extracted linked page and feed-provided HTML used as the fallback. The trusted layer resolves normal, responsive, and common lazy-loaded image URLs; renderer HTML never retains publisher-controlled remote `src` or `srcset` values.

For each opened article, the trusted image pipeline considers at most 12 unique images in article order, validates every URL and redirect with the existing public-network policy, downloads with explicit timeout and byte limits, rejects active/unsupported formats and small tracking images, strips metadata, and resizes without enlargement to at most 1,600 by 2,400 pixels. Photographs use WebP quality 82; PNG input uses lossless WebP to protect diagrams and transparency. Individual image failures do not prevent readable text from being cached.

Migration `0006_article_images` stores optimized bytes and metadata in PostgreSQL with item-scoped cascading deletion. Sanitized reader HTML contains only opaque cached-image identifiers. A restricted `rss-reader-image://` Electron protocol validates both item and image UUIDs before returning database bytes, and the renderer CSP allows that scheme while continuing to prohibit direct publisher image loading. Images remain lazy with article extraction; there is no background image prefetch or item-list thumbnail feature.

Before this amendment was implemented, the development library was intentionally cleared at the operator's request: 205 sources, 33 collections, and their 11,428 cascaded items were removed. Consequently no existing cached-article upgrade or re-extraction path is required.

### 1.6 Article table rendering amendment

Sanitized article tables retain their semantic table structure and render with explicit row and column dividers, a distinct header row, readable cell spacing, and horizontal scrolling when their intrinsic width exceeds the reader pane. This presentation applies to both extracted full-page content and feed-provided fallback content without widening the reader layout.

### 1.7 Article relevance cleanup amendment

Before article images are collected and content is cached, the trusted extraction layer removes author/avatar/headshot images and known recommendation modules identified as related, recommended, more-from, read-next, also-read, Outbrain, or Taboola content. It also trims content following a trailing recommendation heading. The cleanup runs before Readability for linked pages and again while preparing both extracted and feed-provided HTML, while preserving ordinary inline article links and prose.

### 1.8 Bulk source deletion amendment

Manage → Sources has an explicit selection mode entered through Manage. Individual sources or all sources can be staged with the same pending-removal treatment used by the collection editor. Cancel discards the selection, while the count-labelled delete confirmation sends one bounded, validated IPC request. The trusted repository verifies that every selected source still exists and deletes the full set atomically; existing source cascades remove their items, cached content, images, memberships, suppressions, and fetch history.

### 1.9 Collapsible icon sidebar amendment

Every sidebar destination and section control has a tree-shaken Lucide React icon. A labelled left-arrow control collapses the sidebar to a 72-pixel icon rail; the corresponding right-arrow expands it. Text, counts, and section chevrons are hidden in the collapsed state while native title text and accessible labels preserve discoverability. The renderer owns this transient layout state and the sidebar remains independent of the trusted preload/IPC boundary.

### 1.10 Fullscreen reader amendment

The article action bar includes a Lucide expand/minimize control. Fullscreen reader mode hides only the item-list column and lets the reader pane occupy the complete existing reader grid; the application sidebar, workspace header, trusted content handling, and independent reader scrolling remain intact. This is transient renderer state and does not invoke Electron's window-level fullscreen mode.

### 1.11 Approved base colour amendment

The renderer defines exactly four literal colour tokens: background `#171615`, sidebar and raised surfaces `#1E1D1B`, text and icons `#D6D5D4`, and interactive highlights/notices `#4E99A3`. Borders, muted text, overlays, hover states, and selected surfaces are transparency or CSS colour-mix derivatives of those approved tokens; no additional literal colour is introduced. A focused test enforces this palette constraint.

### 1.12 Navigation, update, collection-icon, favicon, and reader amendment

The following later requirements are authoritative where they conflict with earlier Fetch All, sidebar-management, collection, or fullscreen wording:

- one Lucide Update Sources control beside Settings (or above it in the collapsed icon rail) replaces every renderer fetch button, and all enabled sources update once automatically after application startup;
- update progress appears as a compact bottom-right pop-up showing completed and total sources. Its disclosure control expands the existing per-source details, manual dismissal remains available throughout the run, and completed status waits five seconds before fading away;
- Sources starts collapsed; collapsing the sidebar also collapses Sources and Collections and prevents disclosure until the sidebar is expanded;
- the Sources and Collections section labels navigate to their management views, while only adjacent disclosure controls expand their lists; the duplicate Manage section is removed;
- migration `0007_collection_icons` adds a persisted curated icon key to collections, defaulting existing collections to `folder`; create and edit flows offer nine relevant tree-shaken Lucide choices;
- collection and source management cards navigate to their respective filtered library views, except that a source card toggles selection when bulk-delete selection mode is active;
- source icons use a restricted `rss-reader-favicon://` protocol. Trusted code derives the conventional favicon URL from the persisted public site/feed origin, revalidates redirects, and enforces timeout, type, and byte limits; renderer failures fall back to the Lucide RSS icon;
- fullscreen reader mode is an in-app workspace-covering reader box, not Electron window fullscreen. It covers the banner and item list while preserving the sidebar, centers readable content, and uses an icon-only expand/minimize control in the box's top-right corner;
- each article reader starts with its read/unread toggle followed by boundary-aware previous and next controls. The previous/next controls follow the current visible list order and are disabled at its ends; the article title is the sole in-view Open Original control and exposes an `Open in web` hover/focus tooltip;
- Manage Sources actions are ordered Edit, Disable/Enable, Delete;
- single source and collection deletion use explicit in-app consequence prompts rather than operating-system confirmation dialogs.
- database health accepts the versioned `stage-N` metadata format instead of hard-coding one migration value, and diagnostic health failures are isolated from base source, collection, item, and settings loading so valid application data remains usable.

The initial Stage 2 implementation saved a source row and then fetched the submitted URL as though it were a direct feed. That behavior was superseded by the amendment below. The current implementation validates and resolves the feed before atomically mutating persistent source state.

Required amended behavior:

- Accept a normal public HTTP/HTTPS website URL or direct RSS/Atom URL.
- Try the submitted resource as a feed first.
- If it is HTML, inspect advertised RSS/Atom `<link rel="alternate">` elements, resolve relative links, and try a small bounded, deduplicated candidate list.
- Use the first candidate that can be fetched and parsed as a supported RSS/Atom feed.
- Save a new source only after a usable feed has been confirmed and its limited initial entry selection can be imported.
- When editing the URL, validate and resolve the replacement before changing the existing source; failure must leave the original source untouched.
- Store the confirmed final feed URL in `sources.feed_url`. Store the feed-declared website URL when available, otherwise the submitted website URL, in `sources.site_url`.
- Reject the operation with a clear error when no usable feed exists. Do not leave a failed placeholder source behind.
- Apply the same public-network restrictions to submitted URLs, redirects, and discovered candidates. Localhost, credential-bearing URLs, and private/link-local network targets are not valid source inputs.
- Use jsdom in trusted code for discovery HTML parsing. This brings only HTML link discovery forward. DOMPurify is also used in Stage 3 solely to render untrusted feed-provided HTML safely; Readability, linked-page fetching, and full-page extraction remain Stage 4.
- Do not add arbitrary crawling, common-path guessing, scheduled polling, or website content ingestion as part of discovery.

The renderer must continue to use the typed preload/IPC boundary. Discovery, network access, parsing, validation, and persistence remain trusted-layer responsibilities.

---

## 2. Product scope

### 2.1 Initial capabilities

The first useful version supports:

1. **Sources**
   - Add either a website URL or a direct RSS/Atom feed URL.
   - Automatically discover an advertised RSS/Atom feed from a submitted website URL.
   - Accept and persist the source only after confirming a usable feed.
   - Automatically retrieve feed metadata where available.
   - Rename a source.
   - Edit its feed URL.
   - Enable or disable it.
   - Delete it.
   - Fetch one source manually.

2. **Collections**
   - Create, rename, and delete collections/categories/boards.
   - Assign a source to one or more collections.
   - Remove a source from a collection without deleting the source.

3. **Fetching**
   - `Fetch all` for all active sources.
   - Fetch one selected source.
   - First fetch imports up to the configured initial article limit from the newest items currently exposed by the feed.
   - Later fetches insert new items and update existing items where appropriate.
   - Show per-source success, failure, unchanged, and new-item counts.

4. **Browsing**
   - Browse all items.
   - Browse unread items.
   - Browse by collection.
   - Browse by source.
   - Sort primarily by publication date, falling back to first-seen date.

5. **Reading**
   - Open an item inside the application.
   - Initially render content supplied by the feed.
   - Later fetch and cache the linked webpage and extract a clean reader view.
   - Mark items read/unread.
   - Open the original webpage externally when required.

### 2.2 Explicitly out of scope initially

Do not add these until the core reader is working:

- Authentication or users.
- Web server or local HTTP API.
- Cloud hosting or sync.
- Scheduled/background polling.
- Graphile Worker or another durable job queue.
- AI, summaries, embeddings, semantic search, or MCP.
- Research workflows, evidence records, claims, or briefs.
- Rich-text authoring or content creation.
- Publication or distribution.
- Browser extension or share-sheet capture.
- Highlights, annotations, or note-taking.
- Full-text search beyond simple database filtering unless later useful.
- Canvas or graph interfaces.
- Mobile clients.
- Multi-user features.

---

## 3. Development environment

Development is Windows-native.

### 3.1 Host environment

- **OS:** Windows 11.
- **IDE:** WebStorm.
- **AI development:** Codex Windows desktop app and Codex integration inside the IDE.
- **Runtime:** Windows Node.js.
- **Package manager:** pnpm.
- **Source control:** Git.
- **Database infrastructure:** Docker Desktop running PostgreSQL.

WSL2 is not used as the development environment. Docker Desktop may internally use WSL2; that is an implementation detail and does not affect the development workflow.

### 3.2 IDE choice

Use **WebStorm** as the primary IDE because the project is entirely TypeScript/React/Node/Electron and WebStorm also provides:

- PostgreSQL database tooling.
- Docker and Docker Compose integration.
- Git integration.
- JavaScript/TypeScript debugging.
- React support.
- Node/Electron run configurations.

DataGrip is optional, not required.

---

## 4. Technology stack

| Area | Choice |
|---|---|
| Language | TypeScript |
| Desktop runtime | Electron |
| UI | React |
| Build/dev server | Vite |
| Packaging | Electron Forge |
| Package manager | pnpm |
| Runtime validation | Zod |
| Database | PostgreSQL |
| Development DB runtime | Docker Compose |
| PostgreSQL driver | `pg` / node-postgres |
| Query layer | Kysely |
| Feed parsing | Feedsmith |
| HTML DOM | jsdom |
| Article extraction | Mozilla Readability |
| HTML sanitization | DOMPurify |
| Unit/integration tests | Vitest |
| Later UI smoke tests | Playwright Electron if useful |

No application server framework is required.

---

## 5. Runtime architecture

Use a small local modular monolith.

```text
Windows
│
├─ Electron application
│  ├─ Main process
│  │  ├─ application lifecycle
│  │  ├─ IPC handlers
│  │  ├─ database access
│  │  ├─ source/collection/item services
│  │  └─ fetch orchestration
│  │
│  ├─ Preload
│  │  └─ narrow typed API exposed to renderer
│  │
│  ├─ Renderer
│  │  └─ React UI
│  │
│  └─ Utility process (introduced when useful)
│     └─ feed/page fetching and parsing
│
└─ Docker Desktop
   └─ PostgreSQL container
      └─ persistent Docker volume
```

### 5.1 Core boundary

The renderer must not:

- connect directly to PostgreSQL;
- access arbitrary filesystem paths;
- have unrestricted Node.js access;
- execute arbitrary shell commands;
- perform privileged operations directly.

The flow is:

```text
React renderer
  → typed preload API
  → Electron IPC
  → application service
  → PostgreSQL / network / filesystem
```

### 5.2 No local web server

Do not introduce Express, Fastify, Next.js, REST, GraphQL, or localhost HTTP endpoints.

The application is a desktop application, not a web application wrapped in Electron.

### 5.3 Utility process

Start with simple trusted-process orchestration. Move feed fetching, page fetching, parsing, and extraction into an Electron utility process once needed for responsiveness.

Reasons to introduce it:

- Fetch All should not block the UI.
- Article extraction may be CPU-heavy.
- Fetch progress and cancellation become easier to model.
- Failures are better isolated from the Electron main process.

A durable queue is unnecessary for the first prototype.

---

## 6. PostgreSQL in Docker

### 6.1 Development use

Run PostgreSQL in Docker; run Electron natively on Windows.

```text
Electron.exe → localhost:5432 → PostgreSQL container
```

Example development configuration:

```yaml
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: reader
      POSTGRES_USER: reader
      POSTGRES_PASSWORD: reader_dev
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 6.2 Development commands

```powershell
docker compose up -d
docker compose down
```

To intentionally destroy the development database:

```powershell
docker compose down -v
docker compose up -d
```

### 6.3 Why only PostgreSQL is containerised

Docker is useful for disposable, reproducible development infrastructure. Electron should not run in Docker because the prototype is specifically intended to exercise native Windows desktop behaviour.

Do not require Docker Desktop as a runtime dependency for a future installed version of the reader. Final database packaging is a later decision.

---

## 7. Suggested repository structure

Keep package boundaries small and practical.

```text
reader/
├─ apps/
│  └─ desktop/
│     ├─ main/
│     ├─ preload/
│     └─ renderer/
│
├─ packages/
│  ├─ contracts/        # Zod schemas and shared IPC contracts
│  ├─ db/               # Kysely types, repositories, migrations
│  ├─ domain/           # simple domain types/rules
│  └─ feeds/            # fetch, parse, normalize, extract
│
├─ migrations/
├─ tests/
│  └─ fixtures/
│     ├─ feeds/
│     └─ pages/
│
├─ compose.yaml
├─ .env.example
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.json
└─ README.md
```

Avoid creating packages that do not yet have a clear responsibility.

---

## 8. Data model

Keep the database explicit and small.

### 8.1 `sources`

Represents one RSS/Atom subscription.

Suggested fields:

```text
id
name
feed_url
site_url
description
enabled
etag
last_modified
last_fetched_at
created_at
updated_at
```

Recommended constraints:

- unique normalized `feed_url`;
- non-empty `name` and `feed_url`;
- timestamps generated consistently.

`feed_url` is the normalized, confirmed final feed URL and may differ from the URL entered by the user. `site_url` is the associated website URL declared by the feed or, when discovery began from a webpage, the submitted/final webpage URL as a fallback.

### 8.2 `collections`

Represents a user-created category/board.

```text
id
name
created_at
updated_at
```

### 8.3 `collection_sources`

Many-to-many relationship between sources and collections.

```text
collection_id
source_id
created_at
```

Primary/unique key:

```text
(collection_id, source_id)
```

A source can therefore appear in multiple collections without duplication.

### 8.4 `items`

Represents one logical feed entry/article.

```text
id
source_id
external_id
canonical_url
title
author
published_at
source_updated_at
summary
feed_content_html
first_seen_at
last_seen_at
read_at
created_at
updated_at
```

Identity preference:

1. feed GUID / Atom ID;
2. canonical item URL;
3. deterministic fallback identity when neither exists.

Do not assume all feeds provide reliable GUIDs.

### 8.5 `item_content`

Stores optional full-page reader extraction separately from feed metadata.

```text
item_id
retrieved_url
raw_html
reader_html
reader_text
extraction_status
extraction_error
fetched_at
updated_at
```

Possible extraction states:

```text
not_requested
fetching
complete
partial
failed
```

`raw_html` may later be moved out of PostgreSQL if storage becomes significant. It is acceptable in the prototype.

### 8.6 `fetch_runs`

Basic operational history for debugging and UI feedback.

```text
id
source_id              # nullable for aggregate Fetch All run if desired
started_at
completed_at
status
http_status
items_received
items_inserted
items_updated
error_message
```

This is not a durable workflow engine. It is simple observable history.

---

## 9. Database access and migrations

### 9.1 Access

Use:

- `pg` for PostgreSQL connections and transactions;
- Kysely for typed SQL and repositories;
- explicit SQL for indexes and database-specific features when clearer.

Keep a deliberately small connection pool.

### 9.2 Migrations

- Store migrations in source control.
- Treat already-applied migrations as immutable.
- Run migrations on application startup during development, or through an explicit development command if startup behaviour becomes inconvenient.
- Test migrations against an empty database regularly.

### 9.3 Renderer restriction

Only trusted backend modules import the database package. The renderer receives DTOs through IPC.

---

## 10. IPC and application contracts

Expose narrow operations rather than a generic database or IPC bridge.

Conceptual preload surface:

```ts
sources.list()
sources.get(id)
sources.create(input)
sources.update(id, input)
sources.delete(id, options)
sources.fetch(id)

collections.list()
collections.create(input)
collections.update(id, input)
collections.delete(id)
collections.addSource(collectionId, sourceId)
collections.removeSource(collectionId, sourceId)

items.list(filter)
items.get(id)
items.markRead(id)
items.markUnread(id)
items.loadReaderContent(id)

fetch.all()
fetch.getStatus()
```

Use Zod at IPC boundaries for both inputs and important returned structures.

Prefer distinct IPC methods over passing `ipcRenderer` itself into the renderer.

For source creation and feed-URL replacement, the renderer submits one URL and optional collection membership. The trusted application layer resolves and validates that URL, then returns either a persisted source plus initial fetch result or a clear validation failure. The renderer does not perform discovery itself.

---

## 11. Feed ingestion

### 11.1 Source URL resolution and feed discovery

Source creation and feed-URL replacement use this sequence:

```text
Submitted public HTTP/HTTPS URL
  ↓
Fetch with timeout, size, redirect, and public-network checks
  ↓
Try parsing response directly as RSS/Atom
  ↓ not a feed, but HTML
Parse HTML with jsdom without executing scripts
  ↓
Collect advertised RSS/Atom alternate links
  ↓
Resolve relative URLs, deduplicate, and try a bounded candidate list
  ↓
Confirm one candidate with Feedsmith
  ↓
Select and import its newest exposed entries up to the configured limit
  ↓
Persist source, resolved metadata, items, and fetch run
```

Only advertised RSS/Atom links are discovered initially. Do not crawl the site, guess common paths, render the page, or retain page HTML.

A failed add operation must create no source, collection membership, item, or fetch-run record; pre-persistence validation failures can remain transient UI/application errors because `fetch_runs.source_id` requires a persisted source. A failed edit operation must preserve the existing source URL, validators, metadata, items, and memberships.

Redirect destinations and discovered candidates must be checked using the same source-URL policy as the submitted URL. Discovery remains limited to public HTTP/HTTPS resources.

### 11.2 First fetch

"Full fetch" means:

> Import every item currently exposed by the feed.

It does not mean crawling the publisher's entire historical archive. RSS/Atom feeds frequently expose only a bounded recent history.

### 11.3 Fetch sequence

```text
Load source
  ↓
HTTP GET feed
  ↓
Use ETag / Last-Modified when available
  ↓
Parse RSS/Atom
  ↓
Normalize feed metadata and entries
  ↓
Resolve logical item identity
  ↓
Upsert items
  ↓
Update source fetch metadata
  ↓
Record fetch run
```

### 11.4 Conditional HTTP requests

Store and reuse:

- `ETag` → `If-None-Match`;
- `Last-Modified` → `If-Modified-Since`.

A `304 Not Modified` is a successful unchanged fetch, not an error.

### 11.5 Item normalization

Normalize parser-specific values into a stable internal model:

```text
external_id
url
title
author
published_at
updated_at
summary
content_html
```

Keep parser-specific metadata only if it becomes useful.

### 11.6 Upsert behaviour

For each item:

- insert if unseen;
- update mutable feed-derived fields if an existing item has changed;
- preserve local state such as `read_at`;
- update `last_seen_at` whenever observed again.

### 11.7 Fetch All

`Fetch All`:

- reads all enabled sources;
- processes them with modest bounded concurrency;
- reports progress per source;
- continues when one source fails;
- gives a final summary rather than failing the whole operation.

Example progress information:

```text
3 / 12 sources
OpenAI Blog       4 new
GitHub Blog       unchanged
Cloudflare Blog   fetching
Example Feed      failed
```

### 11.8 Errors

Represent expected errors cleanly:

- network failure;
- timeout;
- invalid feed;
- unsupported response;
- HTTP authentication/error response;
- malformed item;
- database error.

One broken source must not prevent other sources from updating.

---

## 12. Article extraction and reader content

Feed ingestion and webpage extraction are separate operations.

### 12.1 Initial reader

First render the best content already supplied by the feed:

1. full feed HTML if available;
2. summary/description otherwise;
3. title + external-link fallback if little content exists.

### 12.2 Full-page reader extraction

Add full-page extraction after feed reading works.

```text
Item URL
  ↓
HTTP fetch
  ↓
jsdom DOM
  ↓
Mozilla Readability
  ↓
DOMPurify
  ↓
store sanitized reader HTML/text
  ↓
render inside application
```

### 12.3 Lazy extraction

Initial strategy:

- do not fetch every linked article during Fetch All;
- extract on first reader open when useful content is not already cached;
- cache the successful extraction.

This keeps feed refresh fast and reduces unnecessary requests.

Later, eager background extraction can be tested if it improves experience.

### 12.4 Original source

Always retain the original URL and provide `Open original` in the system browser.

---

## 13. Security boundaries

Although the prototype is local, ingested feeds and webpages are untrusted external content.

### 13.1 Electron renderer

- Keep `contextIsolation` enabled.
- Keep renderer sandboxing enabled where practical.
- Do not enable unrestricted Node integration.
- Do not expose raw `ipcRenderer`.
- Validate IPC inputs.

### 13.2 Reader HTML

- Sanitize extracted HTML before rendering.
- Do not execute source scripts.
- Strip or block dangerous attributes and embedded active content.
- Use a restrictive Content Security Policy.
- Open ordinary external links through the default system browser rather than navigating the privileged app window.

### 13.3 Network fetching

Initially support normal public HTTP/HTTPS feed and article URLs.

Website-to-feed discovery makes arbitrary URL ingestion capable enough that protection against unintended local/private network access is now required in Stage 2. Apply it to submitted URLs, redirect destinations, and discovered feed candidates. Reject credentials, localhost/local hostnames, and loopback/private/link-local address ranges.

### 13.4 Secrets

No application secrets are required initially beyond a local development database connection string.

Do not expose database credentials to the renderer.

---

## 14. UI design

Use a conventional desktop reader. Do not use a canvas.

### 14.1 Primary layout

A practical first layout is three regions:

```text
┌──────────────────┬────────────────────┬─────────────────────────┐
│ Navigation       │ Item list          │ Reader                  │
│                  │                    │                         │
│ All Items        │ title              │ article title           │
│ Unread           │ source             │ metadata                │
│                  │ date               │ content                 │
│ Collections      │ unread state       │                         │
│   AI             │                    │ Open original           │
│   Development    │                    │                         │
│                  │                    │                         │
│ Sources          │                    │                         │
│   OpenAI         │                    │                         │
│   GitHub         │                    │                         │
└──────────────────┴────────────────────┴─────────────────────────┘
```

A two-pane variant is acceptable initially if simpler.

### 14.2 Navigation

Core navigation:

- All Items.
- Unread.
- Collections.
- Sources.
- Source management/settings.

### 14.3 Item list

Show at minimum:

- title;
- source;
- publication date;
- unread/read state.

Optional later additions:

- short excerpt;
- author;
- extraction availability.

### 14.4 Reader pane

Show:

- title;
- source;
- author when available;
- publication date;
- clean article/feed content;
- `Open original`;
- read/unread control.

### 14.5 Toolbar

Initial toolbar actions:

- Add Source.
- Fetch All.
- Fetch current source where relevant.
- Manage Sources/Collections.

Keyboard shortcuts can be added after the basic interaction works.

---

## 15. Source management UX

### 15.1 Add Source

Initial dialog fields:

```text
Website or feed URL
Collection(s) — optional
```

After successful retrieval, populate where available:

- feed title;
- site URL;
- description.

The source is saved only after the trusted application layer confirms a usable direct or discovered RSS/Atom feed. If no usable feed is found, keep the dialog open and show a clear error without creating a source.

### 15.2 Edit Source

Allow:

- display name;
- website or feed URL, resolved and validated before persistence;
- collection membership;
- enabled/disabled state;
- Fetch Now.

### 15.3 Delete Source

Deletion should explicitly decide between:

- delete source and its downloaded items; or
- remove/disable the source while retaining existing items.

The initial implementation may choose one clear policy, but the UI must make the consequence understandable.

### 15.4 Collections

Allow:

- create;
- rename;
- delete;
- assign/unassign sources.

Deleting a collection does not delete its sources or items.

---

## 16. Application state and responsiveness

### 16.1 UI state

Keep UI state separate from persistent state.

Persistent state belongs in PostgreSQL:

- sources;
- collections;
- items;
- read status;
- extracted content;
- fetch history.

Transient renderer state includes:

- selected navigation item;
- selected article;
- open dialog;
- current fetch progress;
- temporary filters.

### 16.2 Long-running operations

Fetching and extraction must be asynchronous and cancel/fail cleanly.

The UI should never freeze while:

- fetching multiple feeds;
- parsing large feeds;
- fetching an article;
- running Readability.

---

## 17. Logging and diagnostics

Keep diagnostics simple.

Log at least:

```text
timestamp
level
operation
source_id/item_id where relevant
status
duration
error category/message
```

During development, console logging is acceptable initially. Move to structured logging if debugging becomes difficult.

Fetch history should also be visible through database records so failed sources can be inspected without reading logs.

Do not log full article contents or credentials by default.

---

## 18. Testing strategy

### 18.1 Unit tests

Use Vitest for:

- feed normalization;
- item identity selection;
- collection/source rules;
- date normalization;
- URL normalization where implemented;
- reader extraction helpers;
- IPC schema validation.

### 18.2 Feed fixtures

Do not make parser tests depend on live internet sources.

Create fixtures for:

- RSS 2.0;
- Atom;
- feed with full HTML content;
- summary-only feed;
- missing GUID;
- duplicate entries;
- updated entry;
- malformed feed;
- empty feed;
- unusual dates.

### 18.3 Page fixtures

Create representative HTML fixtures for:

- standard article;
- article with navigation/sidebar clutter;
- minimal content;
- malformed HTML;
- dangerous script/HTML payloads.

### 18.4 PostgreSQL integration tests

Use a real PostgreSQL database for:

- migrations;
- inserts/upserts;
- source/collection relations;
- duplicate handling;
- read-state preservation during item updates;
- deletion behavior.

The development Docker instance can be used locally; CI can later use a disposable PostgreSQL service/container.

### 18.5 Electron smoke tests

Add a small Electron UI suite only after important behavior exists.

Highest-value scenarios:

1. Launch app and connect to database.
2. Add a source.
3. Fetch it.
4. See items.
5. Open an item.
6. Mark it read.
7. Restart app and retain state.

Do not over-invest in GUI automation early.

---

## 19. Development workflow

### 19.1 Normal local workflow

```powershell
docker compose up -d
pnpm install
pnpm dev
```

WebStorm and Codex operate directly on the Windows repository.

### 19.2 Suggested scripts

```text
pnpm dev            # run Electron development build
pnpm test           # Vitest
pnpm test:watch
pnpm lint
pnpm typecheck
pnpm db:migrate
pnpm db:reset        # development only
pnpm package         # build/package Electron
```

Keep scripts deterministic so Codex can run the same checks as the developer.

### 19.3 Environment configuration

Use `.env.example` for development configuration such as:

```text
DATABASE_URL=postgresql://reader:reader_dev@127.0.0.1:5432/reader
```

Do not commit private runtime credentials if they later become meaningful.

---

## 20. Implementation sequence

### Stage 0 — Project skeleton

Implement:

- pnpm workspace;
- Electron Forge + Vite + TypeScript;
- React renderer;
- secure preload bridge;
- basic typed IPC;
- Docker Compose PostgreSQL;
- database connection;
- migration mechanism;
- Vitest configuration.

**Exit criteria**

- Electron opens natively on Windows.
- Renderer calls one typed IPC method successfully.
- Main process queries PostgreSQL successfully.
- Clean database can be migrated from zero.

---

### Stage 1 — Sources and collections

Implement:

- `sources` schema and repository;
- `collections` schema and repository;
- many-to-many source membership;
- source-management UI;
- collection-management UI;
- enable/disable source.

**Exit criteria**

- Sources can be created, edited, disabled, and deleted.
- Collections can be created, edited, and deleted.
- One source can belong to several collections.
- State survives application restart.

---

### Stage 2 — Feed ingestion

**Status:** Complete. The ingestion core and discovery-and-validation amendment pass the exit criteria below.

Implement:

- Feedsmith integration;
- HTTP feed fetching;
- direct-feed validation before source persistence;
- website HTML fetching and jsdom-based advertised feed discovery;
- relative discovered-URL resolution and bounded candidate validation;
- public-network target validation for submitted URLs, redirects, and candidates;
- RSS/Atom normalization;
- item identity strategy;
- item upserts;
- `ETag` / `Last-Modified` handling;
- single-source Fetch Now;
- Fetch All;
- fetch progress;
- fetch run records;
- feed fixtures and ingestion tests.

**Exit criteria**

- First fetch imports the configured number of newest exposed feed entries and suppresses the older initial backlog from later refreshes.
- A direct RSS/Atom URL can be added successfully.
- A normal website URL advertising a relative RSS/Atom link resolves to and stores the usable feed URL.
- A URL with no usable direct or advertised feed produces a clear error and persists no source.
- An invalid replacement URL leaves the existing source unchanged.
- Local/private targets are rejected during submission, redirect, and candidate validation.
- Re-fetch does not duplicate logical items.
- New items appear correctly.
- Changed items update without losing local read state.
- One broken source does not stop Fetch All.
- Unchanged feeds can complete via conditional request.

---

### Stage 3 — Library and feed reader

**Status:** Complete.

Implement:

- All Items view;
- Unread view;
- source filtering;
- collection filtering;
- item list;
- item selection;
- feed-content reader;
- read/unread state;
- Open Original.

**Exit criteria**

- The application is already usable as a basic RSS/Atom reader.
- User can move from source/collection → item → readable feed content.
- Read state persists.

---

### Stage 4 — Full article reader

**Status:** Complete.

Implement:

- linked-page fetch;
- jsdom parsing;
- Readability extraction;
- DOMPurify sanitization;
- cached `item_content`;
- extraction states and retry;
- loading/progress state in reader;
- safe external-link handling;
- article extraction/security fixtures.

Initial extraction is lazy on reader open.

**Exit criteria**

- Summary-only feeds can usually produce a clean full article view.
- Extracted content is sanitized before rendering.
- Failed extraction has a clear fallback to feed content/original page.
- Reopening an extracted article uses cached content.

---

### Stage 5 — Desktop refinement and packaging

**Status:** Complete.

Implement only after the core experience works:

- application menu;
- useful keyboard shortcuts;
- window-state persistence;
- improved fetch progress/status;
- error/empty states;
- packaged Windows build;
- clean-machine smoke testing.

Possible later experiments:

- tray integration;
- notifications;
- application icon/installer;
- automatic database startup strategy for installed builds.

**Exit criteria**

- Packaged Windows build can launch and operate against the development database.
- Core workflow remains stable outside the development server.

---

## 21. Core acceptance test

The prototype reaches its intended first milestone when the operator can perform this real workflow:

```text
Start application
  ↓
Create collection "AI"
  ↓
Add several RSS/Atom sources
  ↓
Assign sources to one or more collections
  ↓
Press Fetch All
  ↓
See new items and fetch status
  ↓
Browse the AI collection
  ↓
Open an item
  ↓
Read feed content or extracted full article
  ↓
Mark it read
  ↓
Restart application
  ↓
Retain sources, collections, items, and read state
```

The milestone is successful when this works reliably across several real feeds without duplicate growth or UI blocking.

---

## 22. Important implementation decisions

The following decisions are considered locked for this prototype unless evidence during implementation justifies changing them:

1. **Windows-native development.**
2. **WebStorm as the primary IDE.**
3. **Codex Windows app + IDE integration.**
4. **Electron runs natively on Windows.**
5. **PostgreSQL runs in Docker Compose during development.**
6. **Electron is not containerised.**
7. **No local HTTP application server.**
8. **Renderer does not access PostgreSQL directly.**
9. **Typed preload/IPC is the application boundary.**
10. **Sources can belong to multiple collections.**
11. **First feed fetch imports only the configured newest portion of the history exposed by the feed; skipped initial identities are not backfilled later.**
12. **Feed ingestion and article extraction are separate operations.**
13. **Full article extraction is initially lazy and cached.**
14. **Untrusted extracted HTML is sanitized before display.**
15. **No job queue, AI, MCP, semantic search, authoring, or publication in the initial build.**
16. **Source entry accepts a public website or feed URL, but persistence occurs only after a usable RSS/Atom feed is resolved and validated.**

---

## 23. Later decisions, not required now

### 23.1 Installed PostgreSQL strategy

Development uses Docker, but a future installed desktop application should not require Docker Desktop.

Possible later approaches:

- separate normal PostgreSQL installation;
- application-managed PostgreSQL binaries/cluster;
- reconsider the datastore only if the prototype demonstrates PostgreSQL is inappropriate.

Do not solve this before the reader is useful.

### 23.2 Background polling

Only add scheduled source refresh after manual Fetch All works reliably.

At that point evaluate whether simple Electron timers are sufficient or a durable PostgreSQL-backed worker provides useful recovery semantics.

### 23.3 Search

Only add PostgreSQL full-text search after enough items exist to demonstrate a real need.

Do not add semantic/vector search to this prototype without a specific retrieval problem.

### 23.4 Additional source types

Automatic discovery of an advertised RSS/Atom feed from a website URL is no longer deferred; it is required to complete Stage 2 as specified in Sections 1.1 and 11.1.

Potential later experiments:

- OPML import/export;
- JSON Feed if not already handled through the parser;
- newsletters/email;
- PDFs;
- manual URL capture;
- browser capture.

Each should be added as a separate learning increment rather than turning the prototype into Reason.

### 23.5 Content workflow

A simple content-creation/distribution experiment may later be built on top of the reader, but it is explicitly not part of the initial implementation plan.

---

## 24. Final stack card

| Layer | Decision |
|---|---|
| Development OS | Windows 11 native |
| IDE | WebStorm |
| AI coding tools | Codex Windows desktop + IDE integration |
| Language | TypeScript |
| Desktop shell | Electron |
| Renderer | React |
| Build | Vite |
| Packaging | Electron Forge |
| Package manager | pnpm |
| Contracts | Zod |
| Database | PostgreSQL |
| Dev database runtime | Docker Compose |
| DB access | `pg` + Kysely |
| Feed parser | Feedsmith |
| Article extraction | jsdom + Mozilla Readability |
| Sanitization | DOMPurify |
| Tests | Vitest; focused Electron smoke tests later |
| App boundary | typed preload API + Electron IPC |
| HTTP application server | None |
| Background queue | None initially |
| AI/MCP | None initially |
| Search | Simple filtering initially |
| Installed DB packaging | Deferred |

---

## 25. Prototype principle

The prototype should remain small enough that every added component teaches something directly relevant to desktop application engineering.

The purpose is not to approximate the complete Reason feature set. It is to produce a real, pleasant RSS/Atom reader while learning the foundations that may later be reused:

> **Electron processes + IPC + React + TypeScript + PostgreSQL + ingestion + safe reader rendering + Windows packaging.**
