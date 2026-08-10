import { createDatabase, migrateToLatest } from '../index';

const database = createDatabase();

try {
  const results = await migrateToLatest(database);
  console.log(results.length > 0 ? results.join('\n') : 'Database is up to date.');
} finally {
  await database.destroy();
}

