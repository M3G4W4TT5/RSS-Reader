import {promises as dns} from 'node:dns';
import {BlockList, isIP} from 'node:net';
import {FeedIngestionError, type PublicUrlValidator} from './types';

export type AddressResolver = (
    hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const) {
    blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
    ['2001:db8::', 32],
] as const) {
    blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

function normalizedAddress(address: string): { address: string; family: 4 | 6 } {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return {address: mapped[1], family: 4};
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
        throw new FeedIngestionError('network', 'The URL resolved to an invalid network address.');
    }
    return {address, family};
}

export function isPublicAddress(address: string): boolean {
    const normalized = normalizedAddress(address);
    return !blockedAddresses.check(
        normalized.address,
        normalized.family === 4 ? 'ipv4' : 'ipv6',
    );
}

const defaultResolver: AddressResolver = async (hostname) =>
    dns.lookup(hostname, {all: true, verbatim: true});

export function createPublicUrlValidator(
    resolveAddresses: AddressResolver = defaultResolver,
): PublicUrlValidator {
    return async (value: string): Promise<string> => {
        let url: URL;
        try {
            url = new URL(value.trim());
        } catch {
            throw new FeedIngestionError('network', 'Enter a valid website or feed URL.');
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new FeedIngestionError('network', 'The URL must use HTTP or HTTPS.');
        }
        if (url.username || url.password) {
            throw new FeedIngestionError('network', 'The URL must not contain credentials.');
        }
        url.hash = '';

        const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            (!hostname.includes('.') && isIP(hostname) === 0)
        ) {
            throw new FeedIngestionError('network', 'Local network addresses are not allowed.');
        }

        let addresses: Array<{ address: string; family: number }>;
        if (isIP(hostname)) {
            addresses = [{address: hostname, family: isIP(hostname)}];
        } else {
            try {
                addresses = await resolveAddresses(hostname);
            } catch (error) {
                throw new FeedIngestionError('network', 'The URL hostname could not be resolved.', {
                    cause: error,
                });
            }
        }
        if (addresses.length === 0 || addresses.some(({address}) => !isPublicAddress(address))) {
            throw new FeedIngestionError('network', 'Local or private network addresses are not allowed.');
        }
        return url.toString();
    };
}

export const assertPublicHttpUrl = createPublicUrlValidator();
