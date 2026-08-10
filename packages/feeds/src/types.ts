export type SupportedFeedFormat = 'rss' | 'atom';

export interface NormalizedFeedItem {
    externalId: string;
    canonicalUrl: string | null;
    title: string;
    author: string | null;
    publishedAt: string | null;
    sourceUpdatedAt: string | null;
    summary: string | null;
    contentHtml: string | null;
}

export interface NormalizedFeed {
    format: SupportedFeedFormat;
    title: string | null;
    siteUrl: string | null;
    description: string | null;
    items: NormalizedFeedItem[];
}

export type FeedFetchErrorCategory =
    | 'network'
    | 'timeout'
    | 'http'
    | 'invalid_feed'
    | 'unsupported_response';

export class FeedIngestionError extends Error {
    public readonly httpStatus: number | null;

    constructor(
        public readonly category: FeedFetchErrorCategory,
        message: string,
        options?: ErrorOptions & { httpStatus?: number },
    ) {
        super(message, options);
        this.name = 'FeedIngestionError';
        this.httpStatus = options?.httpStatus ?? null;
    }
}

export interface FeedHttpRequest {
    url: string;
    etag: string | null;
    lastModified: string | null;
}

interface FeedHttpBase {
    httpStatus: number;
    etag: string | null;
    lastModified: string | null;
    finalUrl: string;
    contentType: string | null;
}

export type FeedHttpResult =
    | (FeedHttpBase & { status: 'not-modified' })
    | (FeedHttpBase & { status: 'ok'; content: string });

export type FeedFetchImplementation = (
    request: FeedHttpRequest,
) => Promise<FeedHttpResult>;

export interface ResolvedFeed {
    requestedUrl: string;
    feedUrl: string;
    siteUrl: string | null;
    feed: NormalizedFeed;
    response: Extract<FeedHttpResult, { status: 'ok' }>;
    discovered: boolean;
}

export type PublicUrlValidator = (url: string) => Promise<string>;
