import DOMPurify from 'dompurify';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeFeedContent(value: string, itemId: string): string {
    const sanitized = DOMPurify.sanitize(value, {
        USE_PROFILES: {html: true},
        FORBID_TAGS: [
            'audio',
            'button',
            'embed',
            'form',
            'iframe',
            'input',
            'object',
            'style',
            'video',
        ],
        FORBID_ATTR: [
            'action',
            'formaction',
            'href',
            'src',
            'srcset',
            'style',
        ],
    });
    const document = new DOMParser().parseFromString(`<body>${sanitized}</body>`, 'text/html');
    for (const image of document.body.querySelectorAll('img[data-cached-image-id]')) {
        const imageId = image.getAttribute('data-cached-image-id');
        image.removeAttribute('data-cached-image-id');
        if (!imageId || !uuidPattern.test(imageId) || !uuidPattern.test(itemId)) {
            image.remove();
            continue;
        }
        image.setAttribute('src', `rss-reader-image://media/${itemId}/${imageId}`);
        image.setAttribute('loading', 'lazy');
        image.setAttribute('decoding', 'async');
    }
    return document.body.innerHTML;
}
