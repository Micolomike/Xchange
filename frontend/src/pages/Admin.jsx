import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import UsersPanel from './admin/UsersPanel';
import TrashPanel from './admin/TrashPanel';
import BackupPanel from './admin/BackupPanel';
import GroupsPanel from './admin/GroupsPanel';
import CatalogPanel from './admin/CatalogPanel';
import SettingsPanel from './admin/SettingsPanel';

const TABS = [
  { value: 'users', label: 'Utilisateurs' },
  { value: 'groups', label: 'Groupes' },
  { value: 'catalog', label: 'Catalogue' },
  { value: 'trash', label: 'Corbeille' },
  { value: 'backup', label: 'Sauvegardes' },
  { value: 'settings', label: 'Paramètres' },
];
const PANELS = { users: UsersPanel, groups: GroupsPanel, catalog: CatalogPanel, trash: TrashPanel, backup: BackupPanel, settings: SettingsPanel };

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = PANELS[params.get('tab')] ? params.get('tab') : 'users';
  const Panel = PANELS[tab];

  return (
    <div>
      <PageHeader title="Administration">Comptes, groupes, catalogue, corbeille, sauvegardes et paramètres.</PageHeader>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Sections d'administration">
        {TABS.map((t) => (
          <button
            key={t.value}
            id={`tab-${t.value}`}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            aria-controls={`panel-${t.value}`}
            onClick={() => setParams(t.value === 'users' ? {} : { tab: t.value }, { replace: true })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.value ? 'border-accent text-accent-strong' : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <Panel />
      </div>
    </div>
  );
}
