import { PageHeader } from '../../components/ui';
import { AnalyticsTabs } from '../../analytics/common';
import DashboardView from './DashboardView';

/** Tableau de bord des délais (SLA), prêt à l'emploi, calculé avec les droits de chacun. */
export default function SlaDashboard() {
  return (
    <div>
      <PageHeader title="Analyses">Respect des délais de prise en charge et de résolution, sur les demandes que vous pouvez voir.</PageHeader>
      <AnalyticsTabs />
      <DashboardView templateKey="sla" />
    </div>
  );
}
