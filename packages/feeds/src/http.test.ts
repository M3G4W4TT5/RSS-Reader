import {describe, expect, it, vi} from 'vitest';
import {FeedIngestionError, fetchFeedDocument} from './index';

describe('fetchFeedDocument', () => {
    it('sends stored validators and accepts HTTP 304 as unchanged', async () => {
        const fetchImplementation = vi.fn(async (_url, init) => {
            const headers = new Headers(init?.headers);
            expect(headers.get('If-None-Match')).toBe('"revision-1"');
            expect(headers.get('If-Modified-Since')).toBe(
                'Wed, 08 Jan 2025 10:00:00 GMT',
            );
            return new Response(null, {
                status: 304,
                headers: {
                    etag: '"revision-1"',
                    'last-modified': 'Wed, 08 Jan 2025 10:00:00 GMT',
                },
            });
        });

        await expect(
            fetchFeedDocument(
                {
                    url: 'https://example.com/feed.xml',
                    etag: '"revision-1"',
                    lastModified: 'Wed, 08 Jan 2025 10:00:00 GMT',
                },
                fetchImplementation as typeof fetch,
                async (url) => url,
            ),
        ).resolves.toMatchObject({
            status: 'not-modified',
            httpStatus: 304,
            etag: '"revision-1"',
        });
    });

    it('returns textual feed content and response validators', async () => {
        const result = await fetchFeedDocument(
            {
                url: 'https://example.com/feed.xml',
                etag: null,
                lastModified: null,
            },
            (async () =>
                new Response('<rss version="2.0"></rss>', {
                    status: 200,
                    headers: {etag: '"revision-2"'},
                })) as typeof fetch,
            async (url) => url,
        );
        expect(result).toMatchObject({
            status: 'ok',
            httpStatus: 200,
            etag: '"revision-2"',
        });
    });

    it('categorizes HTTP failures', async () => {
        await expect(
            fetchFeedDocument(
                {
                    url: 'https://example.com/private.xml',
                    etag: null,
                    lastModified: null,
                },
                (async () =>
                    new Response('Forbidden', {
                        status: 403,
                        statusText: 'Forbidden',
                    })) as typeof fetch,
                async (url) => url,
            ),
        ).rejects.toMatchObject({
            category: 'http',
            httpStatus: 403,
        });
    });

    it('validates every redirect target before requesting it', async () => {
        const requested: string[] = [];
        const validated: string[] = [];
        const fetcher = (async (url: string | URL | Request) => {
            requested.push(String(url));
            return new Response(null, {
                status: 302,
                headers: {location: 'http://127.0.0.1/private'},
            });
        }) as typeof fetch;
        await expect(
            fetchFeedDocument(
                {url: 'https://example.com/feed', etag: null, lastModified: null},
                fetcher,
                async (url) => {
                    validated.push(url);
                    if (url.includes('127.0.0.1')) throw new FeedIngestionError('network', 'Private.');
                    return url;
                },
            ),
        ).rejects.toThrow('Private');
        expect(requested).toEqual(['https://example.com/feed']);
        expect(validated).toEqual([
            'https://example.com/feed',
            'http://127.0.0.1/private',
        ]);
    });
});
