import createDOMPurify from 'dompurify';
import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';

export interface ArticleImageCandidate {
    token: string;
    url: string;
    alt: string | null;
}

export interface ExtractedArticle {
    status: 'complete' | 'partial';
    readerHtml: string | null;
    readerText: string | null;
    error: string | null;
    images: ArticleImageCandidate[];
}

const activeTags = [
    'audio',
    'button',
    'embed',
    'form',
    'iframe',
    'input',
    'object',
    'style',
    'video',
];

const imageUrlAttributes = [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-url',
    'src',
];

const unrelatedContentHint = /(?:^|[\s_-])(related|recommended|recommendations|more-from|read-next|also-read|you-may-also-like|outbrain|taboola)(?:$|[\s_-])/i;
const trailingHeading = /^(?:related(?: content| articles| stories)?|recommended(?: for you| articles| stories)?|more from(?: this author| this site)?|read next|also read|you may also like)\b/i;
const authorImageHint = /(?:^|[\s_-])(author|avatar|byline|headshot|profile-image|profile-photo)(?:$|[\s_-])/i;

function elementHints(element: Element): string {
    return [
        element.id,
        element.className,
        element.getAttribute('aria-label'),
        element.getAttribute('data-component'),
        element.getAttribute('data-testid'),
        element.getAttribute('itemprop'),
    ].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
}

function removeUnrelatedArticleContent(document: Document): void {
    for (const image of [...document.querySelectorAll('img')]) {
        const imageHint = `${elementHints(image)} ${image.getAttribute('alt') ?? ''}`;
        const authorContainer = image.closest('[class], [id], [aria-label], [data-component], [data-testid], [itemprop]');
        if (authorImageHint.test(imageHint) || (authorContainer && authorImageHint.test(elementHints(authorContainer)))) {
            image.remove();
        }
    }

    for (const element of [...document.querySelectorAll('aside, section, div, ul, ol')]) {
        if (unrelatedContentHint.test(elementHints(element))) element.remove();
    }

    for (const heading of [...document.querySelectorAll('h2, h3, h4, h5, h6')]) {
        if (!trailingHeading.test(heading.textContent?.trim() ?? '')) continue;
        const container = heading.closest('aside, section');
        if (container) {
            container.remove();
            continue;
        }
        let current: ChildNode | null = heading;
        while (current) {
            const nextSibling: ChildNode | null = current.nextSibling;
            current.parentNode?.removeChild(current);
            current = nextSibling;
        }
    }
}

