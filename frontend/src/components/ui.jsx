import { FiAlertTriangle, FiLoader } from 'react-icons/fi';

export function Spinner({ label = 'Chargement…', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 py-16 text-ink-mute ${className}`}>
      <FiLoader className="animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="panel mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-10 text-center">
      <FiAlertTriangle className="text-2xl text-danger" aria-hidden="true" />
      <p className="text-ink-soft">{error?.message || String(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink-mute">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Champ de formulaire avec libellé, aide et message d'erreur reliés pour les lecteurs d'écran. */
export function Field({ id, label, required, hint, error, children }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy, required })}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-mute">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function PageHeader({ title, children, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {children && <p className="mt-1 text-ink-mute">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
