import type {
  FetchAllResult,
  FetchErrorCategory,
  FetchOperationStatus,
  FetchSourceResult,
} from '@rss-reader/contracts';
import {
  type FeedPersistenceResult,
  type FeedResponseMetadata,
  type FetchableSource,
  type FetchRunStart,
} from '@rss-reader/db';
import {
  FeedIngestionError,
  fetchFeedDocument,
  parseAndNormalizeFeed,
  type FeedFetchImplementation,
  type NormalizedFeed,
} from '@rss-reader/feeds';

type ParseImplementation = (content: string, feedUrl: string) => NormalizedFeed;

export interface FeedServiceRepository {
  getSource(id: string): Promise<FetchableSource>;
  listEnabledSources(): Promise<FetchableSource[]>;
  startRun(sourceId: string): Promise<FetchRunStart>;
  completeFeed(
    runId: string,
    sourceId: string,
    feed: NormalizedFeed,
    metadata: FeedResponseMetadata,
  ): Promise<FeedPersistenceResult>;
  completeNotModified(
    runId: string,
    sourceId: string,
    metadata: FeedResponseMetadata,
  ): Promise<{ sourceName: string; completedAt: string }>;
  failRun(
    runId: string,
    category: FetchErrorCategory,
    message: string,
    httpStatus: number | null,
  ): Promise<string>;
}

const emptyStatus = (): FetchOperationStatus => ({
  running: false,
  mode: null,
  startedAt: null,
  completedAt: null,
  totalSources: 0,
  completedSources: 0,
  sources: [],
});

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected fetch error occurred.';
}

function errorDetails(error: unknown): {
  category: FetchErrorCategory;
  httpStatus: number | null;
} {
  if (error instanceof FeedIngestionError) {
    return { category: error.category, httpStatus: error.httpStatus };
  }
  return { category: 'database', httpStatus: null };
}

export class FeedService {
  private status = emptyStatus();
  private activeFetchAll: Promise<FetchAllResult> | undefined;

  constructor(
    private readonly repository: FeedServiceRepository,
    private readonly fetchImplementation: FeedFetchImplementation =
      fetchFeedDocument,
    private readonly parseImplementation: ParseImplementation =
      parseAndNormalizeFeed,
  ) {}

  getStatus(): FetchOperationStatus {
    return {
      ...this.status,
      sources: this.status.sources.map((source) => ({ ...source })),
    };
  }

  async fetchSource(sourceId: string): Promise<FetchSourceResult> {
    this.assertIdle();
    this.begin('single', []);
    try {
      const source = await this.repository.getSource(sourceId);
      this.setSources([source]);
      return await this.fetchOne(source);
    } finally {
      this.finish();
    }
  }

  fetchAll(): Promise<FetchAllResult> {
    if (this.activeFetchAll) return this.activeFetchAll;
    this.assertIdle();
    this.begin('all', []);
    const operation = this.performFetchAll().finally(() => {
      this.finish();
      this.activeFetchAll = undefined;
    });
    this.activeFetchAll = operation;
    return operation;
  }

  private async performFetchAll(): Promise<FetchAllResult> {
    const sources = await this.repository.listEnabledSources();
    this.setSources(sources);
    const results = new Array<FetchSourceResult>(sources.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const source = sources[index];
        if (!source) return;
        results[index] = await this.fetchOne(source);
      }
    };

