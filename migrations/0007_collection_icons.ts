import {type Kysely, sql} from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
  await database.schema.alterTable('collections')
    .addColumn('icon', 'text', (column) => column.notNull().defaultTo('folder')).execute();
  await database.schema.alterTable('collections').addCheckConstraint(
    'collections_icon_curated',
    sql`icon in ('folder', 'business', 'technology', 'science', 'nature', 'design', 'news', 'world', 'learning')`,
  ).execute();
  await sql`update app_metadata set value = 'stage-7' where key = 'schema_stage'`.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
  await database.schema.alterTable('collections').dropColumn('icon').execute();
  await sql`update app_metadata set value = 'stage-6' where key = 'schema_stage'`.execute(database);
}
