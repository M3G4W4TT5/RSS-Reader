import type {NormalizedFeedItem} from './types';

export interface InitialImportSelection {
  imported: NormalizedFeedItem[];
  skipped: NormalizedFeedItem[];
}

function effectiveTimestamp(item: NormalizedFeedItem): number | null {
  const value = item.publishedAt ?? item.sourceUpdatedAt;
  return value ? new Date(value).valueOf() : null;
}

export function selectInitialFeedItems(
  items: NormalizedFeedItem[],
  limit: number,
): InitialImportSelection {
  const ranked = items
    .map((item, index) => ({item, index, timestamp: effectiveTimestamp(item)}))
    .sort((left, right) => {
      if (left.timestamp !== null && right.timestamp !== null) {
        return right.timestamp - left.timestamp || left.index - right.index;
      }
      if (left.timestamp !== null) return -1;
      if (right.timestamp !== null) return 1;
      return left.index - right.index;
    })
    .map(({item}) => item);

  return {
    imported: ranked.slice(0, limit),
    skipped: ranked.slice(limit),
  };
}
