import { type Kysely, sql } from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
  await database.schema
    .createTable('app_metadata')
    .addColumn('key', 'text', (column) => column.primaryKey())
    .addColumn('value', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(database.fn('now')),
    )
    .execute();

  await sql`
    insert into app_metadata (key, value)
    values ('schema_stage', 'stage-0')
  `.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
  await database.schema.dropTable('app_metadata').execute();
}
