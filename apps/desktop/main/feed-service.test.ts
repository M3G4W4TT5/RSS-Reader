import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  FeedPersistenceResult,
  FeedResponseMetadata,
  FetchableSource,
  FetchRunStart,
} from '@rss-reader/db';
import {
  FeedIngestionError,
  type FeedFetchImplementation,
  type NormalizedFeed,
} from '@rss-reader/feeds';
import { describe, expect, it } from 'vitest';
import { FeedService, type FeedServiceRepository } from './feed-service';

const rssFixture = readFileSync(
  new URL('../../../tests/fixtures/feeds/rss-2.0.xml', import.meta.url),
  'utf8',
);

function source(host: string): FetchableSource {
  return {
    id: randomUUID(),
    name: host,
    feedUrl: `https://${host}/feed.xml`,
    etag: null,
    lastModified: null,
    lastFetchedAt: null,
  };
}

class MemoryRepository implements FeedServiceRepository {
  readonly runs: Array<{ sourceId: string; status: string }> = [];
  listCalls = 0;

  constructor(private readonly sources: FetchableSource[], private readonly beforeList?: () => Promise<void>) {}

  async getSource(id: string): Promise<FetchableSource> {
    const match = this.sources.find((candidate) => candidate.id === id);
    if (!match) throw new Error('Source not found.');
    return match;
  }

  async listEnabledSources(): Promise<FetchableSource[]> {
    this.listCalls += 1;
    await this.beforeList?.();
    return this.sources;
  }

  async startRun(sourceId: string): Promise<FetchRunStart> {
    this.runs.push({ sourceId, status: 'fetching' });
    return { id: sourceId, startedAt: new Date().toISOString() };
  }

  async completeFeed(
    runId: string,
    _sourceId: string,
    feed: NormalizedFeed,
    _metadata: FeedResponseMetadata,
  ): Promise<FeedPersistenceResult> {
    this.setStatus(runId, 'success');
    return {
      sourceName: feed.title ?? 'Untitled feed',
      completedAt: new Date().toISOString(),
      itemsReceived: feed.items.length,
      itemsInserted: feed.items.length,
      itemsUpdated: 0,
      itemsSkipped: 0,
    };
  }

  async completeNotModified(
    runId: string,
  ): Promise<{ sourceName: string; completedAt: string }> {
    this.setStatus(runId, 'unchanged');
    return {
      sourceName:
        this.sources.find((candidate) => candidate.id === runId)?.name ??
        'Unknown',
      completedAt: new Date().toISOString(),
    };
  }

  async failRun(runId: string): Promise<string> {
    this.setStatus(runId, 'failed');
    return new Date().toISOString();
  }

  private setStatus(sourceId: string, status: string): void {
    const run = this.runs.find((candidate) => candidate.sourceId === sourceId);
    if (run) run.status = status;
  }
}

describe('FeedService Fetch All', () => {
  it('coalesces concurrent Fetch All requests before asynchronous source loading', async () => {
    const firstSource = source('coalesced.example.com');
    let releaseList: (() => void) | undefined;
    const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
    const repository = new MemoryRepository([firstSource], () => listGate);
    let fetchCalls = 0;
    const fetchImplementation: FeedFetchImplementation = async (request) => {
      fetchCalls += 1;
      return {status: 'ok', httpStatus: 200, etag: null, lastModified: null,
        content: rssFixture, finalUrl: request.url, contentType: 'application/rss+xml'};
    };
    const service = new FeedService(repository, fetchImplementation);
    const first = service.fetchAll();
    const second = service.fetchAll();
    expect(second).toBe(first);
    expect(service.getStatus().running).toBe(true);
    releaseList?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(repository.listCalls).toBe(1);
    expect(fetchCalls).toBe(1);
    expect(service.getStatus().running).toBe(false);
  });

  it('continues after a broken source and reports a final summary', async () => {
    const successful = source('success.example.com');
    const broken = source('broken.example.com');
    const unchanged = source('unchanged.example.com');
    const repository = new MemoryRepository([
      successful,
      broken,
      unchanged,
    ]);
    const requestedUrls: string[] = [];
    const fetchImplementation: FeedFetchImplementation = async (request) => {
      requestedUrls.push(request.url);
      if (request.url.includes('broken')) {
        throw new FeedIngestionError('network', 'Fixture network failure.');
      }
      if (request.url.includes('unchanged')) {
        return {
          status: 'not-modified',
          httpStatus: 304,
          etag: '"unchanged"',
          lastModified: null,
          finalUrl: request.url,
          contentType: null,
        };
      }
      return {
        status: 'ok',
        httpStatus: 200,
        etag: '"success"',
        lastModified: null,
        content: rssFixture,
        finalUrl: request.url,
        contentType: 'application/rss+xml',
      };
    };

    const service = new FeedService(repository, fetchImplementation);
    const result = await service.fetchAll();

    expect(result).toMatchObject({
      totalSources: 3,
      succeeded: 1,
      unchanged: 1,
      failed: 1,
      itemsInserted: 2,
    });
    expect(result.results.find(({ sourceId }) => sourceId === broken.id)).toMatchObject({
      status: 'failed',
      errorCategory: 'network',
    });
    expect(requestedUrls).toHaveLength(3);
    expect(service.getStatus()).toMatchObject({
      running: false,
      completedSources: 3,
    });
    expect(repository.runs.map((run) => run.status).sort()).toEqual([
      'failed',
      'success',
      'unchanged',
    ]);
  });
});
