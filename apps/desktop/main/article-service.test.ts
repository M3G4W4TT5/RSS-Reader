import type {ArticleContent} from '@rss-reader/contracts';
import type {ArticleTarget, PersistArticleContent} from '@rss-reader/db';
import type {FeedFetchImplementation} from '@rss-reader/feeds';
import {describe, expect, it} from 'vitest';
import {ArticleService, type ArticleServiceRepository} from './article-service';

const empty: ArticleContent = {
    status: 'not_requested', retrievedUrl: null, readerHtml: null, readerText: null,
    extractionError: null, fetchedAt: null, updatedAt: null,
};

class MemoryArticleRepository implements ArticleServiceRepository {
    content = empty;

    constructor(
        private readonly target: string | null = 'https://example.com/story',
        private readonly feedContentHtml: string | null = null,
    ) {
    }

    async get(): Promise<ArticleContent> {
        return this.content;
    }

    async getTarget(): Promise<ArticleTarget> {
        return {
            canonicalUrl: this.target,
            feedContentHtml: this.feedContentHtml,
            summary: null,
            feedUrl: 'https://example.com/feed.xml',
        };
    }

    async markFetching(_id: string, url: string | null): Promise<ArticleContent> {
        return this.content = {...empty, status: 'fetching', retrievedUrl: url};
    }

    async persist(_id: string, value: PersistArticleContent): Promise<ArticleContent> {
        return this.content = {
            ...empty, status: value.status, retrievedUrl: value.retrievedUrl,
            readerHtml: value.readerHtml, readerText: value.readerText, extractionError: value.error,
            fetchedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
    }

    async fail(_id: string, url: string | null, error: string): Promise<ArticleContent> {
        return this.content = {
            ...empty, status: 'failed', retrievedUrl: url,
            extractionError: error, updatedAt: new Date().toISOString()
        };
    }
}

describe('ArticleService', () => {
    it('extracts once, caches the result, and only repeats on retry', async () => {
        const repository = new MemoryArticleRepository();
        let calls = 0;
        const fetcher: FeedFetchImplementation = async ({url}) => {
            calls += 1;
            return {
                status: 'ok', httpStatus: 200, etag: null, lastModified: null,
                content: '<article>body</article>', finalUrl: url, contentType: 'text/html'
            };
        };
        const service = new ArticleService(repository, fetcher, () => ({
            status: 'complete', readerHtml: '<p>body</p>', readerText: 'body', error: null,
            images: [],
        }), async () => ({images: [], failed: 0}));

        await expect(service.extract('item')).resolves.toMatchObject({status: 'complete', cached: false});
        await expect(service.extract('item')).resolves.toMatchObject({status: 'complete', cached: true});
        await expect(service.extract('item', true)).resolves.toMatchObject({cached: false});
        expect(calls).toBe(2);
    });

    it('stores a failure so feed content can remain as the fallback', async () => {
        const repository = new MemoryArticleRepository();
        const fetcher: FeedFetchImplementation = async () => {
            throw new Error('fixture network failure');
        };
        const result = await new ArticleService(repository, fetcher).extract('item');
        expect(result).toMatchObject({status: 'failed', extractionError: 'fixture network failure'});
    });

    it('reports a missing canonical URL without requesting the network', async () => {
        const repository = new MemoryArticleRepository(null);
        const result = await new ArticleService(repository).extract('item');
        expect(result).toMatchObject({status: 'failed', cached: false});
    });

    it('caches images from feed-provided content when no full page is available', async () => {
        const repository = new MemoryArticleRepository(
            null,
            '<p>Feed-provided article body.</p><img src="https://images.example/hero.jpg" alt="Hero">',
        );
        const imageId = '03c7b981-94f2-49c6-b002-534f6a54ab32';
        const service = new ArticleService(
            repository,
            async () => {
                throw new Error('The page fetch should not run.');
            },
            undefined,
            async (candidates) => ({
                failed: 0,
                images: candidates.map((candidate) => ({
                    id: imageId,
                    token: candidate.token,
                    originalUrl: candidate.url,
                    mimeType: 'image/webp',
                    width: 800,
                    height: 450,
                    data: Buffer.from('fixture'),
                })),
            }),
        );
        await expect(service.extract('item')).resolves.toMatchObject({
            status: 'partial',
            readerHtml: expect.stringContaining(`data-cached-image-id="${imageId}"`),
        });
    });
});
