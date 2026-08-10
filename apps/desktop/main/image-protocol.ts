import {protocol} from 'electron';
import {sourceIdSchema} from '@rss-reader/contracts';
import {ArticleContentRepository, type Database} from '@rss-reader/db';

export function registerArticleImageProtocol(database: Database): void {
    const repository = new ArticleContentRepository(database);
    protocol.handle('rss-reader-image', async (request) => {
        try {
            const url = new URL(request.url);
            const [itemIdValue, imageIdValue, ...remainder] = url.pathname
                .split('/')
                .filter(Boolean);
            if (url.hostname !== 'media' || remainder.length > 0) {
                return new Response('Invalid image request.', {status: 400});
            }
            const itemId = sourceIdSchema.parse(itemIdValue);
            const imageId = sourceIdSchema.parse(imageIdValue);
            const image = await repository.getImage(itemId, imageId);
            if (!image) return new Response('Image not found.', {status: 404});
            return new Response(new Uint8Array(image.data), {
                status: 200,
                headers: {
                    'Content-Type': image.mimeType,
                    'Content-Length': String(image.data.byteLength),
                    'Cache-Control': 'private, max-age=31536000, immutable',
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        } catch {
            return new Response('Invalid image request.', {status: 400});
        }
    });
}
