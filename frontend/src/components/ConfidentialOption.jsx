import { FiLock } from 'react-icons/fi';

/** Case « demande confidentielle » des formulaires de création. */
export default function ConfidentialOption({ checked, onChange }) {
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-line bg-paper px-4 py-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="flex items-center gap-1.5 font-semibold">
          <FiLock aria-hidden="true" /> Demande confidentielle
        </span>
        <span className="block text-ink-mute">
          Seuls vous, la personne qui s'en occupe et son groupe la verront, pas les autres administrateurs. Pour les sujets
          personnels : impôts, santé, argent, carrière.
        </span>
      </span>
    </label>
  );
}
