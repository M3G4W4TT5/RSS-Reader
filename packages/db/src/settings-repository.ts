import type {ApplicationSettings, UpdateApplicationSettings} from '@rss-reader/contracts';
import {sql} from 'kysely';
import type {Database} from './database';

export class SettingsRepository {
  constructor(private readonly database: Database) {}

  async get(): Promise<ApplicationSettings> {
    const row = await this.database
      .selectFrom('application_settings')
      .select('initial_article_limit')
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return {initialArticleLimit: row.initial_article_limit};
  }

  async update(input: UpdateApplicationSettings): Promise<ApplicationSettings> {
    const row = await this.database
      .updateTable('application_settings')
      .set({
        initial_article_limit: input.initialArticleLimit,
        updated_at: sql`now()`,
      })
      .where('id', '=', 1)
      .returning('initial_article_limit')
      .executeTakeFirstOrThrow();
    return {initialArticleLimit: row.initial_article_limit};
  }
}
