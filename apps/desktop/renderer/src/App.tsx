import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
    ChevronDown, ChevronLeft, ChevronRight, CircleDot, Folder,
    Folders, Inbox, NotebookText, RefreshCw, Rss, Settings,
} from 'lucide-react';
import type {
    AppCommand,
    ApplicationSettings,
    Collection,
    FetchOperationStatus,
    ItemDetail,
    ItemQuery,
    ItemSummary,
    Note,
    Source,
    SourceImportResult,
    SourceImportStatus,
} from '@rss-reader/contracts';
import {CollectionDialog} from './CollectionDialog';
import {ReaderView} from './ReaderView';
import {SourceDialog} from './SourceDialog';
import {SettingsDialog} from './SettingsDialog';
import {pruneSourceSelection, selectAllSources, toggleSourceSelection} from './source-selection';
import {sidebarLayoutClassName, sidebarToggleLabel} from './sidebar-state';
import {CollectionIconGlyph} from './collection-icons';
import {SourceIcon} from './SourceIcon';
import {Modal} from './Modal';
import {FetchStatusToast} from './FetchStatusToast';
import {NotesPage} from './NotesPage';

type View =
    | 'all'
    | 'unread'
    | 'manage-sources'
    | 'manage-collections'
    | 'notes'
    | `source:${string}`
    | `collection:${string}`;
type SourceDialogState = { mode: 'create' } | { mode: 'edit'; source: Source };
type CollectionDialogState =
    | { mode: 'create' }
    | { mode: 'edit'; collection: Collection };
type DestructiveConfirmation =
    | {kind: 'source'; source: Source}
    | {kind: 'collection'; collection: Collection};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function isReaderView(view: View): boolean {
    return view === 'all' || view === 'unread' || view.startsWith('source:') || view.startsWith('collection:');
}

function itemQuery(view: View): ItemQuery {
    if (view === 'unread') return {unreadOnly: true};
    if (view.startsWith('source:')) {
        return {unreadOnly: false, sourceId: view.slice('source:'.length)};
    }
    if (view.startsWith('collection:')) {
        return {
            unreadOnly: false,
            collectionId: view.slice('collection:'.length),
        };
    }
    return {unreadOnly: false};
}

