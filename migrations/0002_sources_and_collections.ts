import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
  await database.schema
    .createTable('sources')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('feed_url', 'text', (column) => column.notNull().unique())
    .addColumn('site_url', 'text')
    .addColumn('description', 'text')
    .addColumn('enabled', 'boolean', (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn('etag', 'text')
    .addColumn('last_modified', 'text')
    .addColumn('last_fetched_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint('sources_name_not_empty', sql`btrim(name) <> ''`)
    .addCheckConstraint('sources_feed_url_not_empty', sql`btrim(feed_url) <> ''`)
    .execute();

  await database.schema
    .createTable('collections')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint('collections_name_not_empty', sql`btrim(name) <> ''`)
    .execute();

  await database.schema
    .createTable('collection_sources')
    .addColumn('collection_id', 'uuid', (column) =>
      column
        .notNull()
        .references('collections.id')
        .onDelete('cascade'),
    )
    .addColumn('source_id', 'uuid', (column) =>
      column.notNull().references('sources.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('collection_sources_primary_key', [
      'collection_id',
      'source_id',
    ])
    .execute();

  await database.schema
    .createIndex('collection_sources_source_id_index')
    .on('collection_sources')
    .column('source_id')
    .execute();

  await sql`
    update app_metadata
    set value = 'stage-1'
    where key = 'schema_stage'
  `.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
  await database.schema.dropTable('collection_sources').execute();
  await database.schema.dropTable('collections').execute();
  await database.schema.dropTable('sources').execute();
  await sql`
    update app_metadata
    set value = 'stage-0'
    where key = 'schema_stage'
  `.execute(database);
}
