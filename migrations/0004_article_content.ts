import {type Kysely, sql} from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
    await database.schema
        .createTable('item_content')
        .addColumn('item_id', 'uuid', (column) =>
            column.primaryKey().references('items.id').onDelete('cascade'),
        )
        .addColumn('retrieved_url', 'text')
        .addColumn('raw_html', 'text')
        .addColumn('reader_html', 'text')
        .addColumn('reader_text', 'text')
        .addColumn('extraction_status', 'text', (column) =>
            column.notNull().defaultTo('not_requested'),
        )
        .addColumn('extraction_error', 'text')
        .addColumn('fetched_at', 'timestamptz')
        .addColumn('updated_at', 'timestamptz', (column) =>
            column.notNull().defaultTo(sql`now()`),
        )
        .addCheckConstraint(
            'item_content_extraction_status_valid',
            sql`extraction_status in ('not_requested', 'fetching', 'complete', 'partial', 'failed')`,
        )
        .execute();

    await sql`
    update app_metadata
    set value = 'stage-4'
    where key = 'schema_stage'
  `.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
    await database.schema.dropTable('item_content').execute();
    await sql`
    update app_metadata
    set value = 'stage-2'
    where key = 'schema_stage'
  `.execute(database);
}
