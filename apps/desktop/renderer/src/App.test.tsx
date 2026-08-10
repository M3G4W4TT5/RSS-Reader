// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {ItemSummary, Note, ReaderApi} from '@rss-reader/contracts';
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
let fetchAllAction: () => Promise<unknown>;
let fetchStatusResponse: unknown;
let itemListResponse: ItemSummary[];
let notesResponse: Note[];

const emptyFetchResult = {startedAt: now, completedAt: now, totalSources: 0, succeeded: 0, unchanged: 0, failed: 0, itemsInserted: 0, itemsUpdated: 0, itemsSkipped: 0, sources: []};

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
    HTMLElement.prototype.scrollIntoView = () => undefined;
    document.body.innerHTML = '<div id="root"></div>';
    deleteManyCalls = [];
    fetchAllCalls = 0;
    deleteSourceCalls = [];
    healthCheckError = undefined;
    fetchAllAction = async () => emptyFetchResult;
    fetchStatusResponse = {running: false, mode: null, startedAt: null, completedAt: null, totalSources: 0, completedSources: 0, sources: []};
    const sources = [
        {id: sourceId, name: 'Example', feedUrl: 'https://example.com/feed.xml', siteUrl: 'https://example.com/', description: null, enabled: true, lastFetchedAt: now, collectionIds: [], createdAt: now, updatedAt: now},
        {id: secondSourceId, name: 'Second', feedUrl: 'https://second.example/feed.xml', siteUrl: null, description: null, enabled: true, lastFetchedAt: null, collectionIds: [], createdAt: now, updatedAt: now},
    ];
    const summary = {id: itemId, sourceId, sourceName: 'Example', canonicalUrl: 'https://example.com/article', title: 'Article title', author: 'Writer', publishedAt: now, firstSeenAt: now, readAt: null};
    itemListResponse = [summary];
    notesResponse = [];
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
        fetch: {all: async () => { fetchAllCalls += 1; return fetchAllAction(); }, getStatus: async () => fetchStatusResponse},
        items: {
            list: async () => itemListResponse,
            get: async (id: string) => {
                const item = itemListResponse.find((candidate) => candidate.id === id);
                if (!item) throw new Error('Item not found');
                return {...item, summary: 'Summary', feedContentHtml: `<p>${item.title} body</p>`, articleContent: {status: 'complete', retrievedUrl: item.canonicalUrl, readerHtml: `<p>${item.title} body</p>`, readerText: `${item.title} body`, extractionError: null, fetchedAt: now, updatedAt: now}};
            },
            setRead: async () => { throw new Error('Not used'); },
            openOriginal: async () => ({opened: true}),
            extractArticle: async (id: string) => {
                const item = itemListResponse.find((candidate) => candidate.id === id) ?? summary;
                return {status: 'complete', retrievedUrl: item.canonicalUrl, readerHtml: `<p>${item.title} body</p>`, readerText: `${item.title} body`, extractionError: null, fetchedAt: now, updatedAt: now, cached: true};
            },
            openExternalLink: async () => ({opened: true}),
        },
        notes: {
            list: async () => notesResponse,
            listForItem: async (id: string) => notesResponse.filter(({itemId: noteItemId}) => noteItemId === id),
            create: async () => { throw new Error('Not used'); },
            update: async () => { throw new Error('Not used'); },
            delete: async () => ({success: true}),
            openOriginal: async () => ({opened: true}),
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
    it('orders articles globally by date and time instead of grouping them by source', async () => {
        const older = {...itemListResponse[0]!, id: '69325610-446a-4f2d-8ccf-18a5e9e2af10', title: 'Older from Example',
            publishedAt: '2026-08-10T10:00:00.000Z'};
        const newest = {...itemListResponse[0]!, id: '69325610-446a-4f2d-8ccf-18a5e9e2af11', title: 'Newest from Example',
            publishedAt: '2026-08-10T12:00:00.000Z'};
        const middle = {...itemListResponse[0]!, id: '69325610-446a-4f2d-8ccf-18a5e9e2af13', sourceId: secondSourceId,
            sourceName: 'Second', title: 'Middle from Second', publishedAt: '2026-08-10T11:00:00.000Z'};
        itemListResponse = [newest, older, middle];
        await act(async () => root.unmount());
        document.body.innerHTML = '<div id="root"></div>';
        root = createRoot(document.querySelector('#root')!);
        await act(async () => root.render(<App/>));
        await settle();

        expect([...document.querySelectorAll('.item-row strong')].map(({textContent}) => textContent))
            .toEqual(['Newest from Example', 'Middle from Second', 'Older from Example']);
    });

    it('opens the non-disclosure Notes entry below Sources', async () => {
        const notesButton = buttonByTitle('Notes');
        const sourcesHeader = buttonByTitle('Manage sources').closest('.nav-section-header')!;
        expect(sourcesHeader.compareDocumentPosition(notesButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(notesButton.getAttribute('aria-expanded')).toBeNull();
        await act(async () => notesButton.click());
        await settle();
        expect(document.querySelector('main h1')?.textContent).toBe('Notes');
        expect(document.querySelector('.notes-page')?.textContent).toContain('No notes yet');
    });
    it('opens the note source article instead of the first All Items article', async () => {
        const targetItemId = '3b054f2c-67a2-43d7-b9be-30ed3cb6bc45';
        const top = itemListResponse[0]!;
        const target: ItemSummary = {...top, id: targetItemId, title: 'Target article',
            canonicalUrl: 'https://example.com/target', publishedAt: '2026-08-09T12:00:00.000Z'};
        itemListResponse = [top, target];
        notesResponse = [{
            id: 'bb2b1b59-2c71-4099-a571-c3751bb44068', itemId: targetItemId,
            quoteText: 'Target article', annotationText: 'Open this one',
            anchor: {exact: 'Target article', prefix: '', suffix: ' body', start: 0, end: 14, contentHash: 'hash'},
            articleTitle: target.title, sourceName: target.sourceName, canonicalUrl: target.canonicalUrl,
            collectionNames: [], createdAt: now, updatedAt: now,
        }];
        await act(async () => root.unmount());
        document.body.innerHTML = '<div id="root"></div>';
        root = createRoot(document.querySelector('#root')!);
        await act(async () => root.render(<App/>));
        await settle();

        await act(async () => buttonByTitle('Notes').click());
        await settle();
        await act(async () => buttonByText('Open in article').click());
        await settle();

        expect(document.querySelector('.article-header h2')?.textContent).toBe('Target article');
        expect(document.querySelector('.item-row.selected strong')?.textContent).toBe('Target article');
    });
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
        expect(document.querySelector('.error-banner')).toBeNull();
        expect(document.querySelector('.error-toast')).not.toBeNull();
        expect(document.body.textContent).not.toContain('Diagnostic health failure');
        await act(async () => document.querySelector<HTMLButtonElement>('.error-toast-disclosure')!.click());
        expect(document.body.textContent).toContain('Diagnostic health failure');
        await act(async () => buttonByTitle('Settings').click());
        expect(document.querySelector('.settings-modal h2')?.textContent).toBe('Settings');
    });
    it('updates sources on launch and exposes only the sidebar update control', () => {
        expect(fetchAllCalls).toBe(1);
        expect(buttonByTitle('Update Sources')).not.toBeNull();
        expect([...document.querySelectorAll('button')].some((button) => /fetch/i.test(button.textContent ?? ''))).toBe(false);
    });

    it('dispatches only one manual update when update triggers occur in the same render', async () => {
        let finishFetch: (() => void) | undefined;
        fetchAllAction = () => new Promise((resolve) => {
            finishFetch = () => resolve(emptyFetchResult);
        });
        await act(async () => {
            const update = buttonByTitle('Update Sources');
            update.click();
            update.click();
        });
        expect(fetchAllCalls).toBe(2);
        finishFetch?.();
        await settle();
    });

    it('keeps a dismissed running update hidden while polling continues', async () => {
        let finishFetch: (() => void) | undefined;
        fetchStatusResponse = {
            running: true, mode: 'all', startedAt: '2026-08-10T12:05:00.000Z', completedAt: null,
            totalSources: 2, completedSources: 1,
            sources: [{sourceId, sourceName: 'Example', status: 'success', itemsInserted: 1, itemsUpdated: 0, itemsSkipped: 0, errorMessage: null}],
        };
        fetchAllAction = () => new Promise((resolve) => {
            finishFetch = () => resolve(emptyFetchResult);
        });

        await act(async () => buttonByTitle('Update Sources').click());
        await settle();
        expect(document.querySelector('.fetch-toast-copy strong')?.textContent).toBe('Updating 1 of 2 sources');
        await act(async () => document.querySelector<HTMLButtonElement>('.fetch-toast-dismiss')!.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
        expect(document.querySelector('.fetch-toast')).toBeNull();

        fetchStatusResponse = {...fetchStatusResponse as object, running: false, completedAt: '2026-08-10T12:06:00.000Z', completedSources: 2};
        finishFetch?.();
        await settle();
        expect(document.querySelector('.fetch-toast')).toBeNull();
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
