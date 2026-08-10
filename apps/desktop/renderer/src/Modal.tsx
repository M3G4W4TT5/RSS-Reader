import {useId, type ReactNode} from 'react';

interface ModalProps {
  title: string;
  description: string;
  children: ReactNode;
  onCancel(): void;
  className?: string;
}

export function Modal({ title, description, children, onCancel, className }: ModalProps) {
  const titleId = useId();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className={['modal', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="close-button" onClick={onCancel} aria-label="Close">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
