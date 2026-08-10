import {type Kysely, sql} from 'kysely';

export async function up(database: Kysely<any>): Promise<void> {
  await database.schema
    .createTable('article_images')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('item_id', 'uuid', (column) =>
      column.notNull().references('items.id').onDelete('cascade'),
    )
    .addColumn('original_url', 'text', (column) => column.notNull())
    .addColumn('mime_type', 'text', (column) => column.notNull())
    .addColumn('width', 'integer', (column) => column.notNull())
    .addColumn('height', 'integer', (column) => column.notNull())
    .addColumn('byte_length', 'integer', (column) => column.notNull())
    .addColumn('data', 'bytea', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('article_images_item_original_url_unique', [
      'item_id',
      'original_url',
    ])
    .addCheckConstraint(
      'article_images_dimensions_positive',
      sql`width > 0 and height > 0 and byte_length > 0`,
    )
    .execute();

  await database.schema
    .createIndex('article_images_item_id_index')
    .on('article_images')
    .column('item_id')
    .execute();

  await sql`
    update app_metadata
    set value = 'stage-6'
    where key = 'schema_stage'
  `.execute(database);
}

export async function down(database: Kysely<any>): Promise<void> {
  await database.schema.dropTable('article_images').execute();
  await sql`
    update app_metadata
    set value = 'stage-5'
    where key = 'schema_stage'
  `.execute(database);
}
