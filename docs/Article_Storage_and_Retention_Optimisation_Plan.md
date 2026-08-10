# Article Storage and Retention Optimisation Plan

**Status:** Planning only — not implemented  
**Date:** 2026-08-10  
**Scope:** Local PostgreSQL article metadata, feed content, extracted reader content, raw page HTML, and cached images

## 1. Recommendation

Keep item metadata and read state lightweight and durable, but treat downloaded article bodies and images as a reclaimable cache. Unread and saved-for-offline articles should retain their readable content. Read articles should become eligible for cache cleanup after a configurable period, while their title, source, dates, canonical URL, read state, and feed identity remain available. Opening an evicted article should fetch and extract it again on demand.

The first implementation should use a simple daily cleanup pass in trusted Electron code, backed by PostgreSQL timestamps and settings. It should not add a local HTTP server, background queue, or renderer database access.

## 2. Current-state evidence

The current schema separates concerns usefully:

- `items` stores feed metadata, `feed_content_html`, identity, dates, and `read_at`;
- `item_content` stores `raw_html`, sanitized `reader_html`, extracted text, status, error, and fetch timestamps;
- `article_images` stores optimized image bytes and cascades with an item;
- source deletion cascades through items, content, images, suppressions, memberships, and fetch history;
- extraction is already lazy and cached.

At planning time the development database is 17 MB with 100 items, 14 `item_content` rows, and 17 cached images. That is not currently a capacity problem, but image bytes and raw HTML are the likely long-term growth drivers.

## 3. Storage classes

| Data | Default retention | Reason |
|---|---|---|
| Source, collection, membership, and application settings | Until explicitly deleted | User configuration |
| Item identity, title, author, dates, URL, read state, and source relationship | Keep while the source exists | Prevent duplicate re-imports and preserve library history |
| Feed summary / feed HTML | Keep with item initially | Cheap fallback if linked-page extraction fails |
| Sanitized reader HTML and reader text | Keep while unread; eligible after read-retention period | Main offline reading cache |
| Raw linked-page HTML | Remove soon after successful extraction; default 1 day | Largest low-value text payload and not rendered directly |
| Cached article images | Keep with unread cached content; eligible with reader cache | Largest likely storage driver |
| Failed/partial extraction diagnostics | Keep for a shorter period, default 30 days | Useful for retry/debugging without permanent error growth |
| Fetch runs | Keep 90 days by default | Operational history, not user content |
| Initial item suppressions | Keep while source exists | Required to prevent initial backlog backfill |

## 4. Proposed Settings section

Add a **Storage and retention** section below the existing Import and fetch section.

Recommended controls:

- **Keep cached content for unread articles** — on by default and strongly recommended.
- **Remove cached content for read articles after** — 7, 14, 30, 90 days, or Never; default 30 days.
- **Keep raw page HTML for** — Do not keep, 1 day, 7 days, or Until reader cache expires; default 1 day.
- **Fetch evicted articles again when opened** — on by default. When off, show retained feed content and Open original.
- **Maximum article cache size** — 250 MB, 500 MB, 1 GB, 2 GB, or Unlimited; default 500 MB.
- **Keep fetch history for** — 30, 90, 180 days, or Never delete; default 90 days.
- Read-only usage summary: database size, cached articles, cached images, and approximate reclaimable bytes.
- **Clean up now** action with a preview count and explicit confirmation.

Settings copy must explain that cleanup preserves source subscriptions, item metadata, read/unread state, and original URLs. It removes only content that can normally be downloaded again.

## 5. Eligibility and eviction rules

An item is protected from content eviction when any of these is true:

1. it is unread (`read_at is null`) and unread retention is enabled;
2. extraction is currently `fetching`;
3. the article was opened or re-extracted within a short safety window, proposed as 24 hours;
4. it is currently in Read Later (`saved_articles.read_later_at is not null`);
5. a future explicit offline/pinned flag is set (not part of the first implementation).

Read Later protection is implemented as a repository predicate alongside the saved-article feature. It protects already-cached readable content when cleanup is implemented; adding an article to Read Later does not itself fetch or extract the article. Starred and tagged states preserve metadata and original links but do not protect cache bodies.

Otherwise, a read article becomes age-eligible when `read_at` is older than the configured read-retention period. Cleanup should:

1. delete its `article_images` rows;
2. clear `raw_html`, `reader_html`, and `reader_text`;
3. retain or reset `item_content` to an explicit `not_requested` state so reopening naturally re-enters the existing extraction flow;
4. retain `items.feed_content_html` as the immediate fallback in the first release.

If the cache exceeds its size limit after age-based cleanup, evict additional unprotected read articles least-recently-accessed first. This requires an access timestamp; `fetched_at` alone is not sufficient because repeatedly opened cached articles are valuable even if fetched long ago.

