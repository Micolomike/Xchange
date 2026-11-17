import { useId, useState } from 'react';
import { FiFile, FiUploadCloud, FiX } from 'react-icons/fi';
import { MAX_FILES, MAX_UPLOAD_MB } from '../lib/constants';
import { formatSize } from '../lib/format';

const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|js|jar|sh|dll|html?|svg)$/i;

/** Zone de dépôt de fichiers (clic ou glisser-déposer) avec contrôle de taille et de type. */
export default function FileDrop({ files, onChange, max = MAX_FILES, compact = false }) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);

  const addFiles = (list) => {
    setError(null);
    const incoming = Array.from(list);
    const rejected = [];
    const accepted = [];
    for (const f of incoming) {
      if (BLOCKED.test(f.name)) rejected.push(`${f.name} : type refusé`);
      else if (f.size > MAX_UPLOAD_MB * 1024 * 1024) rejected.push(`${f.name} : plus de ${MAX_UPLOAD_MB} Mo`);
      else accepted.push(f);
    }
    const next = [...files, ...accepted].slice(0, max);
    if (files.length + accepted.length > max) rejected.push(`${max} fichiers maximum`);
    if (rejected.length) setError(rejected.join(' ; '));
    onChange(next);
  };

  return (
    <div>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center text-sm transition-colors ${
          compact ? 'py-3' : 'py-6'
        } ${dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:border-accent'}`}
      >
        <FiUploadCloud className="text-xl text-ink-mute" aria-hidden="true" />
        <span>
          <span className="font-semibold text-accent-strong">Choisir des fichiers</span> ou les glisser ici
        </span>
        <span className="text-xs text-ink-mute">
          {max} fichiers maximum, {MAX_UPLOAD_MB} Mo chacun
        </span>
      </label>
      <input
        id={id}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-paper px-3 py-1.5 text-sm">
              <FiFile className="shrink-0 text-ink-mute" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-ink-mute">{formatSize(f.size)}</span>
              <button
                type="button"
                className="rounded p-1 text-ink-mute hover:bg-surface hover:text-danger"
                aria-label={`Retirer ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <FiX aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
