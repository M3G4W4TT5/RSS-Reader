import {type Kysely, sql} from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
  await database.schema
    .createTable('application_settings')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('initial_article_limit', 'integer', (column) =>
      column.notNull().defaultTo(25),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint('application_settings_singleton', sql`id = 1`)
    .addCheckConstraint(
      'application_settings_initial_article_limit_valid',
      sql`initial_article_limit between 1 and 500`,
    )
    .execute();

  await database
    .insertInto('application_settings')
    .values({id: 1, initial_article_limit: 25})
    .execute();

  await database.schema
    .createTable('initial_item_suppressions')
    .addColumn('source_id', 'uuid', (column) =>
      column.notNull().references('sources.id').onDelete('cascade'),
    )
    .addColumn('external_id', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('initial_item_suppressions_primary_key', [
      'source_id',
      'external_id',
    ])
    .addCheckConstraint(
      'initial_item_suppressions_external_id_not_empty',
      sql`btrim(external_id) <> ''`,
    )
    .execute();

  await database.schema
    .alterTable('fetch_runs')
    .addColumn('items_skipped', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .execute();

  await database.schema
    .alterTable('fetch_runs')
    .addCheckConstraint(
      'fetch_runs_items_skipped_nonnegative',
      sql`items_skipped >= 0`,
    )
    .execute();

  await sql`
    update app_metadata
    set value = 'stage-5'
    where key = 'schema_stage'
  `.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
  await database.schema
    .alterTable('fetch_runs')
    .dropConstraint('fetch_runs_items_skipped_nonnegative')
    .execute();
  await database.schema
    .alterTable('fetch_runs')
    .dropColumn('items_skipped')
    .execute();
  await database.schema.dropTable('initial_item_suppressions').execute();
  await database.schema.dropTable('application_settings').execute();
  await sql`
    update app_metadata
    set value = 'stage-4'
    where key = 'schema_stage'
  `.execute(database);
}
