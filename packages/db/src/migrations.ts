import { type Kysely, sql } from 'kysely';
import {
  type Migration,
  type MigrationProvider,
  Migrator,
} from 'kysely/migration';
import * as appMetadataMigration from '../../../migrations/0001_app_metadata';
import * as sourcesAndCollectionsMigration from '../../../migrations/0002_sources_and_collections';
import * as feedIngestionMigration from '../../../migrations/0003_feed_ingestion';
import * as articleContentMigration from '../../../migrations/0004_article_content';
import * as initialImportLimitMigration from '../../../migrations/0005_initial_import_limit';
import * as articleImagesMigration from '../../../migrations/0006_article_images';
import * as collectionIconsMigration from '../../../migrations/0007_collection_icons';
import * as notesMigration from '../../../migrations/0008_notes';
import * as savedArticlesMigration from '../../../migrations/0009_saved_articles';
import type { DatabaseSchema } from './database';

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '0001_app_metadata': appMetadataMigration,
      '0002_sources_and_collections': sourcesAndCollectionsMigration,
      '0003_feed_ingestion': feedIngestionMigration,
      '0004_article_content': articleContentMigration,
      '0005_initial_import_limit': initialImportLimitMigration,
      '0006_article_images': articleImagesMigration,
      '0007_collection_icons': collectionIconsMigration,
      '0008_notes': notesMigration,
      '0009_saved_articles': savedArticlesMigration,
    };
  }
}

export async function migrateToLatest(
  database: Kysely<DatabaseSchema>,
): Promise<string[]> {
  const result = await new Migrator({
    db: database,
    provider: new StaticMigrationProvider(),
  }).migrateToLatest();

  if (result.error) {
    throw result.error;
  }

  return (result.results ?? []).map(
    (migration) => `${migration.migrationName}: ${migration.status}`,
  );
}

export async function resetDevelopmentDatabase(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  await sql`drop schema if exists public cascade`.execute(database);
  await sql`create schema public`.execute(database);
}
