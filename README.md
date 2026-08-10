# RSS Reader Prototype

A deliberately small Windows-native Electron application used to learn Electron process separation, typed IPC, React, PostgreSQL, feed ingestion, full-article extraction, and safe feed reading. Stages 0–5 are complete.

## Prerequisites

- Windows 11
- Node.js 24 or newer
- pnpm 11
- Docker Desktop with the Linux container engine running
- Git

Electron runs natively on Windows. Only PostgreSQL runs in Docker.

## First-time setup

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

The application opens a native Electron window with All Items, Unread, source, and collection views. Sources can be managed and fetched individually or together. Adding either a normal website URL or a direct feed URL first resolves and validates a usable public RSS/Atom feed; only then are the source and its currently exposed entries saved.

The Sources screen also supports bulk import from CSV or JSON through **Import CSV / JSON**. Each record must contain `url`; `name` and `collection` are optional. Separate multiple collection names with ` | `. Missing collections are created automatically. Every row still goes through normal website/feed discovery, so unusable URLs are reported as failures while valid rows continue importing.

```csv
url,name,collection
"https://example.com/","Example","AI | Daily"
```

```json
[
  {"url":"https://example.com/","name":"Example","collection":"AI | Daily"}
]
```

Later fetches reuse stored ETag and Last-Modified validators. A 304 response is recorded as a successful unchanged run. Items, read state, fetch history, and cached reader content are stored in PostgreSQL. Opening an item lazily fetches its linked page, extracts the main article with Mozilla Readability, sanitizes it, and falls back to feed content if extraction fails. Reopening the item uses the cached result unless Retry is selected.

The article reader places its read/unread and previous/next controls above the source and title. Previous and next follow the current visible list and disable at its boundaries. Click the article title to open the original page in the system browser; its tooltip reads `Open in web`.

Select article text to open the Lucide Highlight / Annotate menu. Highlights use the saved-note colour, annotations add an editable plain-text note, and overlapping passages are rejected. Hover over a saved passage for 350 ms, or focus/click it immediately, to view its annotation and edit, delete, or locate it in Notes. Outside clicks close clean pop-ups; unsaved annotation drafts remain open, shake, and display `Not saved!`. The sidebar Notes entry appears below Sources; its page organises saved passages by collection and article, supports search/filter/sort/edit/delete, and links back to the highlighted passage. Notes survive source deletion using article, source, URL, and collection snapshots.

Source updates report progress in a compact bottom-right status pop-up. Expand its disclosure arrow for per-source results, dismiss it at any time, or leave it to fade automatically five seconds after the update completes.

Useful Windows menu shortcuts:

- `Ctrl+N`: add source;
- `Ctrl+Shift+I`: import sources from CSV/JSON;
- `Ctrl+R`: update all enabled sources;
- `Ctrl+Up` / `Ctrl+Down`: previous / next item;
- `Ctrl+Shift+U`: mark the selected item read or unread;
- `Ctrl+O`: open the original page in the default browser.

## Normal development

```powershell
docker compose up -d --wait
pnpm dev
```

Useful checks and commands:

```powershell
pnpm test
pnpm test:watch
pnpm typecheck
pnpm db:migrate
pnpm package
```

`pnpm package` writes the unpacked Windows application to `out/RSS Reader Prototype-win32-x64`. Close any running development or packaged copy before rebuilding because Windows locks `app.asar`. The packaged prototype still intentionally connects to the Docker-backed development PostgreSQL instance; an installed-database strategy remains deferred.

## Clean development database

`db:reset` is intentionally limited to the local `reader` database on `127.0.0.1` or `localhost` and is disabled in production:

```powershell
pnpm db:reset
```

To prove a completely clean Docker-backed restart, including removal of the persistent development volume:

```powershell
docker compose down -v
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

## Architecture boundary

- `apps/desktop/main` owns lifecycle, native menus, window-state persistence, IPC handlers, migrations, database access, feed fetching, and article extraction orchestration.
- `apps/desktop/main/source-import.ts` owns bounded CSV/JSON parsing, collection resolution, progress, and partial-success import orchestration.
- `apps/desktop/preload` exposes only the narrow typed `readerApi` bridge.
- `apps/desktop/renderer` is a sandboxed React UI without Node.js or database access.
- `packages/contracts` contains shared Zod-validated IPC contracts.
- `packages/db` contains Kysely/PostgreSQL setup and the explicit migration runner.
- `packages/feeds` contains HTTP fetching, Feedsmith parsing, normalization, item identity selection, jsdom/Readability extraction, and DOMPurify sanitization.
- `packages/feeds` also contains bounded website feed discovery and public-network URL validation.
- `apps/desktop/main/favicon-protocol.ts` exposes source favicons through a restricted trusted protocol with RSS-icon fallback in the renderer.
- `packages/db/src/items-repository.ts` owns item filtering, details, and read state.
- `packages/db/src/article-content-repository.ts` owns cached full-article content and extraction state.
- `migrations` contains immutable ordered migrations, including persisted curated collection icons in `0007_collection_icons` and deletion-safe highlights/annotations in `0008_notes`.

There is no local HTTP application server.
