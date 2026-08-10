import {
    FeedIngestionError,
    type FeedHttpRequest,
    type FeedHttpResult,
    type PublicUrlValidator,
} from './types';
import {assertPublicHttpUrl} from './url-policy';

const maximumFeedBytes = 5 * 1024 * 1024;
const fetchTimeoutMilliseconds = 15_000;
const maximumRedirects = 5;

export async function fetchFeedDocument(
    request: FeedHttpRequest,
    fetchImplementation: typeof fetch = fetch,
    validateUrl: PublicUrlValidator = assertPublicHttpUrl,
): Promise<FeedHttpResult> {
    const headers = new Headers({
        Accept:
            'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        'User-Agent': 'RSS Reader Prototype/0.1',
    });

    if (request.etag) headers.set('If-None-Match', request.etag);
    if (request.lastModified) {
        headers.set('If-Modified-Since', request.lastModified);
    }

    let response: Response;
    let currentUrl = await validateUrl(request.url);
    let redirectCount = 0;
    try {
        while (true) {
            response = await fetchImplementation(currentUrl, {
                method: 'GET',
                headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
            });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('location');
            if (!location) {
                throw new FeedIngestionError('http', 'Feed redirect did not include a destination.', {
                    httpStatus: response.status,
                });
            }
            redirectCount += 1;
            if (redirectCount > maximumRedirects) {
                throw new FeedIngestionError('http', 'Feed request exceeded the five-redirect limit.');
            }
            currentUrl = await validateUrl(new URL(location, currentUrl).toString());
        }
    } catch (error) {
        if (error instanceof FeedIngestionError) throw error;
        const name =
            typeof error === 'object' && error !== null && 'name' in error
                ? String(error.name)
                : '';
        if (name === 'AbortError' || name === 'TimeoutError') {
            throw new FeedIngestionError(
                'timeout',
                `Feed request timed out after ${fetchTimeoutMilliseconds / 1000} seconds.`,
                {cause: error},
            );
        }
        throw new FeedIngestionError('network', 'The feed could not be reached.', {
            cause: error,
        });
    }

    const responseMetadata = {
        httpStatus: response.status,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        finalUrl: currentUrl,
        contentType: response.headers.get('content-type'),
    };

    if (response.status === 304) {
        return {status: 'not-modified', ...responseMetadata};
    }

    if (!response.ok) {
        throw new FeedIngestionError(
            'http',
            `Feed request failed with HTTP ${response.status} ${response.statusText || ''}`.trim(),
            {httpStatus: response.status},
        );
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumFeedBytes) {
        throw new FeedIngestionError(
            'unsupported_response',
            'Feed response exceeds the 5 MB prototype limit.',
        );
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maximumFeedBytes) {
        throw new FeedIngestionError(
            'unsupported_response',
            'Feed response exceeds the 5 MB prototype limit.',
        );
    }

    return {
        status: 'ok',
        content: new TextDecoder().decode(bytes),
        ...responseMetadata,
    };
}
