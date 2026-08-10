// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {ReaderApi} from '@rss-reader/contracts';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {App} from './App';

const sourceId = '2d8430d4-6aa7-4eb8-a4fb-0fcfd20e0783';
const secondSourceId = '03c7b981-94f2-49c6-b002-534f6a54ab32';
const itemId = '69325610-446a-4f2d-8ccf-18a5e9e2af12';
const collectionId = '81899965-823c-49ec-8094-50d421eeb1dd';
const now = '2026-08-10T12:00:00.000Z';

let root: Root;
let deleteManyCalls: string[][];
let fetchAllCalls: number;
let deleteSourceCalls: string[];
let healthCheckError: Error | undefined;

async function settle(): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
}

function buttonByTitle(title: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
    if (!button) throw new Error(`Button titled ${title} was not rendered.`);
    return button;
}

function buttonByText(text: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent?.trim() === text);
    if (!button) throw new Error(`Button labelled ${text} was not rendered.`);
    return button;
}

beforeEach(async () => {
    (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    deleteManyCalls = [];
    fetchAllCalls = 0;
    deleteSourceCalls = [];
    healthCheckError = undefined;
    const sources = [
        {id: sourceId, name: 'Example', feedUrl: 'https://example.com/feed.xml', siteUrl: 'https://example.com/', description: null, enabled: true, lastFetchedAt: now, collectionIds: [], createdAt: now, updatedAt: now},
        {id: secondSourceId, name: 'Second', feedUrl: 'https://second.example/feed.xml', siteUrl: null, description: null, enabled: true, lastFetchedAt: null, collectionIds: [], createdAt: now, updatedAt: now},
    ];
    const summary = {id: itemId, sourceId, sourceName: 'Example', canonicalUrl: 'https://example.com/article', title: 'Article title', author: 'Writer', publishedAt: now, firstSeenAt: now, readAt: null};
    const api = {
        health: {check: async () => {
            if (healthCheckError) throw healthCheckError;
            return {status: 'ok', database: {name: 'reader', time: now, migration: 'stage-7'}};
        }},
        settings: {get: async () => ({initialArticleLimit: 25}), update: async (input: unknown) => input},
        sources: {
            list: async () => sources,
            get: async () => sources[0],
            create: async () => { throw new Error('Not used'); },
            update: async () => sources[0],
            delete: async (id: string) => { deleteSourceCalls.push(id); return {success: true}; },
            deleteMany: async (ids: string[]) => { deleteManyCalls.push(ids); return {success: true}; },
            fetch: async () => { throw new Error('Not used'); },
            importFile: async () => ({canceled: true}),
            getImportStatus: async () => ({running: false, fileName: null, totalRows: 0, completedRows: 0, imported: 0, updated: 0, failed: 0, collectionsCreated: 0, startedAt: null, completedAt: null}),
        },
        collections: {list: async () => [{id: collectionId, name: 'Technology', icon: 'technology', sourceCount: 0, createdAt: now, updatedAt: now}], create: async () => { throw new Error('Not used'); }, update: async () => { throw new Error('Not used'); }, delete: async () => ({success: true}), addSource: async () => ({success: true}), removeSource: async () => ({success: true})},
        fetch: {all: async () => { fetchAllCalls += 1; return {startedAt: now, completedAt: now, totalSources: 0, succeeded: 0, unchanged: 0, failed: 0, itemsInserted: 0, itemsUpdated: 0, itemsSkipped: 0, sources: []}; }, getStatus: async () => ({running: false, mode: null, startedAt: null, completedAt: null, totalSources: 0, completedSources: 0, sources: []})},
        items: {
            list: async () => [summary],
            get: async () => ({...summary, summary: 'Summary', feedContentHtml: '<p>Feed body</p>', articleContent: {status: 'complete', retrievedUrl: summary.canonicalUrl, readerHtml: '<p>Full article</p>', readerText: 'Full article', extractionError: null, fetchedAt: now, updatedAt: now}}),
            setRead: async () => { throw new Error('Not used'); },
            openOriginal: async () => ({opened: true}),
            extractArticle: async () => ({status: 'complete', retrievedUrl: summary.canonicalUrl, readerHtml: '<p>Full article</p>', readerText: 'Full article', extractionError: null, fetchedAt: now, updatedAt: now, cached: true}),
            openExternalLink: async () => ({opened: true}),
        },
        app: {onCommand: () => () => undefined},
    } as unknown as ReaderApi;
    window.readerApi = api;
    root = createRoot(document.querySelector('#root')!);
    await act(async () => root.render(<App/>));
    await settle();
});

afterEach(async () => {
    await act(async () => root.unmount());
});

describe('App renderer interactions', () => {
    it('loads stage-7 data and opens Settings from the sidebar gear', async () => {
        expect(document.querySelector('button[title="Example"]')).toBeNull();
        await act(async () => buttonByTitle('Toggle sources').click());
        expect(buttonByTitle('Example')).not.toBeNull();
        expect(buttonByTitle('Technology')).not.toBeNull();
        await act(async () => buttonByTitle('Settings').click());
        expect(document.querySelector('.settings-modal h2')?.textContent).toBe('Settings');
        expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('25');
    });
    it('keeps base data and Settings usable when the diagnostic health call fails', async () => {
        await act(async () => root.unmount());
        healthCheckError = new Error('Diagnostic health failure');
        document.body.innerHTML = '<div id="root"></div>';
        root = createRoot(document.querySelector('#root')!);
        await act(async () => root.render(<App/>));
        await settle();

        expect(buttonByTitle('Manage sources').textContent).toContain('2');
        expect(buttonByTitle('Manage collections').textContent).toContain('1');
        await act(async () => buttonByTitle('Settings').click());
        expect(document.querySelector('.settings-modal h2')?.textContent).toBe('Settings');
    });
    it('updates sources on launch and exposes only the sidebar update control', () => {
        expect(fetchAllCalls).toBe(1);
        expect(buttonByTitle('Update Sources')).not.toBeNull();
        expect([...document.querySelectorAll('button')].some((button) => /fetch/i.test(button.textContent ?? ''))).toBe(false);
    });

    it('starts with the Sources navigation section collapsed', () => {
        expect(buttonByTitle('Toggle sources').getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector('button[title="Example"]')).toBeNull();
    });
    it('collapses the icon sidebar and expands the reader without removing the sidebar', async () => {
        expect(document.querySelectorAll('.sidebar .nav-item svg, .sidebar .nav-section-link svg').length).toBeGreaterThanOrEqual(4);
        await act(async () => buttonByTitle('Collapse sidebar').click());
        expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(true);
        await act(async () => buttonByTitle('Expand sidebar').click());
        expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(false);

        await act(async () => buttonByTitle('Enter fullscreen reader mode').click());
        expect(document.querySelector('.reader-grid')?.classList.contains('reader-expanded')).toBe(true);
        expect(document.querySelector('.sidebar')).not.toBeNull();
        expect(buttonByTitle('Exit fullscreen reader mode').textContent?.trim()).toBe('');
        expect(buttonByTitle('Exit fullscreen reader mode').classList.contains('reader-expand-button')).toBe(true);
        await act(async () => buttonByTitle('Exit fullscreen reader mode').click());
        expect(document.querySelector('.reader-grid')?.classList.contains('reader-expanded')).toBe(false);
    });

    it('collapses navigation disclosures with the sidebar and prevents reopening them in icon mode', async () => {
        await act(async () => buttonByTitle('Toggle collections').click());
        expect(buttonByTitle('Toggle collections').getAttribute('aria-expanded')).toBe('false');
        await act(async () => buttonByTitle('Toggle sources').click());
        expect(buttonByTitle('Toggle sources').getAttribute('aria-expanded')).toBe('true');
        await act(async () => buttonByTitle('Collapse sidebar').click());
        expect(buttonByTitle('Toggle sources').getAttribute('aria-expanded')).toBe('false');
        await act(async () => buttonByTitle('Toggle sources').click());
        expect(buttonByTitle('Toggle sources').getAttribute('aria-expanded')).toBe('false');
    });

    it('navigates from section labels without changing their disclosure state', async () => {
        expect(buttonByTitle('Toggle sources').getAttribute('aria-expanded')).toBe('false');
        await act(async () => buttonByTitle('Manage sources').click());
        await settle();
        expect(document.querySelector('main h1')?.textContent).toBe('Sources');
        expect(buttonByTitle('Toggle sources').getAttribute('aria-expanded')).toBe('false');
        expect([...document.querySelectorAll('.sidebar .nav-label')].some((label) => label.textContent === 'Manage')).toBe(false);
    });

    it('offers only the curated collection icon choices when creating a collection', async () => {
        await act(async () => buttonByTitle('Manage collections').click());
        await settle();
        await act(async () => buttonByText('＋ Add collection').click());
        const choices = document.querySelectorAll<HTMLInputElement>('input[name="collection-icon"]');
        expect(choices).toHaveLength(9);
        expect([...choices].find((choice) => choice.value === 'folder')?.checked).toBe(true);
    });

    it('opens collection and source library views from their management cards', async () => {
        await act(async () => buttonByTitle('Manage collections').click());
        await settle();
        await act(async () => document.querySelector<HTMLElement>('.collection-card')!.click());
        await settle();
        expect(document.querySelector('main h1')?.textContent).toBe('Technology');

        await act(async () => buttonByTitle('Manage sources').click());
        await settle();
        await act(async () => document.querySelector<HTMLElement>('.source-card')!.click());
        await settle();
        expect(document.querySelector('main h1')?.textContent).toBe('Example');
    });

    it('uses source favicons and falls back to an RSS icon when loading fails', async () => {
        await act(async () => buttonByTitle('Toggle sources').click());
        const favicon = document.querySelector<HTMLImageElement>(`.nav-item img[src="rss-reader-favicon://source/${sourceId}"]`)!;
        expect(favicon).not.toBeNull();
        await act(async () => favicon.dispatchEvent(new Event('error')));
        expect(document.querySelector(`.nav-item img[src="rss-reader-favicon://source/${sourceId}"]`)).toBeNull();
        expect(document.querySelector('.nav-item svg')).not.toBeNull();
    });

    it('orders source actions as Edit, Disable, Delete', async () => {
        await act(async () => buttonByTitle('Manage sources').click());
        await settle();
        const actions = [...document.querySelectorAll('.source-card .card-actions button')]
            .map((button) => button.textContent?.trim());
        expect(actions.slice(0, 3)).toEqual(['Edit', 'Disable', 'Delete']);
    });

    it('uses an in-app prompt before deleting a source', async () => {
        await act(async () => buttonByTitle('Manage sources').click());
        await settle();
        await act(async () => document.querySelector<HTMLButtonElement>('.source-card .danger')!.click());
        expect(document.querySelector('[aria-label="Confirm deletion"]')).not.toBeNull();
        expect(deleteSourceCalls).toEqual([]);
        await act(async () => buttonByText('Delete source').click());
        await settle();
        expect(deleteSourceCalls).toEqual([sourceId]);
    });

    it('stages bulk deletion, cancels safely, and deletes only after explicit confirmation', async () => {
        await act(async () => buttonByTitle('Manage sources').click());
        await settle();
        await act(async () => buttonByText('Manage').click());
        const firstToggle = document.querySelector<HTMLButtonElement>('.source-selection-toggle')!;
        await act(async () => firstToggle.click());
        expect(firstToggle.closest('.source-card')?.classList.contains('staged-source-removal')).toBe(true);
        expect(buttonByText('Delete 1 selected').disabled).toBe(false);

        await act(async () => buttonByText('Cancel').click());
        expect(document.querySelector('.source-selection-toggle')).toBeNull();
        expect(deleteManyCalls).toEqual([]);

        await act(async () => buttonByText('Manage').click());
        await act(async () => document.querySelector<HTMLButtonElement>('.source-selection-toggle')!.click());
        await act(async () => buttonByText('Delete 1 selected').click());
        await settle();
        expect(deleteManyCalls).toEqual([[sourceId]]);
        expect(document.querySelector('.source-selection-toggle')).toBeNull();
    });

    it('selects and deselects a source by clicking anywhere on its card in selection mode', async () => {
        await act(async () => buttonByTitle('Manage sources').click());
        await settle();
        await act(async () => buttonByText('Manage').click());
        const card = document.querySelector<HTMLElement>('.source-card')!;
        await act(async () => card.click());
        expect(card.classList.contains('staged-source-removal')).toBe(true);
        await act(async () => card.click());
        expect(card.classList.contains('staged-source-removal')).toBe(false);
    });
});
