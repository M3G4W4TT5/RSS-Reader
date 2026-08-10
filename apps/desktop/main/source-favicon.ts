import {assertPublicHttpUrl, type PublicUrlValidator} from '@rss-reader/feeds';

const maximumFaviconBytes = 256 * 1024;
const maximumRedirects = 5;
const supportedTypes = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon',
]);

export interface SourceFavicon {
  data: Uint8Array;
  mimeType: string;
}

export async function fetchSourceFavicon(
  sourceUrl: string,
  fetchImplementation: typeof fetch = fetch,
  validateUrl: PublicUrlValidator = assertPublicHttpUrl,
): Promise<SourceFavicon> {
  const origin = new URL(await validateUrl(sourceUrl)).origin;
  let currentUrl = await validateUrl(new URL('/favicon.ico', origin).toString());
  let redirects = 0;
  let response: Response;
  while (true) {
    response = await fetchImplementation(currentUrl, {
      headers: {Accept: 'image/png,image/webp,image/jpeg,image/x-icon,*/*;q=0.2', 'User-Agent': 'RSS Reader Prototype/0.1'},
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || ++redirects > maximumRedirects) throw new Error('Favicon redirect was invalid.');
    currentUrl = await validateUrl(new URL(location, currentUrl).toString());
  }
  if (!response.ok) throw new Error(`Favicon request failed with HTTP ${response.status}.`);
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!supportedTypes.has(mimeType)) throw new Error('Favicon format is not supported.');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumFaviconBytes) throw new Error('Favicon is too large.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > maximumFaviconBytes) throw new Error('Favicon is empty or too large.');
  return {data, mimeType};
}
