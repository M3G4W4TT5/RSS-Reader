// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {sanitizeFeedContent} from './sanitize-feed-content';

describe('sanitizeFeedContent', () => {
    it('keeps readable formatting without executable or remote-loading content', () => {
        const result = sanitizeFeedContent(
            '<p>Hello <strong>reader</strong></p><script>alert(1)</script><img src="https://tracker.example/pixel"><a href="javascript:alert(1)">bad</a>',
            '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783',
        );
        expect(result).toContain('<strong>reader</strong>');
        expect(result).not.toContain('<script');
        expect(result).not.toContain('src=');
        expect(result).not.toContain('href=');
    });

    it('materializes only validated cached-image identifiers for the current item', () => {
        const itemId = '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783';
        const imageId = '03c7b981-94f2-49c6-b002-534f6a54ab32';
        const result = sanitizeFeedContent(
            `<img data-cached-image-id="${imageId}" alt="Fixture"><img data-cached-image-id="invalid">`,
            itemId,
        );
        expect(result).toContain(`src="rss-reader-image://media/${itemId}/${imageId}"`);
        expect(result).not.toContain('invalid');
    });

    it('preserves semantic article tables for styled rendering', () => {
        const result = sanitizeFeedContent(
            '<table><thead><tr><th>Source</th><th>Items</th></tr></thead><tbody><tr><td>Example</td><td>12</td></tr></tbody></table>',
            '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783',
        );
        expect(result).toContain('<table>');
        expect(result).toContain('<th>Source</th>');
        expect(result).toContain('<td>12</td>');
    });
});
