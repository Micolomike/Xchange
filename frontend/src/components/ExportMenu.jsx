import { useEffect, useId, useRef, useState } from 'react';
import { FiChevronDown, FiDownload } from 'react-icons/fi';

const FORMATS = [
  { value: 'xlsx', label: 'Excel (.xlsx)', hint: 'Classeur, dates et nombres reconnus' },
  { value: 'csv', label: 'CSV (.csv)', hint: 'Texte séparé par des points-virgules' },
  { value: 'json', label: 'JSON (.json)', hint: 'Pour un autre logiciel ou un script' },
];

/** Bouton « Exporter » qui propose Excel, CSV et JSON. */
export default function ExportMenu({ onExport, label = 'Exporter', className = 'btn btn-secondary', busy = false, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(null);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = async (format) => {
    setOpen(false);
    setRunning(format);
    try {
      await onExport(format);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" className={className} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} disabled={busy || Boolean(running)}>
        <FiDownload aria-hidden="true" /> {running ? 'Préparation…' : label} <FiChevronDown aria-hidden="true" className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <ul
          id={id}
          className={`absolute z-30 mt-1 w-64 overflow-hidden rounded-md border border-line bg-surface py-1 text-left shadow-lg ${align === 'left' ? 'left-0' : 'right-0'}`}
        >
          {FORMATS.map((f) => (
            <li key={f.value}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-paper focus-visible:bg-paper" onClick={() => choose(f.value)}>
                <span className="block text-sm font-semibold text-ink">{f.label}</span>
                <span className="block text-xs text-ink-mute">{f.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
