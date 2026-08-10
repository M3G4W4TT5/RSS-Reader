import {useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent} from 'react';
import {
    ChevronLeft, ChevronRight, Highlighter, Maximize2, MessageSquareOff, MessageSquareText,
    Minimize2, NotebookText, Save, Trash2, X, Star, Clock3, Tags, CheckCircle2, ExternalLink,
} from 'lucide-react';
import type {CreateNoteRequest, ItemDetail, ItemSummary, Note, SavedArticle} from '@rss-reader/contracts';
import {sanitizeFeedContent} from './sanitize-feed-content';
import {readerGridClassName, readerModeLabel} from './reader-mode';
import {applyNoteHighlights, captureTextAnchor, noteOverlaps} from './article-notes';

interface ReaderViewProps {
    items: ItemSummary[];
    selected?: ItemDetail;
    loading: boolean;
    extracting: boolean;
    notes: Note[];
    noteBusy: boolean;
    focusNoteId?: string;
    archivedItems?: SavedArticle[];
    readLaterView?: boolean;

    onSelect(id: string): void;

    onMarkUnread(id: string): void;

    onOpenOriginal(id: string): void;

    onRetryExtraction(id: string): void;

    onOpenExternalLink(itemId: string, url: string): void;

    onCreateNote(request: CreateNoteRequest): Promise<void>;

    onUpdateNote(id: string, annotationText: string | null): Promise<void>;

    onDeleteNote(id: string): Promise<void>;

    onOpenNotes(noteId: string): void;

    onFocusNoteHandled(): void;
    onSetStarred?(id: string, enabled: boolean): Promise<void>;
    onSetReadLater?(id: string, enabled: boolean): Promise<void>;
    onDoneReadLater?(id: string): Promise<void>;
    onEditTags?(id: string): void;
    onOpenArchived?(article: SavedArticle): void;
}

type NoteMenu = {
    kind: 'selection';
    anchor: CreateNoteRequest['anchor'];
    x: number;
    y: number;
    annotate: boolean;
    draft: string;
    overlaps: boolean;
} | {
    kind: 'existing';
    noteId: string;
    x: number;
    y: number;
    draft: string;
    confirmingDelete: boolean;
};

function itemDate(item: ItemSummary): string {
    return new Date(item.publishedAt ?? item.firstSeenAt).toLocaleString();
}

function menuPosition(bounds: Pick<DOMRect, 'left' | 'bottom'>): {x: number; y: number} {
    return {
        x: Math.max(16, Math.min(bounds.left, window.innerWidth - 376)),
        y: Math.max(16, Math.min(bounds.bottom + 8, window.innerHeight - 240)),
    };
}

