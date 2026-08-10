import {JSDOM} from 'jsdom';
import {fetchFeedDocument} from './http';
import {parseAndNormalizeFeed} from './normalize';
import {
    FeedIngestionError,
    type FeedFetchImplementation,
    type NormalizedFeed,
    type ResolvedFeed,
} from './types';

const maximumCandidates = 8;
const feedMimeTypes = new Set([
    'application/atom+xml',
    'application/rss+xml',
    'application/xml',
    'text/xml',
]);

type ParseImplementation = (content: string, feedUrl: string) => NormalizedFeed;

function advertisedFeedUrls(html: string, pageUrl: string): string[] {
    const document = new JSDOM(html, {url: pageUrl}).window.document;
    const urls: string[] = [];
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[href]')) {
        const rels = link.rel.toLowerCase().split(/\s+/);
        const type = link.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
        if (!rels.includes('alternate') || !feedMimeTypes.has(type)) continue;
        try {
            const candidate = new URL(link.href, pageUrl).toString();
            if (!urls.includes(candidate)) urls.push(candidate);
        } catch {
            // Ignore malformed advertised URLs and continue with other candidates.
        }
        if (urls.length === maximumCandidates) break;
    }
    return urls;
}

function looksLikeHtml(contentType: string | null, content: string): boolean {
    return contentType?.toLowerCase().includes('text/html') === true ||
        /<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(content.slice(0, 2048));
}

export async function resolveFeed(
    submittedUrl: string,
    fetchImplementation: FeedFetchImplementation = fetchFeedDocument,
    parseImplementation: ParseImplementation = parseAndNormalizeFeed,
): Promise<ResolvedFeed> {
    const response = await fetchImplementation({
        url: submittedUrl,
        etag: null,
        lastModified: null,
    });
    if (response.status !== 'ok') {
        throw new FeedIngestionError('invalid_feed', 'The submitted URL did not return feed content.');
    }

    try {
        const feed = parseImplementation(response.content, response.finalUrl);
        return {
            requestedUrl: submittedUrl,
            feedUrl: response.finalUrl,
            siteUrl: feed.siteUrl,
            feed,
            response,
            discovered: false,
        };
    } catch (error) {
        if (!looksLikeHtml(response.contentType, response.content)) throw error;
    }

    for (const candidate of advertisedFeedUrls(response.content, response.finalUrl)) {
        try {
            const candidateResponse = await fetchImplementation({
                url: candidate,
                etag: null,
                lastModified: null,
            });
            if (candidateResponse.status !== 'ok') continue;
            const feed = parseImplementation(candidateResponse.content, candidateResponse.finalUrl);
            return {
                requestedUrl: submittedUrl,
                feedUrl: candidateResponse.finalUrl,
                siteUrl: feed.siteUrl ?? response.finalUrl,
                feed,
                response: candidateResponse,
                discovered: true,
            };
        } catch {
            // A page may advertise stale or unusable feeds; try the next bounded candidate.
        }
    }

    throw new FeedIngestionError(
        'invalid_feed',
        'No usable RSS or Atom feed was found at this website.',
    );
}
