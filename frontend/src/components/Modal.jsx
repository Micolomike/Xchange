import { useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';

/** Fenêtre modale native (<dialog>) : Échap, fond grisé et piège du focus gérés par le navigateur. */
export default function Modal({ open, onClose, title, children, footer, labelId, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = size === 'lg' ? 'w-[min(980px,calc(100vw-2rem))]' : size === 'sm' ? 'w-[min(420px,calc(100vw-2rem))]' : 'w-[min(600px,calc(100vw-2rem))]';
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={labelId}
      className={`m-auto max-h-[calc(100dvh-2rem)] ${width} rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/50`}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id={labelId} className="font-bold">
              {title}
            </h2>
            <button type="button" className="btn btn-ghost px-2" onClick={onClose} aria-label="Fermer">
              <FiX aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
