import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import UsersPanel from './admin/UsersPanel';
import TrashPanel from './admin/TrashPanel';

const TABS = [
  { value: 'users', label: 'Utilisateurs' },
  { value: 'trash', label: 'Corbeille' },
];

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'trash' ? 'trash' : 'users';

  return (
    <div>
      <PageHeader title="Administration">Comptes de l'équipe et tickets supprimés.</PageHeader>
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Sections d'administration">
        {TABS.map((t) => (
          <button
            key={t.value}
            id={`tab-${t.value}`}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            aria-controls={`panel-${t.value}`}
            onClick={() => setParams(t.value === 'users' ? {} : { tab: t.value }, { replace: true })}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.value ? 'border-accent text-accent-strong' : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'users' ? <UsersPanel /> : <TrashPanel />}
      </div>
    </div>
  );
}
