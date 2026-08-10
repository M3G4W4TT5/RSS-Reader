import type {
    ArticleContent,
    ArticleExtractionResult,
} from '@rss-reader/contracts';
import type {PersistArticleContent} from '@rss-reader/db';
import type {ArticleTarget} from '@rss-reader/db';
import {
    applyCachedImageIds,
    extractReadableArticle,
    fetchFeedDocument,
    prepareFeedReaderContent,
    type ArticleImageCandidate,
    type ExtractedArticle,
    type FeedFetchImplementation,
} from '@rss-reader/feeds';
import {processArticleImages, type ArticleImageProcessingResult} from './article-images';

type ExtractImplementation = (html: string, url: string) => ExtractedArticle;
type ImageImplementation = (
    candidates: ArticleImageCandidate[],
) => Promise<ArticleImageProcessingResult>;

export interface ArticleServiceRepository {
    get(itemId: string): Promise<ArticleContent>;

    getTarget(itemId: string): Promise<ArticleTarget>;

    markFetching(itemId: string, url: string | null): Promise<ArticleContent>;

    persist(itemId: string, content: PersistArticleContent): Promise<ArticleContent>;

    fail(itemId: string, retrievedUrl: string | null, error: string): Promise<ArticleContent>;
}

export class ArticleService {
    private readonly active = new Map<string, Promise<ArticleExtractionResult>>();

    constructor(
        private readonly repository: ArticleServiceRepository,
        private readonly fetchImplementation: FeedFetchImplementation =
        fetchFeedDocument,
        private readonly extractImplementation: ExtractImplementation =
        extractReadableArticle,
        private readonly imageImplementation: ImageImplementation =
        processArticleImages,
    ) {
    }

    async extract(
        itemId: string,
        retry = false,
    ): Promise<ArticleExtractionResult> {
        const running = this.active.get(itemId);
        if (running) return running;

        const operation = this.extractOne(itemId, retry).finally(() => {
            this.active.delete(itemId);
        });
        this.active.set(itemId, operation);
        return operation;
    }

    private async extractOne(
        itemId: string,
        retry: boolean,
    ): Promise<ArticleExtractionResult> {
        const existing = await this.repository.get(itemId);
        if (
            !retry &&
            ['complete', 'partial', 'failed'].includes(existing.status)
        ) {
            return {...existing, cached: true};
        }

        const startedAt = Date.now();
        const target = await this.repository.getTarget(itemId);
        if (!target.canonicalUrl && !target.feedContentHtml) {
            return {
                ...(await this.repository.fail(
                    itemId,
                    null,
                    'This feed entry does not include an original article URL.',
                )),
                cached: false,
            };
        }

        await this.repository.markFetching(
            itemId,
            target.canonicalUrl ?? target.feedUrl,
        );
        let rawHtml = target.feedContentHtml ?? '';
        let retrievedUrl = target.canonicalUrl ?? target.feedUrl;
        let extracted: ExtractedArticle | undefined;
        let pageError: string | undefined;
        try {
            if (target.canonicalUrl) {
                try {
                    const response = await this.fetchImplementation({
                        url: target.canonicalUrl,
                        etag: null,
                        lastModified: null,
                    });
                    if (response.status !== 'ok') {
                        throw new Error('The article returned no readable page content.');
                    }
                    rawHtml = response.content;
                    retrievedUrl = response.finalUrl;
                    extracted = this.extractImplementation(
                        response.content,
                        response.finalUrl,
                    );
                    if (extracted.status !== 'complete') pageError = extracted.error ?? undefined;
                } catch (error) {
                    pageError = error instanceof Error
                        ? error.message
                        : 'The full article could not be fetched.';
                }
            }

            if (extracted?.status !== 'complete' && target.feedContentHtml) {
                extracted = prepareFeedReaderContent(
                    target.feedContentHtml,
                    target.canonicalUrl ?? target.feedUrl,
                    pageError ?? extracted?.error ?? 'Showing content supplied by the feed.',
                );
            }
            if (!extracted) throw new Error(pageError ?? 'No readable article content was found.');

            const processed = await this.imageImplementation(extracted.images);
            const imageIds = new Map(processed.images.map((image) => [image.token, image.id]));
            const readerHtml = extracted.readerHtml
                ? applyCachedImageIds(extracted.readerHtml, imageIds)
                : null;
            const persisted = await this.repository.persist(itemId, {
                status: extracted.status,
                retrievedUrl,
                rawHtml,
                readerHtml,
                readerText: extracted.readerText,
                error: extracted.error,
                images: processed.images.map(({token: _token, ...image}) => image),
            });
            this.log(itemId, persisted, startedAt);
            return {...persisted, cached: false};
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'An unexpected article extraction error occurred.';
            const failed = await this.repository.fail(
                itemId,
                target.canonicalUrl ?? target.feedUrl,
                message,
            );
            this.log(itemId, failed, startedAt);
            return {...failed, cached: false};
        }
    }

    private log(
        itemId: string,
        content: ArticleContent,
        startedAt: number,
    ): void {
        console.info(
            JSON.stringify({
                operation: 'article-extraction',
                itemId,
                status: content.status,
                durationMs: Date.now() - startedAt,
                errorMessage: content.extractionError,
            }),
        );
    }
}
