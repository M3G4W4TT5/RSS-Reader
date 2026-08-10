import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {applyCachedImageIds, extractReadableArticle, prepareFeedReaderContent} from './article';

function fixture(name: string): string {
    return readFileSync(
        new URL(`../../../tests/fixtures/pages/${name}`, import.meta.url),
        'utf8',
    );
}

describe('extractReadableArticle', () => {
    it('extracts the meaningful body and resolves external links', () => {
        const result = extractReadableArticle(
            fixture('standard-article.html'),
            'https://publisher.example/articles/fixture',
        );
        expect(result.status).toBe('complete');
        expect(result.readerText).toContain('retrieves linked pages only when an item is opened');
        expect(result.readerHtml).toContain('data-external-url="https://publisher.example/related-story"');
        expect(result.readerHtml).not.toContain('href=');
    });

    it('omits page clutter while retaining article prose', () => {
        const result = extractReadableArticle(
            fixture('cluttered-article.html'),
            'https://publisher.example/story',
        );
        expect(result.readerText).toContain('The main article begins here');
        expect(result.readerText).not.toContain('Buy an unrelated product');
    });

    it('removes author profile images and trailing related-content modules', () => {
        const prose = 'The durable article body explains the subject in enough detail for extraction. '.repeat(10);
        const result = extractReadableArticle(`
          <main><article>
            <h1>Focused story</h1>
            <div class="author-byline"><img src="/people/writer.jpg" width="900" height="900" alt="Author profile photo"><span>By Ada Writer</span></div>
            <p>${prose}</p>
            <section class="related-articles"><h2>Related articles</h2><p>Unrelated recommendation card</p><img src="/recommendation.jpg"></section>
          </article></main>
        `, 'https://publisher.example/stories/focused');
        expect(result.status).toBe('complete');
        expect(result.readerText).toContain('durable article body');
        expect(result.readerText).not.toContain('Unrelated recommendation card');
        expect(result.images).toEqual([]);
        expect(result.readerHtml).not.toContain('<img');
    });

    it('trims a trailing related heading even when the module has no identifying class', () => {
        const prose = 'Core reporting that must remain in the extracted article. '.repeat(12);
        const result = extractReadableArticle(`
          <article><h1>Report</h1><p>${prose}</p><h2>Read next</h2><p>Another story teaser</p></article>
        `, 'https://publisher.example/report');
        expect(result.readerText).toContain('Core reporting');
        expect(result.readerText).not.toContain('Another story teaser');
    });

    it('returns a usable partial result when no article can be identified', () => {
        expect(
            extractReadableArticle(fixture('minimal-article.html'), 'https://publisher.example/tiny'),
        ).toMatchObject({status: 'partial', readerHtml: null});
    });

    it('sanitizes executable markup and strips renderer-loadable resources', () => {
        const result = extractReadableArticle(
            fixture('dangerous-article.html'),
            'https://publisher.example/untrusted',
        );
        expect(result.status).toBe('complete');
        expect(result.readerHtml).toContain('data-external-url="https://example.com/safe"');
        expect(result.readerHtml).not.toMatch(/<script|<iframe|onclick=|onerror=|javascript:|src=/i);
    });

    it('handles malformed HTML without executing or throwing', () => {
        expect(() =>
            extractReadableArticle(fixture('malformed-article.html'), 'https://publisher.example/broken'),
        ).not.toThrow();
    });

    it('collects responsive and lazy article images without retaining remote-loading attributes', () => {
        const prose = 'Meaningful article prose for image extraction. '.repeat(12);
        const result = extractReadableArticle(`
          <article><h1>Illustrated article</h1><p>${prose}</p>
            <picture><source srcset="/small.webp 400w, /large.webp 1600w">
              <img src="/fallback.jpg" alt="A useful diagram"></picture>
            <img data-src="/lazy.png" alt="Lazy image">
            <img src="/pixel.gif" width="1" height="1">
          </article>
        `, 'https://publisher.example/stories/one');
        expect(result.images).toEqual([
            {token: 'image-0', url: 'https://publisher.example/large.webp', alt: 'A useful diagram'},
            {token: 'image-1', url: 'https://publisher.example/lazy.png', alt: 'Lazy image'},
        ]);
        expect(result.readerHtml).toContain('data-image-token="image-0"');
        expect(result.readerHtml).not.toMatch(/src=|srcset=|data-src=/i);
    });

    it('prepares feed-provided HTML and replaces only successfully cached images', () => {
        const prepared = prepareFeedReaderContent(
            '<p>Feed body</p><img src="/hero.jpg" alt="Hero"><img src="/missing.jpg">',
            'https://publisher.example/feed.xml',
            'Full page unavailable.',
        );
        const rewritten = applyCachedImageIds(
            prepared.readerHtml!,
            new Map([['image-0', '03c7b981-94f2-49c6-b002-534f6a54ab32']]),
        );
        expect(rewritten).toContain('data-cached-image-id="03c7b981-94f2-49c6-b002-534f6a54ab32"');
        expect(rewritten).not.toContain('missing.jpg');
        expect(rewritten.match(/<img/g)).toHaveLength(1);
    });

    it('cleans author and recommendation modules from feed-provided fallback HTML', () => {
        const prepared = prepareFeedReaderContent(
            '<div class="byline"><img src="/avatar.jpg" alt="Author avatar">By Writer</div><p>Feed body</p><aside class="recommended">Recommendation</aside>',
            'https://publisher.example/feed.xml',
            'Full page unavailable.',
        );
        expect(prepared.readerText).toContain('Feed body');
        expect(prepared.readerText).not.toContain('Recommendation');
        expect(prepared.images).toEqual([]);
    });
});