## 6. Proposed persistent changes (future implementation)

Create a new immutable migration rather than editing migrations `0001`–`0006`.

Proposed additions:

- `application_settings.keep_unread_content boolean not null default true`;
- `application_settings.read_content_retention_days integer null default 30` (`null` means Never);
- `application_settings.raw_html_retention_days integer null default 1` (`0` means do not retain after extraction);
- `application_settings.refetch_evicted_on_open boolean not null default true`;
- `application_settings.max_article_cache_bytes bigint null default 524288000`;
- `application_settings.fetch_run_retention_days integer null default 90`;
- `item_content.last_accessed_at timestamptz`;
- `item_content.evicted_at timestamptz` for diagnostics and UI state;
- an index supporting eligible-row lookup by extraction status, access/read age, and item join.

Do not add a separate job database or filesystem cache in the first version. PostgreSQL remains the single persistent store and cascading item deletion remains unchanged.

## 7. Trusted cleanup service

Add a main-process `StorageRetentionService` that depends on narrow repositories. It should:

- calculate usage and eligible counts without mutation;
- clean in bounded batches (for example 100 items per transaction) to avoid a long lock;
- re-check protection predicates inside each deletion transaction;
- remove image rows before clearing content, or rely on a purpose-built repository transaction;
- prune old `fetch_runs` independently;
- report examined, evicted, image bytes reclaimed, raw bytes reclaimed, and failures;
- use one in-process mutex so startup, scheduled, and manual cleanup cannot overlap;
- never run while a clean database migration is in progress.

Trigger it after startup with a delay and at most once per 24 hours, recording the last completed run in application settings or a small maintenance table. Electron timers are sufficient; cleanup is recoverable and does not justify a durable queue.

## 8. Reopening evicted content

The existing item-detail contract should distinguish `evicted` from `never requested` for clear UI copy, either with a new extraction status or an `evictedAt` field. When an evicted item opens:

- immediately show retained feed content;
- if refetch is enabled and a canonical URL exists, invoke the existing trusted extraction flow;
- cache the new result and update `last_accessed_at`;
- if refetch fails, retain the feed fallback and show the normal Retry/Open original controls;
- never load publisher HTML or images directly in the renderer.

## 9. Size accounting

Use PostgreSQL byte functions over the cache-bearing columns and image `byte_length`. Exact total database size can be displayed separately through `pg_database_size`, but eviction decisions should use reclaimable logical bytes rather than total database file size because PostgreSQL may not immediately return freed pages to the operating system.

After cleanup, ordinary autovacuum should reclaim pages for database reuse. Do not run `VACUUM FULL` automatically because it takes stronger locks and rewrites tables.

## 10. Safety and user-data guarantees

- Cleanup never deletes sources, collections, memberships, item identity, canonical URLs, or read state.
- Unread protection is evaluated in the same transaction as eviction.
- A failed batch rolls back only that batch and later batches may continue.
- The renderer receives validated summaries and commands through preload/IPC; it never receives database credentials or arbitrary SQL.
- “Clean up now” must preview scope and require confirmation.
- Changing a retention setting is prospective; it does not mutate data until cleanup runs.

## 11. Validation plan

Future implementation should add:

- contract tests for every setting boundary and usage/result DTO;
- migration tests from zero and from migration `0006` data;
- repository integration tests proving unread rows remain protected;
- tests proving eligible read content and associated images are evicted while item metadata/read state remain;
- least-recently-accessed size-cap tests with deterministic timestamps and byte totals;
- extraction-service tests proving an evicted article refetches once and falls back safely on failure;
- concurrency tests proving cleanup cannot race a current extraction into deleting its result;
- renderer tests for settings validation, usage summary, preview, confirmation, and evicted-state copy;
- type checking, full Vitest, clean migration, Windows packaging, and a packaged runtime smoke check.

## 12. Delivery sequence

1. Add the migration, schema types, settings contracts, and repositories.
2. Add usage calculation and dry-run cleanup preview.
3. Implement batched age-based eviction with unread/current-extraction protection.
4. Add access tracking and size-cap least-recently-accessed eviction.
5. Add Settings UI and manual cleanup confirmation.
6. Add delayed daily cleanup.
7. Validate packaging and compare database/cache usage before and after cleanup.

## 13. Decisions deliberately deferred

- User pinning/offline collections.
- Deleting old item metadata entirely.
- Moving article blobs to the filesystem or object storage.
- PostgreSQL partitioning.
- Vacuum scheduling beyond normal autovacuum.
- Cross-device retention or cloud sync.

These should be considered only after real cache growth or user workflow evidence justifies them.
