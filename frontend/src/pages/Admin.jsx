import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { FiBookOpen } from 'react-icons/fi';
import { PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { toastError } from '../lib/notify';
import UsersPanel from './admin/UsersPanel';
import TrashPanel from './admin/TrashPanel';
import BackupPanel from './admin/BackupPanel';
import GroupsPanel from './admin/GroupsPanel';
import ProducersPanel from './admin/ProducersPanel';
import SettingsPanel from './admin/SettingsPanel';
import ChatReportsPanel from './admin/ChatReportsPanel';
import SlaPanel from './admin/SlaPanel';
import SystemLogPanel from './admin/SystemLogPanel';

const TABS = [
  { value: 'users', label: 'Utilisateurs' },
  { value: 'groups', label: 'Groupes' },
  { value: 'catalog', label: 'Record producers' },
  { value: 'sla', label: 'SLA' },
  { value: 'chat', label: 'Signalements' },
  { value: 'trash', label: 'Corbeille' },
  { value: 'backup', label: 'Sauvegardes' },
  { value: 'settings', label: 'Paramètres' },
  { value: 'log', label: 'Journal système' },
];
const PANELS = { users: UsersPanel, groups: GroupsPanel, catalog: ProducersPanel, sla: SlaPanel, log: SystemLogPanel, chat: ChatReportsPanel, trash: TrashPanel, backup: BackupPanel, settings: SettingsPanel };

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = PANELS[params.get('tab')] ? params.get('tab') : 'users';
  const Panel = PANELS[tab];
  const [guideBusy, setGuideBusy] = useState(false);

  // Le guide est protégé : on le télécharge avec la session, puis on l'ouvre dans un nouvel onglet.
  const openGuide = async () => {
    const win = window.open('', '_blank');
    setGuideBusy(true);
    try {
      const res = await api('/api/admin/guide.pdf', { raw: true });
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Xchange-guide-administrateur.pdf';
        document.body.append(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      toastError(err);
    } finally {
      setGuideBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Administration"
        actions={
          <button type="button" className="btn btn-secondary" onClick={openGuide} disabled={guideBusy}>
            <FiBookOpen aria-hidden="true" /> {guideBusy ? 'Ouverture…' : 'Guide administrateur (PDF)'}
          </button>
        }
      >
        Comptes, groupes, catalogue, délais (SLA), signalements, corbeille, sauvegardes, paramètres et journal système.
      </PageHeader>
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
