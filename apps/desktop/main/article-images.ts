import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {PersistArticleImage} from '@rss-reader/db';
import {
    assertPublicHttpUrl,
    type ArticleImageCandidate,
    type PublicUrlValidator,
} from '@rss-reader/feeds';

const maximumImages = 12;
const maximumSourceBytes = 10 * 1024 * 1024;
const maximumCachedBytes = 5 * 1024 * 1024;
const maximumTotalCachedBytes = 30 * 1024 * 1024;
const fetchTimeoutMilliseconds = 10_000;
const maximumRedirects = 5;
const supportedFormats = new Set(['jpeg', 'png', 'webp', 'gif']);

export interface ProcessedArticleImage extends PersistArticleImage {
    token: string;
}

export interface ArticleImageProcessingResult {
    images: ProcessedArticleImage[];
    failed: number;
}

async function readLimitedBody(response: Response): Promise<Buffer> {
    if (!response.body) throw new Error('Image response did not include a body.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumSourceBytes) {
        throw new Error('Image exceeds the 10 MB source limit.');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumSourceBytes) {
            await reader.cancel();
            throw new Error('Image exceeds the 10 MB source limit.');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
}

async function fetchImage(
    url: string,
    fetchImplementation: typeof fetch,
    validateUrl: PublicUrlValidator,
): Promise<{data: Buffer; finalUrl: string}> {
    let currentUrl = await validateUrl(url);
    for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
        const response = await fetchImplementation(currentUrl, {
            method: 'GET',
            headers: {
                Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.2',
                'User-Agent': 'RSS Reader Prototype/0.1',
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new Error('Image redirect did not include a destination.');
            if (redirectCount === maximumRedirects) {
                throw new Error('Image request exceeded the five-redirect limit.');
            }
            currentUrl = await validateUrl(new URL(location, currentUrl).toString());
            continue;
        }
        if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}.`);
        return {data: await readLimitedBody(response), finalUrl: currentUrl};
    }
    throw new Error('Image request exceeded the redirect limit.');
}

async function optimizeImage(data: Buffer): Promise<{
    data: Buffer;
    width: number;
    height: number;
}> {
    const input = sharp(data, {animated: false, limitInputPixels: 40_000_000});
    const metadata = await input.metadata();
    if (!metadata.format || !supportedFormats.has(metadata.format)) {
        throw new Error('Image format is not supported.');
    }
    if (!metadata.width || !metadata.height) throw new Error('Image dimensions are unavailable.');
    if (metadata.width <= 80 && metadata.height <= 80) {
        throw new Error('Image is too small to be article content.');
    }

    const output = await input
        .rotate()
        .resize({
            width: 1_600,
            height: 2_400,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .webp(metadata.format === 'png'
            ? {lossless: true, effort: 4}
            : {quality: 82, effort: 4, smartSubsample: true})
        .toBuffer({resolveWithObject: true});
    if (output.data.byteLength > maximumCachedBytes) {
        throw new Error('Optimized image exceeds the 5 MB cache limit.');
    }
    return {
        data: output.data,
        width: output.info.width,
        height: output.info.height,
    };
}

async function processCandidate(
    candidate: ArticleImageCandidate,
    fetchImplementation: typeof fetch,
    validateUrl: PublicUrlValidator,
): Promise<ProcessedArticleImage> {
    const fetched = await fetchImage(candidate.url, fetchImplementation, validateUrl);
    const optimized = await optimizeImage(fetched.data);
    return {
        id: randomUUID(),
        token: candidate.token,
        originalUrl: fetched.finalUrl,
        mimeType: 'image/webp',
        width: optimized.width,
        height: optimized.height,
        data: optimized.data,
    };
}

export async function processArticleImages(
    candidates: ArticleImageCandidate[],
    fetchImplementation: typeof fetch = fetch,
    validateUrl: PublicUrlValidator = assertPublicHttpUrl,
): Promise<ArticleImageProcessingResult> {
    const selected = candidates.slice(0, maximumImages);
    const results = new Array<ProcessedArticleImage | undefined>(selected.length);
    let nextIndex = 0;
    let failed = candidates.length - selected.length;

    const worker = async (): Promise<void> => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            const candidate = selected[index];
            if (!candidate) return;
            try {
                results[index] = await processCandidate(
                    candidate,
                    fetchImplementation,
                    validateUrl,
                );
            } catch (error) {
                failed += 1;
                console.warn('[article-image] Image was omitted.', {
                    url: candidate.url,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    };
    await Promise.all(Array.from({length: Math.min(3, selected.length)}, worker));

    const images: ProcessedArticleImage[] = [];
    let totalBytes = 0;
    for (const image of results) {
        if (!image) continue;
        if (totalBytes + image.data.byteLength > maximumTotalCachedBytes) {
            failed += 1;
            continue;
        }
        totalBytes += image.data.byteLength;
        images.push(image);
    }
    return {images, failed};
}
