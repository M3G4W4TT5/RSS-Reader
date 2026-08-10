import {useState, type FormEvent} from 'react';
import type {ApplicationSettings, UpdateApplicationSettings} from '@rss-reader/contracts';
import {Modal} from './Modal';

interface SettingsDialogProps {
  settings: ApplicationSettings;
  busy: boolean;
  onCancel(): void;
  onSave(input: UpdateApplicationSettings): Promise<void>;
}

export function SettingsDialog({settings, busy, onCancel, onSave}: SettingsDialogProps) {
  const [initialArticleLimit, setInitialArticleLimit] = useState(
    String(settings.initialArticleLimit),
  );
  const parsedLimit = Number(initialArticleLimit);
  const valid = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 500;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (valid) await onSave({initialArticleLimit: parsedLimit});
  }

  return (
    <Modal
      title="Settings"
      description="Configure how new subscriptions are imported and fetched."
      onCancel={onCancel}
      className="settings-modal"
    >
      <form onSubmit={submit}>
        <section className="settings-section">
          <h3>Import and fetch</h3>
          <label className="field">
            <span>Import article limit</span>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              value={initialArticleLimit}
              onChange={(event) => setInitialArticleLimit(event.target.value)}
              required
              autoFocus
            />
          </label>
          <p className="field-help">
            Maximum articles imported when a source is first added or changed to a new feed.
            Older entries are ignored on later refreshes. Existing articles are not affected.
          </p>
        </section>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
