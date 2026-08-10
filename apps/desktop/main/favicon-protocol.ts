import {protocol} from 'electron';
import {sourceIdSchema} from '@rss-reader/contracts';
import {SourcesRepository, type Database} from '@rss-reader/db';
import {fetchSourceFavicon, type SourceFavicon} from './source-favicon';

export function registerSourceFaviconProtocol(database: Database): void {
  const sources = new SourcesRepository(database);
  const cache = new Map<string, Promise<SourceFavicon>>();
  protocol.handle('rss-reader-favicon', async (request) => {
    try {
      const url = new URL(request.url);
      const [idValue, ...remainder] = url.pathname.split('/').filter(Boolean);
      if (url.hostname !== 'source' || remainder.length > 0) return new Response('Invalid favicon request.', {status: 400});
      const id = sourceIdSchema.parse(idValue);
      const source = await sources.get(id);
      const sourceUrl = source.siteUrl ?? source.feedUrl;
      const key = `${id}:${sourceUrl}`;
      let favicon = cache.get(key);
      if (!favicon) {
        favicon = fetchSourceFavicon(sourceUrl);
        cache.set(key, favicon);
        void favicon.catch(() => cache.delete(key));
      }
      const resolved = await favicon;
      return new Response(new Uint8Array(resolved.data).buffer, {headers: {
        'Content-Type': resolved.mimeType,
        'Content-Length': String(resolved.data.byteLength),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      }});
    } catch {
      return new Response('Favicon not found.', {status: 404});
    }
  });
}
