import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
  await database.schema
    .createTable('items')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('source_id', 'uuid', (column) =>
      column.notNull().references('sources.id').onDelete('cascade'),
    )
    .addColumn('external_id', 'text', (column) => column.notNull())
    .addColumn('canonical_url', 'text')
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('author', 'text')
    .addColumn('published_at', 'timestamptz')
    .addColumn('source_updated_at', 'timestamptz')
    .addColumn('summary', 'text')
    .addColumn('feed_content_html', 'text')
    .addColumn('first_seen_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('last_seen_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('read_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('items_source_external_id_unique', [
      'source_id',
      'external_id',
    ])
    .addCheckConstraint('items_external_id_not_empty', sql`btrim(external_id) <> ''`)
    .addCheckConstraint('items_title_not_empty', sql`btrim(title) <> ''`)
    .execute();

  await database.schema
    .createIndex('items_source_sort_index')
    .on('items')
    .columns(['source_id', 'published_at', 'first_seen_at'])
    .execute();

  await database.schema
    .createTable('fetch_runs')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('source_id', 'uuid', (column) =>
      column.notNull().references('sources.id').onDelete('cascade'),
    )
    .addColumn('started_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('completed_at', 'timestamptz')
    .addColumn('status', 'text', (column) => column.notNull())
    .addColumn('http_status', 'integer')
    .addColumn('items_received', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('items_inserted', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('items_updated', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('error_category', 'text')
    .addColumn('error_message', 'text')
    .addCheckConstraint(
      'fetch_runs_status_valid',
      sql`status in ('fetching', 'success', 'unchanged', 'failed')`,
    )
    .addCheckConstraint(
      'fetch_runs_counts_nonnegative',
      sql`items_received >= 0 and items_inserted >= 0 and items_updated >= 0`,
    )
    .execute();

  await database.schema
    .createIndex('fetch_runs_source_started_index')
    .on('fetch_runs')
    .columns(['source_id', 'started_at'])
    .execute();

  await sql`
    update app_metadata
    set value = 'stage-2'
    where key = 'schema_stage'
  `.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
  await database.schema.dropTable('fetch_runs').execute();
  await database.schema.dropTable('items').execute();
  await sql`
    update app_metadata
    set value = 'stage-1'
    where key = 'schema_stage'
  `.execute(database);
}
