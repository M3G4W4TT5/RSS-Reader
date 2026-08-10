import {useMemo, useState, type MouseEvent} from 'react';
import {Maximize2, Minimize2} from 'lucide-react';
import type {ItemDetail, ItemSummary} from '@rss-reader/contracts';
import {sanitizeFeedContent} from './sanitize-feed-content';
import {readerGridClassName, readerModeLabel} from './reader-mode';

interface ReaderViewProps {
    items: ItemSummary[];
    selected?: ItemDetail;
    loading: boolean;
    extracting: boolean;

    onSelect(id: string): void;

    onSetRead(id: string, read: boolean): void;

    onOpenOriginal(id: string): void;

    onRetryExtraction(id: string): void;

    onOpenExternalLink(itemId: string, url: string): void;
}

function itemDate(item: ItemSummary): string {
    return new Date(item.publishedAt ?? item.firstSeenAt).toLocaleString();
}

export function ReaderView({
                               items,
                               selected,
                               loading,
                               extracting,
                               onSelect,
                               onSetRead,
                               onOpenOriginal,
                               onRetryExtraction,
                           onOpenExternalLink,
                           }: ReaderViewProps) {
    const [expanded, setExpanded] = useState(false);
    const safeContent = useMemo(() => {
        const content = selected?.articleContent.readerHtml ?? selected?.feedContentHtml ?? selected?.summary;
        return content && selected ? sanitizeFeedContent(content, selected.id) : '';
    }, [selected]);

    function openArticleLink(event: MouseEvent<HTMLDivElement>): void {
        const target = event.target;
        if (!(target instanceof Element) || !selected) return;
        const anchor = target.closest('a[data-external-url]');
        const url = anchor?.getAttribute('data-external-url');
        if (!url) return;
        event.preventDefault();
        onOpenExternalLink(selected.id, url);
    }

    if (loading) {
        return <div className="empty-state reader-loading">Loading items…</div>;
    }
    if (items.length === 0) {
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
                    <button
                        key={item.id}
                        className={selected?.id === item.id ? 'item-row selected' : 'item-row'}
                        onClick={() => onSelect(item.id)}
                    >
                        <span className={item.readAt ? 'unread-dot read' : 'unread-dot'}/>
                        <span className="item-row-copy">
              <strong>{item.title}</strong>
              <span>{item.sourceName}</span>
              <time>{itemDate(item)}</time>
            </span>
                    </button>
                ))}
            </div>
            <article className="reader-pane">
                <button className="secondary-button reader-expand-button" onClick={() => setExpanded((current) => !current)}
                        aria-label={readerModeLabel(expanded)} title={readerModeLabel(expanded)}>
                    {expanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
                </button>
                {selected ? (
                    <>
                        <header className="article-header">
                            <p className="eyebrow">{selected.sourceName}</p>
                            <h2>{selected.title}</h2>
                            <p className="article-meta">
                                {selected.author ? `By ${selected.author} · ` : ''}
                                {itemDate(selected)}
                            </p>
                            <div className="article-actions">
                                <button
                                    className="secondary-button"
                                    onClick={() => onSetRead(selected.id, !selected.readAt)}
                                >
                                    Mark {selected.readAt ? 'unread' : 'read'}
                                </button>
                                <button
                                    className="primary-button"
                                    disabled={!selected.canonicalUrl}
                                    onClick={() => onOpenOriginal(selected.id)}
                                >
                                    Open original
                                </button>
                            </div>
                        </header>
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
                                onClick={openArticleLink}
                                dangerouslySetInnerHTML={{__html: safeContent}}
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
        </section>
    );
}
