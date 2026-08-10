import 'dotenv/config';

const DEVELOPMENT_DATABASE_NAMES = new Set(['reader']);
const DEVELOPMENT_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;

  if (!value) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.',
    );
  }

  return value;
}

export function assertDevelopmentResetIsSafe(databaseUrl: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Database reset is disabled when NODE_ENV=production.');
  }

  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.slice(1);

  if (
    parsed.protocol !== 'postgresql:' ||
    !DEVELOPMENT_DATABASE_HOSTS.has(parsed.hostname) ||
    !DEVELOPMENT_DATABASE_NAMES.has(databaseName)
  ) {
    throw new Error(
      'Refusing to reset anything except the local development reader database.',
    );
  }
}

