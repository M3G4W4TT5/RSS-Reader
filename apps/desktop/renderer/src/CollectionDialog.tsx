import {useMemo, useState, type FormEvent} from 'react';
import type {
  Collection,
  CreateCollectionInput,
  Source,
  UpdateCollectionRequest,
} from '@rss-reader/contracts';
import {Modal} from './Modal';
import {SourcePickerDialog} from './SourcePickerDialog';
import {CollectionIconGlyph, collectionIconOptions} from './collection-icons';

interface CollectionDialogProps {
  collection?: Collection;
  sources: Source[];
  busy: boolean;
  onCancel(): void;
  onCreate(input: CreateCollectionInput): Promise<void>;
  onUpdate(request: UpdateCollectionRequest): Promise<void>;
}

export function CollectionDialog({
  collection,
  sources,
  busy,
  onCancel,
  onCreate,
  onUpdate,
}: CollectionDialogProps) {
  const [name, setName] = useState(collection?.name ?? '');
  const [icon, setIcon] = useState(collection?.icon ?? 'folder');
  const [initialSourceIds] = useState<Set<string>>(() => new Set(
    collection
      ? sources.filter((source) => source.collectionIds.includes(collection.id)).map((source) => source.id)
      : [],
  ));
  const [sourceIds, setSourceIds] = useState<Set<string>>(() => new Set(initialSourceIds));
  const [pickerOpen, setPickerOpen] = useState(false);
  const collectionSources = useMemo(
    () => sources.filter((source) => initialSourceIds.has(source.id) || sourceIds.has(source.id)),
    [initialSourceIds, sourceIds, sources],
  );
  const pickerExistingSourceIds = useMemo(
    () => new Set([...initialSourceIds, ...sourceIds]),
    [initialSourceIds, sourceIds],
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (collection) {
      await onUpdate({id: collection.id, input: {name, icon, sourceIds: [...sourceIds]}});
    } else {
      await onCreate({name, icon});
    }
  }

  function removeSource(sourceId: string): void {
    setSourceIds((current) => {
      const next = new Set(current);
      next.delete(sourceId);
      return next;
    });
  }

  function restoreSource(sourceId: string): void {
    setSourceIds((current) => new Set([...current, sourceId]));
  }

  function addSources(addedSourceIds: string[]): void {
    setSourceIds((current) => new Set([...current, ...addedSourceIds]));
    setPickerOpen(false);
  }

  return (
    <>
      <Modal
        title={collection ? 'Edit collection' : 'Create collection'}
        description="Collections organise sources without duplicating or deleting them."
        onCancel={onCancel}
        className={collection ? 'collection-editor-modal' : undefined}
      >
        <form onSubmit={submit}>
          <section className="collection-editor-section">
            {collection && <h3>Rename collection</h3>}
            <label className="field">
              <span>Collection name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="AI, Development, Design…"
                required
                maxLength={200}
                autoFocus
              />
            </label>
            <fieldset className="icon-picker">
              <legend>Collection icon</legend>
              <div className="icon-picker-grid">
                {collectionIconOptions.map((option) => (
                  <label className={icon === option.key ? 'selected' : ''} key={option.key} title={option.label}>
                    <input type="radio" name="collection-icon" value={option.key}
                           checked={icon === option.key} onChange={() => setIcon(option.key)}/>
                    <CollectionIconGlyph icon={option.key}/><span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          {collection && (
            <section className="collection-editor-section membership-section">
              <div className="membership-heading">
                <div>
                  <h3>Sources</h3>
                  <p>{sourceIds.size} source{sourceIds.size === 1 ? '' : 's'} after saving</p>
                </div>
                <button
                  type="button"
                  className="secondary-button add-source-button"
                  onClick={() => setPickerOpen(true)}
                  aria-label="Add sources"
                >
                  <span aria-hidden="true">＋</span> Add sources
                </button>
              </div>

              <div className="membership-list" aria-label="Sources in collection">
                {collectionSources.length === 0 && (
                  <p className="membership-empty">This collection has no sources.</p>
                )}
                {collectionSources.map((source) => {
                  const stagedForRemoval = initialSourceIds.has(source.id) && !sourceIds.has(source.id);
                  return (
                  <div
                    className={`membership-row${stagedForRemoval ? ' staged-removal' : ''}`}
                    key={source.id}
                    onClick={stagedForRemoval ? () => restoreSource(source.id) : undefined}
                    onKeyDown={stagedForRemoval ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        restoreSource(source.id);
                      }
                    } : undefined}
                    role={stagedForRemoval ? 'button' : undefined}
                    tabIndex={stagedForRemoval ? 0 : undefined}
                    aria-label={stagedForRemoval ? `Cancel removal of ${source.name}` : undefined}
                  >
                    <span>
                      <strong>{source.name}</strong>
                      <small>{source.feedUrl}</small>
                    </span>
                    {stagedForRemoval ? (
                      <span className="staged-removal-status">Pending removal</span>
                    ) : <button
                      type="button"
                      className="remove-membership-button"
                      onClick={() => removeSource(source.id)}
                      aria-label={`Remove ${source.name} from collection`}
                      title="Remove from collection"
                    >×</button>}
                  </div>
                );})}
              </div>
            </section>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Saving…' : collection ? 'Save changes' : 'Create collection'}
            </button>
          </div>
        </form>
      </Modal>

      {pickerOpen && (
        <SourcePickerDialog
          sources={sources}
          existingSourceIds={pickerExistingSourceIds}
          onCancel={() => setPickerOpen(false)}
          onConfirm={addSources}
        />
      )}
    </>
  );
}