export function ReaderView({
                               items,
                               selected,
                               loading,
                               extracting,
                               notes,
                               noteBusy,
                               focusNoteId,
                               archivedItems = [],
                               readLaterView = false,
                               onSelect,
                               onMarkUnread,
                               onOpenOriginal,
                               onRetryExtraction,
                           onSetStarred = async () => undefined,
                           onSetReadLater = async () => undefined,
                           onDoneReadLater = async () => undefined,
                           onEditTags = () => undefined,
                           onOpenArchived = () => undefined,
                           onOpenExternalLink,
                           onCreateNote,
                           onUpdateNote,
                           onDeleteNote,
                           onOpenNotes,
                           onFocusNoteHandled,
                           }: ReaderViewProps) {
    const [expanded, setExpanded] = useState(false);
    const [noteMenu, setNoteMenu] = useState<NoteMenu>();
    const [unresolvedNoteIds, setUnresolvedNoteIds] = useState<Set<string>>(() => new Set());
    const [unsavedWarning, setUnsavedWarning] = useState(false);
    const [popupShaking, setPopupShaking] = useState(false);
    const articleContentRef = useRef<HTMLDivElement>(null);
    const noteMenuRef = useRef<HTMLElement>(null);
    const currentNoteMenu = useRef<NoteMenu | undefined>(undefined);
    const hoverTimer = useRef<number | undefined>(undefined);
    const hoverNoteId = useRef<string | undefined>(undefined);
    const shakeTimer = useRef<number | undefined>(undefined);
    currentNoteMenu.current = noteMenu;
    const safeContent = useMemo(() => {
        const content = selected?.articleContent.readerHtml ?? selected?.feedContentHtml ?? selected?.summary;
        return content && selected ? sanitizeFeedContent(content, selected.id) : '';
    }, [selected]);
    const safeContentMarkup = useMemo(() => ({__html: safeContent}), [safeContent]);
    const selectedIndex = selected ? items.findIndex((item) => item.id === selected.id) : -1;
    const previousItem = selectedIndex > 0 ? items[selectedIndex - 1] : undefined;
    const nextItem = selectedIndex >= 0 ? items[selectedIndex + 1] : undefined;

    function menuHasUnsavedChanges(menu = currentNoteMenu.current): boolean {
        if (!menu) return false;
        if (menu.kind === 'selection') return menu.annotate && menu.draft.length > 0;
        const note = notes.find(({id}) => id === menu.noteId);
        return menu.draft !== (note?.annotationText ?? '');
    }

    function closeNoteMenu(): void {
        setNoteMenu(undefined);
        setUnsavedWarning(false);
        setPopupShaking(false);
    }

    function warnUnsaved(): void {
        setUnsavedWarning(true);
        setPopupShaking(false);
        if (shakeTimer.current !== undefined) window.clearTimeout(shakeTimer.current);
        window.requestAnimationFrame(() => {
            setPopupShaking(true);
            shakeTimer.current = window.setTimeout(() => setPopupShaking(false), 280);
        });
    }

    function requestNoteMenuClose(): void {
        if (menuHasUnsavedChanges()) warnUnsaved();
        else closeNoteMenu();
    }

    function runUnlessUnsaved(action: () => void): void {
        if (menuHasUnsavedChanges()) warnUnsaved();
        else action();
    }

    function cancelHighlightHover(): void {
        if (hoverTimer.current !== undefined) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = undefined;
        }
        hoverNoteId.current = undefined;
    }

    useEffect(() => {
        function handleOutsideMouseDown(event: globalThis.MouseEvent): void {
            const target = event.target;
            if (!currentNoteMenu.current || !(target instanceof Node) || noteMenuRef.current?.contains(target)) return;
            if (menuHasUnsavedChanges()) {
                event.preventDefault();
                event.stopImmediatePropagation();
                warnUnsaved();
            } else closeNoteMenu();
        }
        function handleOutsideClick(event: globalThis.MouseEvent): void {
            const target = event.target;
            if (!menuHasUnsavedChanges() || !(target instanceof Node) || noteMenuRef.current?.contains(target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            warnUnsaved();
        }
        function handleOutsideFocus(event: FocusEvent): void {
            const target = event.target;
            if (!menuHasUnsavedChanges() || !(target instanceof Node) || noteMenuRef.current?.contains(target)) return;
            warnUnsaved();
            noteMenuRef.current?.querySelector<HTMLElement>('textarea, button')?.focus();
        }
        function handleOutsideKeyDown(event: globalThis.KeyboardEvent): void {
            const target = event.target;
            if (!menuHasUnsavedChanges() || !(target instanceof Node) || noteMenuRef.current?.contains(target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            warnUnsaved();
        }
        document.addEventListener('mousedown', handleOutsideMouseDown, true);
        document.addEventListener('click', handleOutsideClick, true);
        document.addEventListener('focusin', handleOutsideFocus, true);
        document.addEventListener('keydown', handleOutsideKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', handleOutsideMouseDown, true);
            document.removeEventListener('click', handleOutsideClick, true);
            document.removeEventListener('focusin', handleOutsideFocus, true);
            document.removeEventListener('keydown', handleOutsideKeyDown, true);
        };
    }, [notes]);

    useEffect(() => () => {
        cancelHighlightHover();
        if (shakeTimer.current !== undefined) window.clearTimeout(shakeTimer.current);
    }, []);

    useEffect(() => {
        const root = articleContentRef.current;
        if (!root) return;
        setUnresolvedNoteIds(applyNoteHighlights(root, notes));
        if (!focusNoteId) return;
        const target = root.querySelector<HTMLElement>(`mark[data-note-id="${focusNoteId}"]`);
        if (target) {
            target.scrollIntoView({block: 'center'});
            target.classList.add('note-focus-pulse');
            window.setTimeout(() => target.classList.remove('note-focus-pulse'), 1600);
        }
        onFocusNoteHandled();
    }, [focusNoteId, notes, onFocusNoteHandled, safeContent]);

    function openHighlightMenu(target: Element): boolean {
        const highlight = target.closest<HTMLElement>('mark[data-note-id]');
        if (highlight?.dataset.noteId) {
            const note = notes.find(({id}) => id === highlight.dataset.noteId);
            if (!note) return false;
            const current = currentNoteMenu.current;
            if (current && menuHasUnsavedChanges(current)
                && !(current.kind === 'existing' && current.noteId === note.id)) return true;
            const bounds = highlight.getBoundingClientRect();
            const position = menuPosition(bounds);
            setUnsavedWarning(false);
            setPopupShaking(false);
            setNoteMenu((current) => current?.kind === 'existing' && current.noteId === note.id
                ? current
                : {kind: 'existing', noteId: note.id, ...position,
                    draft: note.annotationText ?? '', confirmingDelete: false});
            return true;
        }
        return false;
    }

    function openArticleLink(event: MouseEvent<HTMLDivElement>): void {
        const target = event.target;
        if (!(target instanceof Element) || !selected) return;
        cancelHighlightHover();
        if (openHighlightMenu(target)) return;
        const anchor = target.closest('a[data-external-url]');
        const url = anchor?.getAttribute('data-external-url');
        if (!url) return;
        event.preventDefault();
        onOpenExternalLink(selected.id, url);
    }

    function handleHighlightMouseOver(event: MouseEvent<HTMLDivElement>): void {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const highlight = target.closest<HTMLElement>('mark[data-note-id]');
        if (!highlight?.dataset.noteId) return;
        const current = currentNoteMenu.current;
        if (current?.kind === 'existing' && current.noteId === highlight.dataset.noteId) return;
        if (hoverTimer.current !== undefined && hoverNoteId.current === highlight.dataset.noteId) return;
        cancelHighlightHover();
        hoverNoteId.current = highlight.dataset.noteId;
        hoverTimer.current = window.setTimeout(() => {
            hoverTimer.current = undefined;
            hoverNoteId.current = undefined;
            if (!menuHasUnsavedChanges()) openHighlightMenu(highlight);
        }, 200);
    }

    function handleHighlightMouseOut(event: MouseEvent<HTMLDivElement>): void {
        const source = event.target;
        if (!(source instanceof Element)) return;
        const sourceHighlight = source.closest<HTMLElement>('mark[data-note-id]');
        if (!sourceHighlight) return;
        const destination = event.relatedTarget instanceof Element
            ? event.relatedTarget.closest<HTMLElement>('mark[data-note-id]') : undefined;
        if (destination?.dataset.noteId === sourceHighlight.dataset.noteId) return;
        cancelHighlightHover();
    }

    function handleArticleSelection(): void {
        if (menuHasUnsavedChanges()) {
            warnUnsaved();
            return;
        }
        const root = articleContentRef.current;
        const selection = window.getSelection();
        if (!root || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        const anchor = captureTextAnchor(root, range);
        if (!anchor) return;
        const bounds = range.getBoundingClientRect();
        const position = menuPosition(bounds);
        setUnsavedWarning(false);
        setPopupShaking(false);
        setNoteMenu({kind: 'selection', anchor, ...position,
            annotate: false, draft: '', overlaps: noteOverlaps(root, anchor, notes)});
    }

    function handleArticleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches('mark[data-note-id]')) return;
        event.preventDefault();
        target.click();
    }

    async function createNote(annotationText: string | null): Promise<void> {
        if (!selected || noteMenu?.kind !== 'selection' || noteMenu.overlaps) return;
        try {
            await onCreateNote({itemId: selected.id, quoteText: noteMenu.anchor.exact,
                annotationText, anchor: noteMenu.anchor});
            window.getSelection()?.removeAllRanges();
            closeNoteMenu();
        } catch {
            // The application-level error banner reports persistence failures.
        }
    }

    const existingNote = noteMenu?.kind === 'existing'
        ? notes.find(({id}) => id === noteMenu.noteId) : undefined;
    const noteMenuDirty = menuHasUnsavedChanges(noteMenu);

    if (loading) {
        return <div className="empty-state reader-loading">Loading items…</div>;
    }
    if (items.length === 0 && archivedItems.length === 0) {
        return (
            <div className="empty-state reader-loading">
                <span className="empty-icon" aria-hidden="true">⌁</span>
                <h2>No items here</h2>
                <p>Fetch a source to import its current RSS or Atom entries.</p>
            </div>
        );
    }

    return (
        <section className={readerGridClassName(expanded)} aria-label="Feed reader">
            <div className="item-list" aria-label="Items">
                {items.map((item) => (
                    <div className="item-row-shell" key={item.id}>
                        <button className={selected?.id === item.id ? 'item-row selected' : 'item-row'} onClick={() => onSelect(item.id)}>
                            <span className={item.readAt ? 'unread-dot read' : 'unread-dot'}/>
                            <span className="item-row-copy"><strong>{item.title}</strong><span>{item.sourceName}</span><time>{itemDate(item)}</time></span>
                        </button>
                        <div className="item-row-actions" aria-label={`Save actions for ${item.title}`}>
                            <button className={item.starredAt ? 'active' : ''} title={item.starredAt ? 'Unstar' : 'Star'} aria-label={item.starredAt ? `Unstar ${item.title}` : `Star ${item.title}`}
                                    onClick={() => void onSetStarred(item.id, !item.starredAt)}><Star size={14} fill={item.starredAt ? 'currentColor' : 'none'}/></button>
                            <button className={item.readLaterAt ? 'active' : ''} title={item.readLaterAt ? 'Remove from Read Later' : 'Read Later'} aria-label={item.readLaterAt ? `Remove ${item.title} from Read Later` : `Add ${item.title} to Read Later`}
                                    onClick={() => void onSetReadLater(item.id, !item.readLaterAt)}><Clock3 size={14}/></button>
                            <button title="Edit tags" aria-label={`Edit tags for ${item.title}`} onClick={() => onEditTags(item.id)}><Tags size={14}/></button>
                        </div>
                    </div>
                ))}
                {archivedItems.length > 0 && <div className="archived-list-label">Saved from removed sources</div>}
                {archivedItems.map((article) => <button key={article.id} className="item-row archived-item-row" onClick={() => onOpenArchived(article)}>
                    <ExternalLink size={14}/><span className="item-row-copy"><strong>{article.articleTitle}</strong><span>{article.sourceName} · Open in web</span></span>
                </button>)}
            </div>
            <article className="reader-pane">
                <button className="secondary-button reader-expand-button" onClick={() => setExpanded((current) => !current)}
                        aria-label={readerModeLabel(expanded)} title={readerModeLabel(expanded)}>
                    {expanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
                </button>
                {selected ? (
                    <>
                        <header className="article-header">
                            <div className="article-reader-controls" aria-label="Article controls">
                                {selected.readAt && <button className="secondary-button article-read-button"
                                        onClick={() => onMarkUnread(selected.id)}>
                                    Mark unread
                                </button>}
                                <button className={selected.starredAt ? 'secondary-button save-control active' : 'secondary-button save-control'}
                                        onClick={() => void onSetStarred(selected.id, !selected.starredAt)} title={selected.starredAt ? 'Unstar' : 'Star'}>
                                    <Star size={16} fill={selected.starredAt ? 'currentColor' : 'none'}/><span>{selected.starredAt ? 'Starred' : 'Star'}</span>
                                </button>
                                {readLaterView && selected.readLaterAt ? <button className="secondary-button save-control active"
                                        onClick={() => void onDoneReadLater(selected.id)} title="Remove and open the next article">
                                    <CheckCircle2 size={16}/><span>Done</span>
                                </button> : <button className={selected.readLaterAt ? 'secondary-button save-control active' : 'secondary-button save-control'}
                                        onClick={() => void onSetReadLater(selected.id, !selected.readLaterAt)} title={selected.readLaterAt ? 'Remove from Read Later' : 'Read Later'}>
                                    <Clock3 size={16}/><span>{selected.readLaterAt ? 'Read Later' : 'Read Later'}</span>
                                </button>}
                                <button className="secondary-button save-control" onClick={() => onEditTags(selected.id)} title="Edit tags">
                                    <Tags size={16}/><span>Tags</span>
                                </button>
                                <button className="secondary-button article-navigation-button"
                                        disabled={!previousItem} onClick={() => previousItem && onSelect(previousItem.id)}
                                        aria-label="Previous article" title="Previous article">
                                    <ChevronLeft size={17} aria-hidden="true"/>
                                </button>
                                <button className="secondary-button article-navigation-button"
                                        disabled={!nextItem} onClick={() => nextItem && onSelect(nextItem.id)}
                                        aria-label="Next article" title="Next article">
                                    <ChevronRight size={17} aria-hidden="true"/>
                                </button>
                            </div>
                            <p className="eyebrow">{selected.sourceName}</p>
                            <h2><button className="article-title-link" disabled={!selected.canonicalUrl}
                                        onClick={() => onOpenOriginal(selected.id)}
                                        aria-label={`${selected.title} — Open in web`}
                                        title="Open in web" data-tooltip="Open in web">{selected.title}</button></h2>
                            <p className="article-meta">
                                {selected.author ? `By ${selected.author} · ` : ''}
                                {itemDate(selected)}
                            </p>
                            {(selected.tags?.length ?? 0) > 0 && <div className="article-tags" aria-label="Article tags">
                                {selected.tags!.map((tag) => <button key={tag.id} onClick={() => onEditTags(selected.id)}>{tag.name}</button>)}
                            </div>}
                        </header>
                        {unresolvedNoteIds.size > 0 && <div className="article-status warning-status" role="status">
                            <div><strong>{unresolvedNoteIds.size} saved {unresolvedNoteIds.size === 1 ? 'highlight' : 'highlights'} could not be located</strong>
                                <span>The saved quotation remains available in Notes.</span></div>
                            <button className="text-button" onClick={() => {
                                const first = unresolvedNoteIds.values().next().value;
                                if (first) onOpenNotes(first);
                            }}><NotebookText size={14}/>Open Notes</button>
                        </div>}
                        {(extracting || selected.articleContent.status === 'fetching') && (
                            <div className="article-status loading-status" aria-live="polite">
                                <span className="status-spinner" aria-hidden="true"/>
                                <div><strong>Loading full article and images…</strong><span>The feed summary remains available while the page is processed.</span>
                                </div>
                            </div>
                        )}
                        {selected.articleContent.status === 'complete' && !extracting && (
                            <div className="article-status success-status">Full article · cached locally</div>
                        )}
                        {['partial', 'failed'].includes(selected.articleContent.status) && !extracting && (
                            <div className="article-status warning-status" role="status">
                                <div><strong>Showing feed
                                    content</strong><span>{selected.articleContent.extractionError ?? 'The full article could not be extracted.'}</span>
                                </div>
                                <button className="text-button" onClick={() => onRetryExtraction(selected.id)}>Retry
                                </button>
                            </div>
                        )}
                        {safeContent ? (
                            <div
                                className="article-content"
                                ref={articleContentRef}
                                onClick={openArticleLink}
                                onMouseOver={handleHighlightMouseOver}
                                onMouseOut={handleHighlightMouseOut}
                                onFocus={(event) => {
                                    cancelHighlightHover();
                                    if (event.target instanceof Element) openHighlightMenu(event.target);
                                }}
                                onMouseUp={handleArticleSelection}
                                onKeyUp={(event) => event.shiftKey && handleArticleSelection()}
                                onKeyDown={handleArticleKeyDown}
                                dangerouslySetInnerHTML={safeContentMarkup}
                            />
                        ) : (
                            <div className="article-empty">
                                This feed entry does not include readable content.
                            </div>
                        )}
                    </>
                ) : (
                    <div className="article-empty">Select an item to read it.</div>
                )}
            </article>
            {noteMenuDirty && <div className="note-interaction-lock" aria-hidden="true"/>}
            {noteMenu && <section ref={noteMenuRef} className={`note-context-menu${popupShaking ? ' shaking' : ''}`} role="dialog" aria-modal={noteMenuDirty || undefined} aria-label={noteMenu.kind === 'selection' ? 'Create note' : 'Edit note'}
                                  onKeyDown={(event) => { if (event.key === 'Escape') requestNoteMenuClose(); }}
                                  style={{left: noteMenu.x, top: noteMenu.y}}>
                <button className="note-menu-close" onClick={closeNoteMenu} aria-label="Discard changes and close note menu"><X size={15}/></button>
                {noteMenu.kind === 'selection' ? noteMenu.annotate ? <>
                    <div className="note-editor-label"><label htmlFor="new-annotation">Annotation</label>
                        {unsavedWarning && <span>Not saved!</span>}</div>
                    <textarea id="new-annotation" autoFocus value={noteMenu.draft} maxLength={10_000}
                              onChange={(event) => setNoteMenu({...noteMenu, draft: event.target.value})}
                              placeholder="Write a note…"/>
                    <div className="note-menu-actions">
                        <button className="secondary-button" onClick={() => {setUnsavedWarning(false); setNoteMenu({...noteMenu, annotate: false, draft: ''});}}>Cancel</button>
                        <button className="primary-button" disabled={noteBusy || !noteMenu.draft.trim()}
                                onClick={() => void createNote(noteMenu.draft.trim())}><Save size={15}/>Save</button>
                    </div>
                </> : <>
                    {noteMenu.overlaps && <p className="note-menu-warning">Highlights cannot overlap an existing highlight.</p>}
                    <div className="note-selection-actions">
                        <button disabled={noteMenu.overlaps || noteBusy} onClick={() => void createNote(null)}>
                            <Highlighter size={17}/><span>Highlight</span>
                        </button>
                        <button disabled={noteMenu.overlaps || noteBusy} onClick={() => setNoteMenu({...noteMenu, annotate: true})}>
                            <MessageSquareText size={17}/><span>Annotate</span>
                        </button>
                    </div>
                </> : existingNote ? <>
                    <blockquote>{existingNote.quoteText}</blockquote>
                    <div className="note-editor-label"><label htmlFor="edit-annotation">Annotation</label>
                        {unsavedWarning && <span>Not saved!</span>}</div>
                    <textarea id="edit-annotation" value={noteMenu.draft} maxLength={10_000}
                              onChange={(event) => setNoteMenu({...noteMenu, draft: event.target.value})}
                              placeholder="Add a note…"/>
                    <div className="note-menu-actions wrap">
                        <button className="secondary-button" disabled={noteBusy}
                                onClick={() => runUnlessUnsaved(() => onOpenNotes(existingNote.id))}><NotebookText size={15}/>Notes</button>
                        <button className="secondary-button" disabled={noteBusy}
                                onClick={() => void onUpdateNote(existingNote.id, noteMenu.draft.trim() || null).then(closeNoteMenu).catch(() => undefined)}>
                            <Save size={15}/>Save
                        </button>
                        {existingNote.annotationText && <button className="secondary-button" disabled={noteBusy}
                                onClick={() => runUnlessUnsaved(() => void onUpdateNote(existingNote.id, null).then(closeNoteMenu).catch(() => undefined))}>
                            <MessageSquareOff size={15}/>Remove note
                        </button>}
                        {noteMenu.confirmingDelete ? <button className="primary-button" disabled={noteBusy}
                                onClick={() => void onDeleteNote(existingNote.id).then(closeNoteMenu).catch(() => undefined)}>Confirm delete</button>
                            : <button className="text-button danger" disabled={noteBusy}
                                      onClick={() => runUnlessUnsaved(() => existingNote.annotationText
                                          ? setNoteMenu({...noteMenu, confirmingDelete: true})
                                          : void onDeleteNote(existingNote.id).then(closeNoteMenu).catch(() => undefined))}>
                                <Trash2 size={15}/>Delete
                            </button>}
                    </div>
                </> : null}
            </section>}
        </section>
    );
}
