import {describe, expect, it} from 'vitest';
import {createPublicUrlValidator, isPublicAddress} from './url-policy';

describe('public URL policy', () => {
    it('rejects loopback, private, link-local, and mapped loopback addresses', () => {
        expect(isPublicAddress('127.0.0.1')).toBe(false);
        expect(isPublicAddress('10.0.0.5')).toBe(false);
        expect(isPublicAddress('169.254.1.1')).toBe(false);
        expect(isPublicAddress('::1')).toBe(false);
        expect(isPublicAddress('fe80::1')).toBe(false);
        expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
        expect(isPublicAddress('93.184.216.34')).toBe(true);
    });

    it('rejects local names, credentials, and hostnames resolving privately', async () => {
        const validate = createPublicUrlValidator(async () => [
            {address: '192.168.1.2', family: 4},
        ]);
        await expect(validate('http://localhost/feed')).rejects.toThrow(/Local/);
        await expect(validate('https://user:pass@example.com/feed')).rejects.toThrow(
            /credentials/,
        );
        await expect(validate('https://example.com/feed')).rejects.toThrow(/private/);
    });

    it('normalizes a URL only when every resolved address is public', async () => {
        const validate = createPublicUrlValidator(async () => [
            {address: '93.184.216.34', family: 4},
            {address: '2606:2800:220:1:248:1893:25c8:1946', family: 6},
        ]);
        await expect(validate(' HTTPS://EXAMPLE.COM:443/feed#top ')).resolves.toBe(
            'https://example.com/feed',
        );
    });
});
