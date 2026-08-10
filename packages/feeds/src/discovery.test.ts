import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import type {FeedFetchImplementation, FeedHttpResult} from './types';
import {resolveFeed} from './discovery';

const rss = readFileSync(
    new URL('../../../tests/fixtures/feeds/rss-2.0.xml', import.meta.url),
    'utf8',
);
const page = readFileSync(
    new URL('../../../tests/fixtures/pages/feed-link.html', import.meta.url),
    'utf8',
);
const noFeedPage = readFileSync(
    new URL('../../../tests/fixtures/pages/no-feed.html', import.meta.url),
    'utf8',
);

function ok(url: string, content: string, contentType: string): FeedHttpResult {
    return {
        status: 'ok',
        httpStatus: 200,
        etag: null,
        lastModified: null,
        finalUrl: url,
        contentType,
        content,
    };
}

describe('resolveFeed', () => {
    it('accepts a direct feed URL', async () => {
        const result = await resolveFeed(
            'https://example.com/feed.xml',
            async (request) => ok(request.url, rss, 'application/rss+xml'),
        );
        expect(result).toMatchObject({
            feedUrl: 'https://example.com/feed.xml',
            discovered: false,
        });
        expect(result.feed.items).toHaveLength(2);
    });

    it('discovers and resolves a relative advertised feed URL', async () => {
        const requests: string[] = [];
        const fetcher: FeedFetchImplementation = async (request) => {
            requests.push(request.url);
            return request.url.endsWith('/feeds/main.xml')
                ? ok(request.url, rss, 'application/rss+xml')
                : ok('https://example.com/news/', page, 'text/html');
        };
        const result = await resolveFeed('https://example.com/news/', fetcher);
        expect(requests).toEqual([
            'https://example.com/news/',
            'https://example.com/feeds/main.xml',
        ]);
        expect(result).toMatchObject({
            feedUrl: 'https://example.com/feeds/main.xml',
            discovered: true,
        });
    });

    it('rejects a website without a usable advertised feed', async () => {
        await expect(
            resolveFeed('https://example.com/', async (request) =>
                ok(request.url, noFeedPage, 'text/html'),
            ),
        ).rejects.toMatchObject({category: 'invalid_feed'});
    });
});
