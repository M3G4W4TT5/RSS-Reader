import type {
    CreateSourceInput,
    CreateSourceResult,
    FetchSourceResult,
    Source,
    UpdateSourceRequest,
} from '@rss-reader/contracts';
import {
    type IngestionRepository,
    normalizeFeedUrl,
    type SourcesRepository,
} from '@rss-reader/db';
import {resolveFeed, type ResolvedFeed} from '@rss-reader/feeds';

type ResolveImplementation = (url: string) => Promise<ResolvedFeed>;

export interface ImportSourceResult {
    source: Source;
    created: boolean;
}

export class SourceService {
    constructor(
        private readonly sources: SourcesRepository,
        private readonly ingestion: IngestionRepository,
        private readonly resolveImplementation: ResolveImplementation = resolveFeed,
    ) {
    }

    async create(input: CreateSourceInput): Promise<CreateSourceResult> {
        const resolved = await this.resolveImplementation(input.feedUrl);
        const persisted = await this.ingestion.createResolvedSource(input, resolved);
        return {
            source: await this.sources.get(persisted.sourceId),
            fetchResult: this.toFetchResult(persisted),
        };
    }

    async importSource(input: CreateSourceInput): Promise<ImportSourceResult> {
        const resolved = await this.resolveImplementation(input.feedUrl);
        const existing = await this.sources.findByFeedUrl(resolved.feedUrl);
        if (existing) {
            const collectionIds = [...new Set([...existing.collectionIds, ...input.collectionIds])];
            const name = input.name?.trim() || existing.name;
            const changed = name !== existing.name || collectionIds.length !== existing.collectionIds.length;
            return {
                source: changed
                    ? await this.sources.update({
                        id: existing.id,
                        input: {
                            name,
                            feedUrl: existing.feedUrl,
                            enabled: existing.enabled,
                            collectionIds,
                        },
                    })
                    : existing,
                created: false,
            };
        }

        const persisted = await this.ingestion.createResolvedSource(input, resolved);
        return {source: await this.sources.get(persisted.sourceId), created: true};
    }

    async update(request: UpdateSourceRequest): Promise<Source> {
        const existing = await this.sources.get(request.id);
        if (normalizeFeedUrl(request.input.feedUrl) === existing.feedUrl) {
            return this.sources.update(request);
        }
        const resolved = await this.resolveImplementation(request.input.feedUrl);
        await this.ingestion.replaceResolvedSource(request, resolved);
        return this.sources.get(request.id);
    }

    private toFetchResult(
        persisted: Awaited<ReturnType<IngestionRepository['createResolvedSource']>>,
    ): FetchSourceResult {
        return {
            sourceId: persisted.sourceId,
            sourceName: persisted.sourceName,
            status: 'success',
            httpStatus: persisted.httpStatus,
            itemsReceived: persisted.itemsReceived,
            itemsInserted: persisted.itemsInserted,
            itemsUpdated: persisted.itemsUpdated,
            itemsSkipped: persisted.itemsSkipped,
            errorCategory: null,
            errorMessage: null,
            startedAt: persisted.startedAt,
            completedAt: persisted.completedAt,
        };
    }
}
