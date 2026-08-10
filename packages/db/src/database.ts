import {
  type ColumnType,
  type Generated,
  Kysely,
  PostgresDialect,
  sql,
} from 'kysely';
import { Pool } from 'pg';
import { getDatabaseUrl } from './environment';

interface AppMetadataTable {
  key: string;
  value: string;
  created_at: Generated<ColumnType<Date, Date | string | undefined, never>>;
}

type TimestampColumn = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;

export interface SourcesTable {
  id: Generated<string>;
  name: string;
  feed_url: string;
  site_url: string | null;
  description: string | null;
  enabled: Generated<boolean>;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: TimestampColumn | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface CollectionsTable {
  id: Generated<string>;
  name: string;
  icon: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface CollectionSourcesTable {
  collection_id: string;
  source_id: string;
  created_at: TimestampColumn;
}

export interface ItemsTable {
  id: Generated<string>;
  source_id: string;
  external_id: string;
  canonical_url: string | null;
  title: string;
  author: string | null;
  published_at: TimestampColumn | null;
  source_updated_at: TimestampColumn | null;
  summary: string | null;
  feed_content_html: string | null;
  first_seen_at: TimestampColumn;
  last_seen_at: TimestampColumn;
  read_at: TimestampColumn | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface FetchRunsTable {
  id: Generated<string>;
  source_id: string;
  started_at: TimestampColumn;
  completed_at: TimestampColumn | null;
  status: 'fetching' | 'success' | 'unchanged' | 'failed';
  http_status: number | null;
  items_received: Generated<number>;
  items_inserted: Generated<number>;
  items_updated: Generated<number>;
  items_skipped: Generated<number>;
  error_category: string | null;
  error_message: string | null;
}

export interface ApplicationSettingsTable {
  id: number;
  initial_article_limit: Generated<number>;
  updated_at: TimestampColumn;
}

export interface InitialItemSuppressionsTable {
  source_id: string;
  external_id: string;
  created_at: TimestampColumn;
}

export type ExtractionStatus =
  | 'not_requested'
  | 'fetching'
  | 'complete'
  | 'partial'
  | 'failed';

export interface ItemContentTable {
  item_id: string;
  retrieved_url: string | null;
  raw_html: string | null;
  reader_html: string | null;
  reader_text: string | null;
  extraction_status: ExtractionStatus;
  extraction_error: string | null;
  fetched_at: TimestampColumn | null;
  updated_at: TimestampColumn;
}

export interface ArticleImagesTable {
  id: string;
  item_id: string;
  original_url: string;
  mime_type: string;
  width: number;
  height: number;
  byte_length: number;
  data: Buffer;
  created_at: TimestampColumn;
}

export interface NotesTable {
  id: Generated<string>;
  item_id: string | null;
  quote_text: string;
  annotation_text: string | null;
  anchor: unknown;
  content_hash: string;
  article_title_snapshot: string;
  source_name_snapshot: string;
  canonical_url_snapshot: string | null;
  collection_names_snapshot: unknown;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface DatabaseSchema {
  app_metadata: AppMetadataTable;
  sources: SourcesTable;
  collections: CollectionsTable;
  collection_sources: CollectionSourcesTable;
  items: ItemsTable;
  fetch_runs: FetchRunsTable;
  item_content: ItemContentTable;
  application_settings: ApplicationSettingsTable;
  initial_item_suppressions: InitialItemSuppressionsTable;
  article_images: ArticleImagesTable;
  notes: NotesTable;
}

export type Database = Kysely<DatabaseSchema>;

export function createDatabase(connectionString = getDatabaseUrl()): Database {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 4,
        idleTimeoutMillis: 10_000,
      }),
    }),
  });
}

export interface DatabaseHealth {
  name: string;
  time: string;
  migration: string;
}

export async function checkDatabase(database: Database): Promise<DatabaseHealth> {
  const systemResult = await sql<{
    database_name: string;
    database_time: Date | string;
  }>`select current_database() as database_name, now() as database_time`.execute(
    database,
  );
  const metadata = await database
    .selectFrom('app_metadata')
    .select('value')
    .where('key', '=', 'schema_stage')
    .executeTakeFirstOrThrow();
  const system = systemResult.rows[0];

  if (!system) {
    throw new Error('PostgreSQL returned no health-check row.');
  }

  return {
    name: system.database_name,
    time: new Date(system.database_time).toISOString(),
    migration: metadata.value,
  };
}
