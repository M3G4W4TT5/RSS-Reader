import sharp from 'sharp';
import {describe, expect, it} from 'vitest';
import {processArticleImages} from './article-images';

describe('processArticleImages', () => {
    it('downloads, resizes, strips metadata, and encodes a cached WebP', async () => {
        const source = await sharp({
            create: {width: 2_000, height: 1_000, channels: 3, background: '#4f765f'},
        }).jpeg().toBuffer();
        const validated: string[] = [];
        const result = await processArticleImages(
            [{token: 'image-0', url: 'https://images.example/hero.jpg', alt: 'Hero'}],
            async () => new Response(source, {
                status: 200,
                headers: {'Content-Type': 'image/jpeg', 'Content-Length': String(source.byteLength)},
            }),
            async (url) => {
                validated.push(url);
                return url;
            },
        );
        expect(validated).toEqual(['https://images.example/hero.jpg']);
        expect(result).toMatchObject({failed: 0, images: [{token: 'image-0', mimeType: 'image/webp'}]});
        const metadata = await sharp(result.images[0]!.data).metadata();
        expect(metadata).toMatchObject({format: 'webp', width: 1_600, height: 800});
    });

    it('omits tiny tracking images without failing the article pipeline', async () => {
        const pixel = await sharp({
            create: {width: 20, height: 20, channels: 3, background: '#ffffff'},
        }).png().toBuffer();
        const result = await processArticleImages(
            [{token: 'image-0', url: 'https://tracker.example/pixel.png', alt: null}],
            async () => new Response(pixel, {status: 200}),
            async (url) => url,
        );
        expect(result).toEqual({images: [], failed: 1});
    });

    it('validates every redirect destination', async () => {
        const source = await sharp({
            create: {width: 200, height: 100, channels: 3, background: '#334455'},
        }).png().toBuffer();
        const validated: string[] = [];
        const result = await processArticleImages(
            [{token: 'image-0', url: 'https://images.example/start', alt: null}],
            async (url) => url.toString().endsWith('/start')
                ? new Response(null, {status: 302, headers: {Location: 'https://cdn.example/final.png'}})
                : new Response(source, {status: 200}),
            async (url) => {
                validated.push(url);
                return url;
            },
        );
        expect(result.failed).toBe(0);
        expect(validated).toEqual([
            'https://images.example/start',
            'https://cdn.example/final.png',
        ]);
    });
});
