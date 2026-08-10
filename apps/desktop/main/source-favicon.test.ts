import {describe, expect, it, vi} from 'vitest';
import {fetchSourceFavicon} from './source-favicon';

const validate = async (value: string) => value;

describe('source favicon fetching', () => {
  it('requests the public origin favicon with bounded supported bytes', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'image/png'}}));
    const result = await fetchSourceFavicon('https://example.com/news/feed.xml', fetchMock as typeof fetch, validate);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/favicon.ico', expect.objectContaining({redirect: 'manual'}));
    expect(result).toMatchObject({mimeType: 'image/png'});
    expect([...result.data]).toEqual([1, 2, 3]);
  });

  it('rejects unsupported or oversized responses', async () => {
    await expect(fetchSourceFavicon('https://example.com/', async () => new Response('<svg/>', {headers: {'content-type': 'image/svg+xml'}}), validate)).rejects.toThrow(/not supported/);
    await expect(fetchSourceFavicon('https://example.com/', async () => new Response('x', {headers: {'content-type': 'image/png', 'content-length': String(300_000)}}), validate)).rejects.toThrow(/too large/);
  });
});
