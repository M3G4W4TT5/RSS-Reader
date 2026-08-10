import { useState, type FormEvent } from 'react';
import type {
  Collection,
  CreateSourceInput,
  Source,
  UpdateSourceRequest,
} from '@rss-reader/contracts';
import { Modal } from './Modal';

interface SourceDialogProps {
  source?: Source;
  collections: Collection[];
  busy: boolean;
  onCancel(): void;
  onCreate(input: CreateSourceInput): Promise<void>;
  onUpdate(request: UpdateSourceRequest): Promise<void>;
}

export function SourceDialog({
  source,
  collections,
  busy,
  onCancel,
  onCreate,
  onUpdate,
}: SourceDialogProps) {
  const [name, setName] = useState(source?.name ?? '');
  const [feedUrl, setFeedUrl] = useState(source?.feedUrl ?? '');
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    source?.collectionIds ?? [],
  );

  function toggleCollection(id: string): void {
    setCollectionIds((current) =>
      current.includes(id)
        ? current.filter((collectionId) => collectionId !== id)
        : [...current, id],
    );
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (source) {
      await onUpdate({
        id: source.id,
        input: { name, feedUrl, enabled, collectionIds },
      });
    } else {
      await onCreate({ feedUrl, collectionIds });
    }
  }

  return (
    <Modal
      title={source ? 'Edit source' : 'Add source'}
      description={
        source
          ? 'Change its display details, availability, or collection membership.'
          : 'Add a website or feed URL. A source is saved only after a usable RSS or Atom feed is confirmed.'
      }
      onCancel={onCancel}
    >
      <form onSubmit={submit}>
        {source && (
          <label className="field">
            <span>Display name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} autoFocus />
          </label>
        )}
        <label className="field">
          <span>Website or feed URL</span>
          <input
            type="url"
            value={feedUrl}
            onChange={(event) => setFeedUrl(event.target.value)}
            placeholder="https://example.com"
            required
            autoFocus={!source}
          />
        </label>

        <fieldset className="collection-picker">
          <legend>Collections <span>Optional</span></legend>
          {collections.length === 0 ? (
            <p>No collections exist yet. You can assign this source later.</p>
          ) : (
            <div className="checkbox-grid">
              {collections.map((collection) => (
                <label key={collection.id}>
                  <input
                    type="checkbox"
                    checked={collectionIds.includes(collection.id)}
                    onChange={() => toggleCollection(collection.id)}
                  />
                  <span>{collection.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {source && (
          <label className="switch-row">
            <div>
              <strong>Source enabled</strong>
              <span>Disabled sources remain available but are skipped when sources update.</span>
            </div>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : source ? 'Save changes' : 'Add source'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