    const workerCount = Math.min(3, sources.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => worker()),
    );
    return {
      totalSources: results.length,
      succeeded: results.filter((result) => result.status === 'success').length,
      unchanged: results.filter((result) => result.status === 'unchanged').length,
      failed: results.filter((result) => result.status === 'failed').length,
      itemsInserted: results.reduce(
        (sum, result) => sum + result.itemsInserted,
        0,
      ),
      itemsUpdated: results.reduce(
        (sum, result) => sum + result.itemsUpdated,
        0,
      ),
      itemsSkipped: results.reduce(
        (sum, result) => sum + result.itemsSkipped,
        0,
      ),
      results,
    };
  }

  private setSources(sources: FetchableSource[]): void {
    this.status = {
      ...this.status,
      totalSources: sources.length,
      sources: sources.map((source) => ({
        sourceId: source.id,
        sourceName: source.name,
        status: 'pending',
        itemsInserted: 0,
        itemsUpdated: 0,
        itemsSkipped: 0,
        errorMessage: null,
      })),
    };
  }

  private assertIdle(): void {
    if (this.status.running) throw new Error('A feed fetch is already running.');
  }

  private begin(
    mode: 'single' | 'all',
    sources: FetchableSource[],
  ): void {
    this.status = {
      running: true,
      mode,
      startedAt: new Date().toISOString(),
      completedAt: null,
      totalSources: sources.length,
      completedSources: 0,
      sources: sources.map((source) => ({
        sourceId: source.id,
        sourceName: source.name,
        status: 'pending',
        itemsInserted: 0,
        itemsUpdated: 0,
        itemsSkipped: 0,
        errorMessage: null,
      })),
    };
  }

  private finish(): void {
    this.status = {
      ...this.status,
      running: false,
      completedAt: new Date().toISOString(),
    };
  }

  private updateProgress(
    sourceId: string,
    update: Partial<FetchOperationStatus['sources'][number]>,
  ): void {
    this.status = {
      ...this.status,
      sources: this.status.sources.map((source) =>
        source.sourceId === sourceId ? { ...source, ...update } : source,
      ),
    };
  }

  private async fetchOne(source: FetchableSource): Promise<FetchSourceResult> {
    const fallbackStartedAt = new Date().toISOString();
    let run: FetchRunStart | undefined;
    this.updateProgress(source.id, { status: 'fetching' });

    try {
      run = await this.repository.startRun(source.id);
      const response = await this.fetchImplementation({
        url: source.feedUrl,
        etag: source.etag,
        lastModified: source.lastModified,
      });

      if (response.status === 'not-modified') {
        const completed = await this.repository.completeNotModified(
          run.id,
          source.id,
          response,
        );
        const result: FetchSourceResult = {
          sourceId: source.id,
          sourceName: completed.sourceName,
          status: 'unchanged',
          httpStatus: response.httpStatus,
          itemsReceived: 0,
          itemsInserted: 0,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errorCategory: null,
          errorMessage: null,
          startedAt: run.startedAt,
          completedAt: completed.completedAt,
        };
        this.completeProgress(result);
        return result;
      }

      const feed = this.parseImplementation(response.content, response.finalUrl);
      const persisted = await this.repository.completeFeed(
        run.id,
        source.id,
        feed,
        response,
      );
      const result: FetchSourceResult = {
        sourceId: source.id,
        sourceName: persisted.sourceName,
        status: 'success',
        httpStatus: response.httpStatus,
        itemsReceived: persisted.itemsReceived,
        itemsInserted: persisted.itemsInserted,
        itemsUpdated: persisted.itemsUpdated,
        itemsSkipped: persisted.itemsSkipped,
        errorCategory: null,
        errorMessage: null,
        startedAt: run.startedAt,
        completedAt: persisted.completedAt,
      };
      this.completeProgress(result);
      return result;
    } catch (error) {
      const details = errorDetails(error);
      const errorMessage = message(error);
      let completedAt = new Date().toISOString();
      if (run) {
        try {
          completedAt = await this.repository.failRun(
            run.id,
            details.category,
            errorMessage,
            details.httpStatus,
          );
        } catch (recordError) {
          console.error('[feed-fetch] Failed to record fetch failure.', recordError);
        }
      }
      const result: FetchSourceResult = {
        sourceId: source.id,
        sourceName: source.name,
        status: 'failed',
        httpStatus: details.httpStatus,
        itemsReceived: 0,
        itemsInserted: 0,
        itemsUpdated: 0,
        itemsSkipped: 0,
        errorCategory: details.category,
        errorMessage,
        startedAt: run?.startedAt ?? fallbackStartedAt,
        completedAt,
      };
      this.completeProgress(result);
      return result;
    }
  }

  private completeProgress(result: FetchSourceResult): void {
    this.updateProgress(result.sourceId, {
      sourceName: result.sourceName,
      status: result.status,
      itemsInserted: result.itemsInserted,
      itemsUpdated: result.itemsUpdated,
      itemsSkipped: result.itemsSkipped,
      errorMessage: result.errorMessage,
    });
    this.status = {
      ...this.status,
      completedSources: this.status.completedSources + 1,
    };
    console.info(
      JSON.stringify({
        operation: 'feed-fetch',
        sourceId: result.sourceId,
        status: result.status,
        durationMs:
          new Date(result.completedAt).valueOf() -
          new Date(result.startedAt).valueOf(),
        itemsInserted: result.itemsInserted,
        itemsUpdated: result.itemsUpdated,
        itemsSkipped: result.itemsSkipped,
        errorCategory: result.errorCategory,
      }),
    );
  }
}
