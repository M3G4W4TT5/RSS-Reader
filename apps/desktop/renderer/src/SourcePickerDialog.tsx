import {useMemo, useState} from 'react';
import type {Source} from '@rss-reader/contracts';
import {filterSources} from './collection-membership';
import {Modal} from './Modal';

interface SourcePickerDialogProps {
  sources: Source[];
  existingSourceIds: Set<string>;
  onCancel(): void;
  onConfirm(sourceIds: string[]): void;
}

export function SourcePickerDialog({
  sources,
  existingSourceIds,
  onCancel,
  onConfirm,
}: SourcePickerDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const visibleSources = useMemo(() => filterSources(sources, query), [sources, query]);

  function toggleSource(sourceId: string): void {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  return (
    <Modal
      title="Add sources"
      description="Search by source name or feed URL, then select one or more sources."
      onCancel={onCancel}
      className="source-picker-modal"
    >
      <label className="field source-search-field">
        <span>Search sources</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or feed URL"
          autoFocus
        />
      </label>

      <div className="source-picker-list" aria-label="Available sources">
        {visibleSources.length === 0 && (
          <p className="membership-empty">No sources match this search.</p>
        )}
        {visibleSources.map((source) => {
          const existing = existingSourceIds.has(source.id);
          const selected = selectedSourceIds.has(source.id);
          return (
            <label
              key={source.id}
              className={`source-picker-row${existing ? ' existing' : ''}`}
              aria-disabled={existing}
            >
              <input
                type="checkbox"
                checked={existing || selected}
                disabled={existing}
                onChange={() => toggleSource(source.id)}
              />
              <span>
                <strong>{source.name}</strong>
                <small>{source.feedUrl}</small>
              </span>
              {existing && <em>Already added</em>}
            </label>
          );
        })}
      </div>

      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={selectedSourceIds.size === 0}
          onClick={() => onConfirm([...selectedSourceIds])}
        >
          Add {selectedSourceIds.size || ''} source{selectedSourceIds.size === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}