export function App() {
    const [view, setView] = useState<View>('all');
    const [collectionsExpanded, setCollectionsExpanded] = useState(true);
    const [sourcesExpanded, setSourcesExpanded] = useState(false);
    const [sources, setSources] = useState<Source[]>([]);
    const [collections, setCollections] = useState<Collection[]>([]);
    const [allItems, setAllItems] = useState<ItemSummary[]>([]);
    const [items, setItems] = useState<ItemSummary[]>([]);
    const [selected, setSelected] = useState<ItemDetail>();
    const [allNotes, setAllNotes] = useState<Note[]>([]);
    const [articleNotes, setArticleNotes] = useState<Note[]>([]);
    const [notesLoading, setNotesLoading] = useState(true);
    const [noteBusy, setNoteBusy] = useState(false);
    const [focusedArticleNoteId, setFocusedArticleNoteId] = useState<string>();
    const [focusedNotesPageId, setFocusedNotesPageId] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [itemsLoading, setItemsLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [fetchStatus, setFetchStatus] = useState<FetchOperationStatus>();
    const [importing, setImporting] = useState(false);
    const [importStatus, setImportStatus] = useState<SourceImportStatus>();
    const [importResult, setImportResult] = useState<SourceImportResult>();
    const [extractingItemId, setExtractingItemId] = useState<string>();
    const [error, setError] = useState<string>();
    const [sourceDialog, setSourceDialog] = useState<SourceDialogState>();
    const [collectionDialog, setCollectionDialog] =
        useState<CollectionDialogState>();
    const [settings, setSettings] = useState<ApplicationSettings>();
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const [sourceSelectionMode, setSourceSelectionMode] = useState(false);
    const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [destructiveConfirmation, setDestructiveConfirmation] = useState<DestructiveConfirmation>();
    const initialUpdateStarted = useRef(false);
    const dismissedFetchStartedAt = useRef<string | null | undefined>(undefined);
    const selectedItemId = useRef<string | undefined>(undefined);
    const pendingNoteNavigation = useRef<{itemId: string; noteId: string} | undefined>(undefined);

    const collectionNames = useMemo(
        () => new Map(collections.map((collection) => [collection.id, collection.name])),
        [collections],
    );
    const unreadCount = allItems.filter((item) => !item.readAt).length;

    function toggleSidebar(): void {
        setSidebarCollapsed((collapsed) => {
            const nextCollapsed = !collapsed;
            if (nextCollapsed) {
                setCollectionsExpanded(false);
                setSourcesExpanded(false);
            }
            return nextCollapsed;
        });
    }

    const extractArticle = useCallback(async (item: ItemDetail, retry = false) => {
        setExtractingItemId(item.id);
        try {
            const {cached: _cached, ...articleContent} = await window.readerApi.items.extractArticle(item.id, retry);
            setSelected((current) => current?.id === item.id ? {...current, articleContent} : current);
        } catch (extractionError) {
            setError(errorMessage(extractionError));
        } finally {
            setExtractingItemId((current) => current === item.id ? undefined : current);
        }
    }, []);

    const loadItem = useCallback(async (id: string) => {
        const [detail, nextNotes] = await Promise.all([
            window.readerApi.items.get(id),
            window.readerApi.notes.listForItem(id),
        ]);
        setSelected(detail);
        selectedItemId.current = detail.id;
        setArticleNotes(nextNotes);
        void extractArticle(detail);
    }, [extractArticle]);

    const reloadBase = useCallback(async () => {
        const [nextSources, nextCollections, nextItems, nextSettings, nextNotes] = await Promise.all([
            window.readerApi.sources.list(),
            window.readerApi.collections.list(),
            window.readerApi.items.list({unreadOnly: false}),
            window.readerApi.settings.get(),
            window.readerApi.notes.list(),
        ]);
        setSources(nextSources);
        setCollections(nextCollections);
        setAllItems(nextItems);
        setSettings(nextSettings);
        setAllNotes(nextNotes);
        setNotesLoading(false);
    }, []);

    const loadItems = useCallback(async (nextView: View, preferredId?: string) => {
        if (!isReaderView(nextView)) {
            setItemsLoading(false);
            return;
        }
        setItemsLoading(true);
        try {
            const nextItems = await window.readerApi.items.list(itemQuery(nextView));
            setItems(nextItems);
            const id =
                preferredId && nextItems.some((item) => item.id === preferredId)
                    ? preferredId
                    : nextItems[0]?.id;
            if (id) await loadItem(id);
            else {
                setSelected(undefined);
                selectedItemId.current = undefined;
                setArticleNotes([]);
            }
        } finally {
            setItemsLoading(false);
        }
    }, [loadItem]);

    useEffect(() => {
        let active = true;
        void window.readerApi.health.check().catch((healthError: unknown) => {
            if (active) setError(errorMessage(healthError));
        });
        reloadBase()
            .catch((loadError: unknown) => {
                if (active) setError(errorMessage(loadError));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [reloadBase]);

    useEffect(() => {
        const pending = pendingNoteNavigation.current;
        void loadItems(view, pending?.itemId)
            .then(() => {
                if (pending && pendingNoteNavigation.current === pending) {
                    pendingNoteNavigation.current = undefined;
                    setFocusedArticleNoteId(pending.noteId);
                }
            })
            .catch((loadError: unknown) => setError(errorMessage(loadError)));
    }, [loadItems, view]);

    async function refreshCurrent(preferredId = selected?.id): Promise<void> {
        await reloadBase();
        if (isReaderView(view)) await loadItems(view, preferredId);
    }

    async function mutate(action: () => Promise<unknown>): Promise<boolean> {
        setSaving(true);
        setError(undefined);
        try {
            await action();
            await refreshCurrent();
            return true;
        } catch (mutationError) {
            setError(errorMessage(mutationError));
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function runFetch(action: () => Promise<unknown>): Promise<void> {
        dismissedFetchStartedAt.current = undefined;
        setFetching(true);
        setError(undefined);
        const refreshStatus = async (): Promise<void> => {
            const nextStatus = await window.readerApi.fetch.getStatus();
            if (nextStatus.startedAt !== dismissedFetchStartedAt.current) setFetchStatus(nextStatus);
        };
        const timer = window.setInterval(() => {
            void refreshStatus().catch(() => undefined);
        }, 250);
        try {
            const operation = action();
            await refreshStatus().catch(() => undefined);
            await operation;
        } catch (fetchError) {
            setError(errorMessage(fetchError));
        } finally {
            window.clearInterval(timer);
            await refreshStatus().catch(() => undefined);
            await refreshCurrent().catch((reloadError: unknown) =>
                setError(errorMessage(reloadError)),
            );
            setFetching(false);
        }
    }

    const dismissFetchStatus = useCallback(() => {
        setFetchStatus((current) => {
            dismissedFetchStartedAt.current = current?.startedAt;
            return undefined;
        });
    }, []);

    useEffect(() => {
        if (loading || initialUpdateStarted.current) return;
        initialUpdateStarted.current = true;
        if (sources.some((source) => source.enabled)) {
            void runFetch(() => window.readerApi.fetch.all());
        }
    }, [loading]);

    async function runImport(): Promise<void> {
        setImporting(true);
        setImportResult(undefined);
        setImportStatus(undefined);
        setError(undefined);
        const refreshStatus = async (): Promise<void> => {
            setImportStatus(await window.readerApi.sources.getImportStatus());
        };
        const timer = window.setInterval(() => {
            void refreshStatus().catch(() => undefined);
        }, 400);
        try {
            const result = await window.readerApi.sources.importFile();
            if (!result.canceled) {
                setImportResult(result);
                await refreshCurrent();
            }
        } catch (importError) {
            setError(errorMessage(importError));
        } finally {
            window.clearInterval(timer);
            await refreshStatus().catch(() => undefined);
            setImporting(false);
        }
    }

    async function createSource(
        input: Parameters<typeof window.readerApi.sources.create>[0],
    ): Promise<void> {
        setSaving(true);
        setError(undefined);
        try {
            const {fetchResult} = await window.readerApi.sources.create(input);
            dismissedFetchStartedAt.current = undefined;
            setFetchStatus({
                running: false,
                mode: 'single',
                startedAt: fetchResult.startedAt,
                completedAt: fetchResult.completedAt,
                totalSources: 1,
                completedSources: 1,
                sources: [{
                    sourceId: fetchResult.sourceId,
                    sourceName: fetchResult.sourceName,
                    status: fetchResult.status,
                    itemsInserted: fetchResult.itemsInserted,
                    itemsUpdated: fetchResult.itemsUpdated,
                    itemsSkipped: fetchResult.itemsSkipped,
                    errorMessage: fetchResult.errorMessage,
                }],
            });
            setSourceDialog(undefined);
            await refreshCurrent();
        } catch (createError) {
            setError(errorMessage(createError));
        } finally {
            setSaving(false);
        }
    }

    async function saveSettings(input: ApplicationSettings): Promise<void> {
        setSaving(true);
        setError(undefined);
        try {
            setSettings(await window.readerApi.settings.update(input));
            setSettingsDialogOpen(false);
        } catch (settingsError) {
            setError(errorMessage(settingsError));
        } finally {
            setSaving(false);
        }
    }

    async function selectItem(id: string): Promise<void> {
        try {
            await loadItem(id);
        } catch (selectionError) {
            setError(errorMessage(selectionError));
        }
    }

    async function setRead(id: string, read: boolean): Promise<void> {
        try {
            const next = await window.readerApi.items.setRead(id, read);
            await refreshCurrent(next.id);
        } catch (readError) {
            setError(errorMessage(readError));
        }
    }

    async function createNote(request: Parameters<typeof window.readerApi.notes.create>[0]): Promise<void> {
        setNoteBusy(true);
        setError(undefined);
        try {
            const created = await window.readerApi.notes.create(request);
            setAllNotes((current) => [created, ...current.filter(({id}) => id !== created.id)]);
            if (created.itemId === selectedItemId.current) {
                setArticleNotes((current) => [...current.filter(({id}) => id !== created.id), created]);
            }
        } catch (noteError) {
            setError(errorMessage(noteError));
            throw noteError;
        } finally {
            setNoteBusy(false);
        }
    }

    async function updateNote(id: string, annotationText: string | null): Promise<void> {
        setNoteBusy(true);
        setError(undefined);
        try {
            const updated = await window.readerApi.notes.update({id, annotationText});
            setAllNotes((current) => current.map((note) => note.id === id ? updated : note));
            setArticleNotes((current) => current.map((note) => note.id === id ? updated : note));
        } catch (noteError) {
            setError(errorMessage(noteError));
            throw noteError;
        } finally {
            setNoteBusy(false);
        }
    }

    async function deleteNote(id: string): Promise<void> {
        setNoteBusy(true);
        setError(undefined);
        try {
            await window.readerApi.notes.delete(id);
            setAllNotes((current) => current.filter((note) => note.id !== id));
            setArticleNotes((current) => current.filter((note) => note.id !== id));
        } catch (noteError) {
            setError(errorMessage(noteError));
            throw noteError;
        } finally {
            setNoteBusy(false);
        }
    }

    async function openNoteArticle(note: Note): Promise<void> {
        if (!note.itemId) return;
        if (view === 'all') {
            await loadItems('all', note.itemId)
                .then(() => setFocusedArticleNoteId(note.id))
                .catch((openError: unknown) => setError(errorMessage(openError)));
            return;
        }
        pendingNoteNavigation.current = {itemId: note.itemId, noteId: note.id};
        setView('all');
    }

    const clearFocusedArticleNote = useCallback(() => setFocusedArticleNoteId(undefined), []);
    const clearFocusedNotesPage = useCallback(() => setFocusedNotesPageId(undefined), []);

    async function toggleSource(source: Source): Promise<void> {
        await mutate(() =>
            window.readerApi.sources.update({
                id: source.id,
                input: {
                    name: source.name,
                    feedUrl: source.feedUrl,
                    enabled: !source.enabled,
                    collectionIds: source.collectionIds,
                },
            }),
        );
    }

    async function deleteSelectedSources(): Promise<void> {
        const ids = [...selectedSourceIds];
        if (ids.length === 0) return;
        if (await mutate(() => window.readerApi.sources.deleteMany(ids))) {
            setSelectedSourceIds(new Set());
            setSourceSelectionMode(false);
        }
    }

    async function confirmDestructiveAction(): Promise<void> {
        if (!destructiveConfirmation) return;
        const action = destructiveConfirmation.kind === 'source'
            ? () => window.readerApi.sources.delete(destructiveConfirmation.source.id)
            : () => window.readerApi.collections.delete(destructiveConfirmation.collection.id);
        if (await mutate(action)) setDestructiveConfirmation(undefined);
    }

    useEffect(() => {
        setSelectedSourceIds((current) => pruneSourceSelection(current, sources.map(({id}) => id)));
    }, [sources]);

    useEffect(() => {
        if (view !== 'manage-sources') {
            setSourceSelectionMode(false);
            setSelectedSourceIds(new Set());
        }
    }, [view]);

    useEffect(() => window.readerApi.app.onCommand((command: AppCommand) => {
        if (command === 'add-source') {
            setView('manage-sources');
            setSourceDialog({mode: 'create'});
            return;
        }
        if (command === 'import-sources') {
            if (!importing && !fetching) {
                setView('manage-sources');
                void runImport();
            }
            return;
        }
        if (command === 'fetch-all') {
            if (!fetching && sources.some((source) => source.enabled)) {
                void runFetch(() => window.readerApi.fetch.all());
            }
            return;
        }
        if (!selected) return;
        if (command === 'toggle-read') {
            void setRead(selected.id, !selected.readAt);
            return;
        }
        if (command === 'open-original') {
            void window.readerApi.items.openOriginal(selected.id).catch((openError: unknown) => setError(errorMessage(openError)));
            return;
        }
        const selectedIndex = items.findIndex((item) => item.id === selected.id);
        const offset = command === 'next-item' ? 1 : command === 'previous-item' ? -1 : 0;
        const nextItem = items[selectedIndex + offset];
        if (nextItem) void selectItem(nextItem.id);
    }), [fetching, importing, items, selected, sources]);

    const title =
        view === 'all'
            ? 'All Items'
            : view === 'unread'
                ? 'Unread'
                : view === 'manage-sources'
                    ? 'Sources'
                    : view === 'manage-collections'
                        ? 'Collections'
                        : view === 'notes'
                            ? 'Notes'
                        : view.startsWith('source:')
                            ? sources.find((source) => source.id === view.slice(7))?.name ?? 'Source'
                            : collections.find((collection) => collection.id === view.slice(11))?.name ??
                            'Collection';

    return (
        <div className={sidebarLayoutClassName(sidebarCollapsed)}>
            <aside className="sidebar">
                <div className="brand">
                    <span className="brand-mark" aria-hidden="true"><Rss size={20}/></span>
                    <div className="brand-copy"><strong>RSS Reader</strong><span>Local library</span></div>
                    <button className="sidebar-toggle" onClick={toggleSidebar}
                            aria-label={sidebarToggleLabel(sidebarCollapsed)} title={sidebarToggleLabel(sidebarCollapsed)}>
                        {sidebarCollapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
                    </button>
                </div>
                <nav aria-label="Library">
                    <p className="nav-label">Library</p>
                    <button className={view === 'all' ? 'nav-item active' : 'nav-item'} onClick={() => setView('all')} title="All Items">
                        <span className="nav-entry"><Inbox size={18}/><span className="nav-text">All Items</span></span><span className="count">{allItems.length}</span>
                    </button>
                    <button className={view === 'unread' ? 'nav-item active' : 'nav-item'}
                            onClick={() => setView('unread')} title="Unread">
                        <span className="nav-entry"><CircleDot size={18}/><span className="nav-text">Unread</span></span><span className="count">{unreadCount}</span>
                    </button>
                    <div className="nav-section-header section-label">
                        <button className={view === 'manage-collections' ? 'nav-section-link active' : 'nav-section-link'}
                                onClick={() => setView('manage-collections')} title="Manage collections">
                            <span className="nav-entry"><Folders size={18}/><span className="nav-text">Collections</span></span>
                            <span className="count">{collections.length}</span>
                        </button>
                        <button className="nav-disclosure" aria-label="Toggle collections"
                                aria-expanded={collectionsExpanded} aria-disabled={sidebarCollapsed}
                                title="Toggle collections"
                                onClick={() => !sidebarCollapsed && setCollectionsExpanded((expanded) => !expanded)}>
                            {collectionsExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                        </button>
                    </div>
                    {collectionsExpanded && collections.map((collection) => (
                        <button key={collection.id}
                                className={view === `collection:${collection.id}` ? 'nav-item active' : 'nav-item'}
                                title={collection.name}
                                onClick={() => setView(`collection:${collection.id}`)}>
                            <span className="nav-entry"><CollectionIconGlyph icon={collection.icon}/><span className="nav-text">{collection.name}</span></span>
                        </button>
                    ))}
                    <div className="nav-section-header section-label">
                        <button className={view === 'manage-sources' ? 'nav-section-link active' : 'nav-section-link'}
                                onClick={() => setView('manage-sources')} title="Manage sources">
                            <span className="nav-entry"><Rss size={18}/><span className="nav-text">Sources</span></span>
                            <span className="count">{sources.length}</span>
                        </button>
                        <button className="nav-disclosure" aria-label="Toggle sources"
                                aria-expanded={sourcesExpanded} aria-disabled={sidebarCollapsed}
                                title="Toggle sources"
                                onClick={() => !sidebarCollapsed && setSourcesExpanded((expanded) => !expanded)}>
                            {sourcesExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                        </button>
                    </div>
                    {sourcesExpanded && sources.map((source) => (
                        <button key={source.id}
                                className={view === `source:${source.id}` ? 'nav-item active' : 'nav-item'}
                                title={source.name}
                                onClick={() => setView(`source:${source.id}`)}>
                            <span className="nav-entry"><SourceIcon sourceId={source.id} name={source.name}/><span className="nav-text">{source.name}</span></span>
                        </button>
                    ))}
                    <button className={view === 'notes' ? 'nav-item active section-label' : 'nav-item section-label'}
                            onClick={() => setView('notes')} title="Notes">
                        <span className="nav-entry"><NotebookText size={18}/><span className="nav-text">Notes</span></span>
                        <span className="count">{allNotes.length}</span>
                    </button>
                </nav>
                <div className="sidebar-actions">
                    <button className="sidebar-action-button"
                            disabled={fetching || importing || sources.every((source) => !source.enabled)}
                            onClick={() => runFetch(() => window.readerApi.fetch.all())}
                            aria-label="Update sources" title="Update Sources">
                        <RefreshCw className={fetching ? 'spin' : undefined} size={20} aria-hidden="true"/>
                    </button>
                    <button className="settings-launch-button" onClick={() => setSettingsDialogOpen(true)}
                            aria-label="Open settings" title="Settings">
                        <Settings size={20} aria-hidden="true"/>
                    </button>
                </div>
            </aside>

            <main className={isReaderView(view) ? 'workspace reader-workspace' : 'workspace management-workspace'}>
                <header className="workspace-header">
                    <div>
                        <p className="eyebrow">{isReaderView(view) ? 'Your library' : 'Library setup'}</p>
                        <h1>{title}</h1>
                        <p>{isReaderView(view) ? 'Read imported feed content and keep track of what you have seen.' : view === 'notes' ? 'Review highlights and annotations organised by collection and article.' : view === 'manage-sources' ? 'Add, organise, and manually refresh website or feed subscriptions.' : 'Group a source into as many collections as you need.'}</p>
                    </div>
                    <div className="header-actions">
                        {view === 'manage-sources' && (sourceSelectionMode ? <>
                            <button className="secondary-button" disabled={saving}
                                    onClick={() => setSelectedSourceIds(selectedSourceIds.size === sources.length ? new Set() : selectAllSources(sources.map(({id}) => id)))}>
                                {selectedSourceIds.size === sources.length ? 'Clear all' : 'Select all'}
                            </button>
                            <button className="secondary-button" disabled={saving} onClick={() => {
                                setSourceSelectionMode(false);
                                setSelectedSourceIds(new Set());
                            }}>Cancel</button>
                            <button className="primary-button" disabled={saving || selectedSourceIds.size === 0}
                                    onClick={() => void deleteSelectedSources()}>
                                {saving ? 'Deleting…' : `Delete ${selectedSourceIds.size} selected`}
                            </button>
                        </> : <>
                            <button className="secondary-button" disabled={saving || fetching || importing || sources.length === 0}
                                    onClick={() => setSourceSelectionMode(true)}>Manage</button>
                            <button className="secondary-button" disabled={saving || fetching || importing}
                                    onClick={() => void runImport()}>{importing ? 'Importing…' : 'Import CSV / JSON'}</button>
                            <button className="primary-button" disabled={saving || fetching || importing}
                                    onClick={() => setSourceDialog({mode: 'create'})}>＋ Add source
                            </button>
                        </>)}
                        {view === 'manage-collections' && <button className="primary-button" disabled={saving}
                                                                  onClick={() => setCollectionDialog({mode: 'create'})}>＋
                            Add collection</button>}
                    </div>
                </header>

                {error && <div className="error-banner" role="alert"><span>{error}</span>
                    <button onClick={() => setError(undefined)} aria-label="Dismiss error">×</button>
                </div>}
                {(importStatus?.fileName || importResult) && <section className="import-panel" aria-live="polite">
                    <div className="import-summary">
                        <div>
                            <strong>{importing ? `Importing ${importStatus?.completedRows ?? 0} of ${importStatus?.totalRows ?? 0}` : `Import complete · ${importResult?.totalRows ?? importStatus?.totalRows ?? 0} rows`}</strong>
                            <span>{importing ? importStatus?.fileName : `${importResult?.imported ?? 0} added · ${importResult?.updated ?? 0} existing updated · ${importResult?.failed ?? 0} failed · ${importResult?.collectionsCreated ?? 0} collections created`}</span>
                        </div>
                        <progress max={Math.max(importStatus?.totalRows ?? 1, 1)}
                                  value={importStatus?.completedRows ?? 0}/>
                        {!importing && <button className="close-button" onClick={() => {
                            setImportResult(undefined);
                            setImportStatus(undefined);
                        }} aria-label="Dismiss import status">×</button>}
                    </div>
                    {importResult && importResult.failed > 0 && <div className="import-results">
                        {importResult.results.filter((result) => result.status === 'failed').slice(0, 20).map((result) =>
                            <div key={result.row}>
                                <span>Row {result.row} · {result.name ?? result.url}</span>
                                <span>{result.errorMessage}</span>
                            </div>)}
                        {importResult.failed > 20 && <div>
                            <span>Additional failures</span><span>{importResult.failed - 20} more rows failed</span>
                        </div>}
                    </div>}
                </section>}

                {loading ? (
                    <div className="empty-state">Loading your local library…</div>
                ) : isReaderView(view) ? (
                    <ReaderView items={items} selected={selected} loading={itemsLoading}
                                extracting={extractingItemId === selected?.id}
                                notes={articleNotes} noteBusy={noteBusy} focusNoteId={focusedArticleNoteId}
                                onSelect={(id) => void selectItem(id)} onSetRead={(id, read) => void setRead(id, read)}
                                onRetryExtraction={(id) => selected?.id === id && void extractArticle(selected, true)}
                                onOpenExternalLink={(itemId, url) => void window.readerApi.items.openExternalLink(itemId, url).catch((openError: unknown) => setError(errorMessage(openError)))}
                                onOpenOriginal={(id) => void window.readerApi.items.openOriginal(id).catch((openError: unknown) => setError(errorMessage(openError)))}
                                onCreateNote={createNote} onUpdateNote={updateNote} onDeleteNote={deleteNote}
                                onOpenNotes={(noteId) => {setFocusedNotesPageId(noteId); setView('notes');}}
                                onFocusNoteHandled={clearFocusedArticleNote}/>
                ) : view === 'notes' ? <NotesPage notes={allNotes} loading={notesLoading} busy={noteBusy}
                    focusNoteId={focusedNotesPageId} onFocusHandled={clearFocusedNotesPage}
                    onOpenArticle={(note) => void openNoteArticle(note)}
                    onOpenOriginal={(note) => void window.readerApi.notes.openOriginal(note.id).catch((openError: unknown) => setError(errorMessage(openError)))}
                    onUpdate={updateNote} onDelete={deleteNote}/>
                : view === 'manage-sources' ? (
                    <section className="content-section" aria-label="Sources">
                        {sources.length === 0 ?
                            <div className="empty-state"><span className="empty-icon">⌁</span><h2>No sources yet</h2>
                                <p>Add a website or RSS/Atom URL. It is saved only when a usable feed is found.</p>
                                <button className="text-button" onClick={() => setSourceDialog({mode: 'create'})}>Add
                                    the first source
                                </button>
                            </div> : (
                                <div className="source-list">{sources.map((source) => <article className={selectedSourceIds.has(source.id) ? 'source-card staged-source-removal' : 'source-card'}
                                                                                               key={source.id} role="button" tabIndex={0}
                                                                                               aria-label={`Open ${source.name}`}
                                                                                               onClick={(event) => {
                                                                                                   if ((event.target as HTMLElement).closest('button')) return;
                                                                                                   if (sourceSelectionMode) {
                                                                                                       setSelectedSourceIds((current) => toggleSourceSelection(current, source.id));
                                                                                                   } else {
                                                                                                       setView(`source:${source.id}`);
                                                                                                   }
                                                                                               }}
                                                                                               onKeyDown={(event) => {
                                                                                                   if (event.key === 'Enter' || event.key === ' ') {
                                                                                                       event.preventDefault();
                                                                                                       if (sourceSelectionMode) {
                                                                                                           setSelectedSourceIds((current) => toggleSourceSelection(current, source.id));
                                                                                                       } else {
                                                                                                           setView(`source:${source.id}`);
                                                                                                       }
                                                                                                   }
                                                                                               }}>
                                    <div className="source-identity">{sourceSelectionMode && <button
                                        className="source-selection-toggle"
                                        aria-label={`${selectedSourceIds.has(source.id) ? 'Unselect' : 'Select'} ${source.name}`}
                                        aria-pressed={selectedSourceIds.has(source.id)}
                                        onClick={() => setSelectedSourceIds((current) => toggleSourceSelection(current, source.id))}>
                                        <span aria-hidden="true">{selectedSourceIds.has(source.id) ? '✓' : ''}</span>
                                    </button>}<span className="source-monogram"><SourceIcon sourceId={source.id} name={source.name} size={22}/></span>
                                        <div>
                                            <div className="source-title-row"><h2>{source.name}</h2><span
                                                className={source.enabled ? 'state enabled' : 'state disabled'}>{source.enabled ? 'Enabled' : 'Disabled'}</span>
                                            </div>
                                            <span className="source-url">{source.feedUrl}</span><span
                                            className="fetch-time">{source.lastFetchedAt ? `Last fetched ${new Date(source.lastFetchedAt).toLocaleString()}` : 'Never fetched'}</span>
                                            <div className="tag-row">{source.collectionIds.length === 0 ? <span
                                                className="muted">No collections</span> : source.collectionIds.map((id) =>
                                                <span className="tag"
                                                      key={id}>{collectionNames.get(id) ?? 'Unknown'}</span>)}</div>
                                        </div>
                                    </div>
                                    {!sourceSelectionMode && <div className="card-actions">
                                        <button className="icon-button"
                                                onClick={() => setSourceDialog({mode: 'edit', source})}>Edit
                                        </button>
                                        <button className="secondary-button" disabled={saving || fetching || importing}
                                                onClick={() => toggleSource(source)}>{source.enabled ? 'Disable' : 'Enable'}</button>
                                        <button className="icon-button danger"
                                                onClick={() => setDestructiveConfirmation({kind: 'source', source})}>Delete
                                        </button>
                                    </div>}
                                </article>)}</div>
                            )}
                    </section>
                ) : (
                    <section className="content-section" aria-label="Collections">
                        {collections.length === 0 ?
                            <div className="empty-state"><span className="empty-icon">▦</span><h2>No collections
                                yet</h2><p>Create a collection to organise sources across topics.</p>
                                <button className="text-button"
                                        onClick={() => setCollectionDialog({mode: 'create'})}>Create the first
                                    collection
                                </button>
                            </div> : <div className="collection-grid">{collections.map((collection) => <article
                                className="collection-card" key={collection.id} role="button" tabIndex={0}
                                aria-label={`Open ${collection.name}`}
                                onClick={(event) => {
                                    if (!(event.target as HTMLElement).closest('button')) setView(`collection:${collection.id}`);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        setView(`collection:${collection.id}`);
                                    }
                                }}><span
                                className="collection-icon"><CollectionIconGlyph icon={collection.icon}/></span>
                                <div><h2>{collection.name}</h2>
                                    <p>{collection.sourceCount} {collection.sourceCount === 1 ? 'source' : 'sources'}</p>
                                </div>
                                <div className="card-actions">
                                    <button className="icon-button"
                                            onClick={() => setCollectionDialog({mode: 'edit', collection})}>Edit
                                    </button>
                                    <button className="icon-button danger"
                                            onClick={() => setDestructiveConfirmation({kind: 'collection', collection})}>Delete
                                    </button>
                                </div>
                            </article>)}</div>}
                    </section>
                )}
            </main>

            {fetchStatus?.mode && <FetchStatusToast status={fetchStatus} onDismiss={dismissFetchStatus}/>}

            {sourceDialog && <SourceDialog key={sourceDialog.mode === 'edit' ? sourceDialog.source.id : 'new-source'}
                                           source={sourceDialog.mode === 'edit' ? sourceDialog.source : undefined}
                                           collections={collections} busy={saving}
                                           onCancel={() => setSourceDialog(undefined)} onCreate={createSource}
                                           onUpdate={async (request) => {
                                               if (await mutate(() => window.readerApi.sources.update(request))) setSourceDialog(undefined);
                                           }}/>}
            {collectionDialog && <CollectionDialog
                key={collectionDialog.mode === 'edit' ? collectionDialog.collection.id : 'new-collection'}
                collection={collectionDialog.mode === 'edit' ? collectionDialog.collection : undefined} busy={saving}
                sources={sources}
                onCancel={() => setCollectionDialog(undefined)} onCreate={async (input) => {
                if (await mutate(() => window.readerApi.collections.create(input))) setCollectionDialog(undefined);
            }} onUpdate={async (request) => {
                if (await mutate(() => window.readerApi.collections.update(request))) setCollectionDialog(undefined);
            }}/>}
            {settingsDialogOpen && settings && <SettingsDialog
                settings={settings} busy={saving}
                onCancel={() => setSettingsDialogOpen(false)} onSave={saveSettings}/>
            }
            {destructiveConfirmation && <Modal
                title={destructiveConfirmation.kind === 'source' ? 'Delete source?' : 'Delete collection?'}
                description={destructiveConfirmation.kind === 'source'
                    ? `“${destructiveConfirmation.source.name}” and all of its items, cached content, images, memberships, and fetch history will be permanently deleted. Saved notes will be retained with their article and source details.`
                    : `“${destructiveConfirmation.collection.name}” will be permanently deleted. Its sources and items will be kept.`}
                onCancel={() => setDestructiveConfirmation(undefined)}>
                <div className="confirmation-prompt" role="alertdialog" aria-label="Confirm deletion">
                    <p>This action cannot be undone.</p>
                    <div className="modal-actions">
                        <button className="secondary-button" onClick={() => setDestructiveConfirmation(undefined)}>Cancel</button>
                        <button className="primary-button danger-button" disabled={saving}
                                onClick={() => void confirmDestructiveAction()}>
                            {saving ? 'Deleting…' : destructiveConfirmation.kind === 'source' ? 'Delete source' : 'Delete collection'}
                        </button>
                    </div>
                </div>
            </Modal>}
        </div>
    );
}
