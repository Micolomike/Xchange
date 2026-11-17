import { useSearchParams } from 'react-router-dom';
import CatalogPanel from './CatalogPanel';
import TicketFieldsPanel from './TicketFieldsPanel';
import VariablesPanel from './VariablesPanel';

const SECTIONS = [
  { value: 'forms', label: 'Formulaires', hint: 'Les record producers du catalogue' },
  { value: 'fields', label: 'Table des champs', hint: 'Champs de la table des demandes' },
  { value: 'variables', label: 'Table des variables', hint: 'Questions de tous les formulaires' },
];
const PANELS = { forms: CatalogPanel, fields: TicketFieldsPanel, variables: VariablesPanel };

/**
 * Module « Record producers » : les formulaires du catalogue (chacun crée une demande), le dictionnaire de la
 * table des demandes (champs système et personnalisés) et la table des variables.
 */
export default function ProducersPanel() {
  const [params, setParams] = useSearchParams();
  const section = PANELS[params.get('section')] ? params.get('section') : 'forms';
  const Panel = PANELS[section];
  return (
    <div className="space-y-4">
      <nav aria-label="Record producers" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-current={section === s.value ? 'page' : undefined}
            title={s.hint}
            onClick={() => setParams(s.value === 'forms' ? { tab: 'catalog' } : { tab: 'catalog', section: s.value }, { replace: true })}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
              section === s.value ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <Panel />
    </div>
  );
}
