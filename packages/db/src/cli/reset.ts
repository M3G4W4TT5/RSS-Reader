import {
  assertDevelopmentResetIsSafe,
  createDatabase,
  getDatabaseUrl,
  migrateToLatest,
  resetDevelopmentDatabase,
} from '../index';

const databaseUrl = getDatabaseUrl();
assertDevelopmentResetIsSafe(databaseUrl);

const database = createDatabase(databaseUrl);

try {
  await resetDevelopmentDatabase(database);
  const results = await migrateToLatest(database);
  console.log('Local development database reset.');
  console.log(results.join('\n'));
} finally {
  await database.destroy();
}

