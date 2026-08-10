import type {Source} from '@rss-reader/contracts';

export function filterSources(sources: Source[], query: string): Source[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return sources;

  return sources.filter((source) =>
    source.name.toLocaleLowerCase().includes(normalizedQuery)
    || source.feedUrl.toLocaleLowerCase().includes(normalizedQuery),
  );
}