function publicImageUrl(value: string | null, baseUrl: string): string | null {
    if (!value) return null;
    try {
        const url = new URL(value.trim(), baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            return null;
        }
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function largestSrcsetUrl(value: string | null): string | null {
    if (!value) return null;
    const candidates = value.split(',').map((candidate, index) => {
        const [url, descriptor = '1x'] = candidate.trim().split(/\s+/, 2);
        const score = descriptor.endsWith('w')
            ? Number(descriptor.slice(0, -1))
            : descriptor.endsWith('x')
                ? Number(descriptor.slice(0, -1)) * 1_000
                : 1;
        return {url: url ?? '', score: Number.isFinite(score) ? score : 0, index};
    });
    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
    return candidates[0]?.url || null;
}

function candidateUrl(image: Element, baseUrl: string): string | null {
    const pictureSource = image.closest('picture')?.querySelector('source');
    const rawCandidates = [
        largestSrcsetUrl(pictureSource?.getAttribute('srcset') ?? null),
        largestSrcsetUrl(image.getAttribute('srcset')),
        ...imageUrlAttributes.map((attribute) => image.getAttribute(attribute)),
    ];
    for (const raw of rawCandidates) {
        const resolved = publicImageUrl(raw, baseUrl);
        if (resolved) return resolved;
    }
    return null;
}

function prepareHtml(html: string, baseUrl: string): {
    readerHtml: string;
    readerText: string;
    images: ArticleImageCandidate[];
} {
    const dom = new JSDOM(`<body>${html}</body>`, {url: baseUrl});
    try {
        removeUnrelatedArticleContent(dom.window.document);
        for (const anchor of dom.window.document.querySelectorAll('a')) {
            const href = anchor.getAttribute('href');
            try {
                const url = href ? new URL(href, baseUrl) : null;
                if (
                    url &&
                    ['http:', 'https:'].includes(url.protocol) &&
                    !url.username &&
                    !url.password
                ) {
                    anchor.setAttribute('data-external-url', url.toString());
                }
            } catch {
                // Invalid links remain as non-interactive text.
            }
            anchor.removeAttribute('href');
            anchor.removeAttribute('target');
            anchor.removeAttribute('rel');
        }

        const images: ArticleImageCandidate[] = [];
        const tokenByUrl = new Map<string, string>();
        for (const image of dom.window.document.querySelectorAll('img')) {
            const declaredWidth = Number(image.getAttribute('width'));
            const declaredHeight = Number(image.getAttribute('height'));
            const isDeclaredTiny = declaredWidth > 0 && declaredHeight > 0
                && declaredWidth <= 80 && declaredHeight <= 80;
            const url = isDeclaredTiny ? null : candidateUrl(image, baseUrl);
            if (url) {
                let token = tokenByUrl.get(url);
                if (!token) {
                    token = `image-${images.length}`;
                    tokenByUrl.set(url, token);
                    images.push({
                        token,
                        url,
                        alt: image.getAttribute('alt')?.trim() || null,
                    });
                }
                image.setAttribute('data-image-token', token);
                image.setAttribute('loading', 'lazy');
            } else {
                image.remove();
            }
            for (const attribute of [...imageUrlAttributes, 'srcset', 'sizes', 'style']) {
                image.removeAttribute(attribute);
            }
        }
        for (const source of dom.window.document.querySelectorAll('source')) source.remove();

        const purifier = createDOMPurify(
            dom.window as unknown as Parameters<typeof createDOMPurify>[0],
        );
        const readerHtml = purifier.sanitize(dom.window.document.body.innerHTML, {
            USE_PROFILES: {html: true},
            FORBID_TAGS: activeTags,
            FORBID_ATTR: [
                'action',
                'formaction',
                'href',
                'src',
                'srcset',
                'style',
                'target',
            ],
        });
        return {
            readerHtml,
            readerText: dom.window.document.body.textContent?.trim() ?? '',
            images,
        };
    } finally {
        dom.window.close();
    }
}

export function extractReadableArticle(rawHtml: string, pageUrl: string): ExtractedArticle {
    const sourceDom = new JSDOM(rawHtml, {url: pageUrl});
    try {
        removeUnrelatedArticleContent(sourceDom.window.document);
        const article = new Readability(sourceDom.window.document, {
            charThreshold: 120,
            maxElemsToParse: 50_000,
        }).parse();
        const readerText = article?.textContent?.trim();
        if (!article?.content || !readerText || readerText.length < 120) {
            return {
                status: 'partial',
                readerHtml: null,
                readerText: null,
                error: 'The page was fetched, but no readable article body was found.',
                images: [],
            };
        }

        const prepared = prepareHtml(article.content, pageUrl);
        return {
            status: 'complete',
            readerHtml: prepared.readerHtml,
            readerText: prepared.readerText,
            error: null,
            images: prepared.images,
        };
    } finally {
        sourceDom.window.close();
    }
}

export function prepareFeedReaderContent(
    feedHtml: string,
    baseUrl: string,
    error: string,
): ExtractedArticle {
    const prepared = prepareHtml(feedHtml, baseUrl);
    return {
        status: 'partial',
        readerHtml: prepared.readerHtml || null,
        readerText: prepared.readerText || null,
        error,
        images: prepared.images,
    };
}

export function applyCachedImageIds(
    readerHtml: string,
    imageIdsByToken: ReadonlyMap<string, string>,
): string {
    const dom = new JSDOM(`<body>${readerHtml}</body>`);
    try {
        for (const image of dom.window.document.querySelectorAll('img[data-image-token]')) {
            const token = image.getAttribute('data-image-token');
            const imageId = token ? imageIdsByToken.get(token) : undefined;
            image.removeAttribute('data-image-token');
            if (imageId) image.setAttribute('data-cached-image-id', imageId);
            else image.remove();
        }
        return dom.window.document.body.innerHTML;
    } finally {
        dom.window.close();
    }
}
