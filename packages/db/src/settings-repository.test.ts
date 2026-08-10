import {describe, expect, it} from 'vitest';
import {createDatabase} from './database';
import {migrateToLatest} from './migrations';
import {SettingsRepository} from './settings-repository';

describe('SettingsRepository', () => {
  it('provides the default and persists an updated initial article limit', async () => {
    const database = createDatabase();
    let original: Awaited<ReturnType<SettingsRepository['get']>> | undefined;
    try {
      await migrateToLatest(database);
      const settings = new SettingsRepository(database);
      original = await settings.get();
      const replacement = original.initialArticleLimit === 37 ? 38 : 37;
      expect(await settings.update({initialArticleLimit: replacement}))
        .toEqual({initialArticleLimit: replacement});
      expect(await settings.get()).toEqual({initialArticleLimit: replacement});
    } finally {
      if (original) await new SettingsRepository(database).update(original);
      await database.destroy();
    }
  });
});
