import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft, FiSave } from 'react-icons/fi';
import { api } from '../../lib/api';
import { toast, toastError } from '../../lib/notify';
import { ErrorState, PageHeader, Spinner } from '../../components/ui';
import { useMeta } from '../../analytics/useMeta';
import { SharingFields, TextField } from '../../analytics/common';
import { defaultDefinition } from '../../analytics/labels';
import DefinitionEditor from '../../analytics/DefinitionEditor';

/** Création et modification d'un rapport, avec aperçu en direct. */
export default function ReportEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meta, error: metaError } = useMeta();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!meta) return;
    if (!id) {
      setForm({ name: '', description: '', definition: defaultDefinition('summary', meta), visibility: 'private', groups: [] });
      return;
    }
    api(`/api/analytics/reports/${id}`)
      .then(({ report }) => {
        if (!report.mine) throw new Error('Seule la personne qui a créé ce rapport peut le modifier. Vous pouvez en faire une copie.');
        setForm({ name: report.name, description: report.description, definition: report.definition, visibility: report.visibility, groups: report.groups.map((g) => g.id) });
      })
      .catch(setError);
  }, [id, meta]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { report } = await api(id ? `/api/analytics/reports/${id}` : '/api/analytics/reports', { method: id ? 'PUT' : 'POST', body: form });
      toast(id ? 'Rapport enregistré' : 'Rapport créé');
      navigate(`/analyses/rapports/${report.id}`);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  if (metaError || error) return <ErrorState error={metaError || error} />;
  if (!meta || !form) return <Spinner />;

  return (
    <form onSubmit={save}>
      <Link to={id ? `/analyses/rapports/${id}` : '/analyses/rapports'} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
        <FiArrowLeft aria-hidden="true" /> {id ? 'Retour au rapport' : 'Rapports'}
      </Link>
      <PageHeader
        title={id ? 'Modifier le rapport' : 'Nouveau rapport'}
        actions={
          <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
            <FiSave aria-hidden="true" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        }
      >
        Les résultats sont calculés avec les droits de la personne qui regarde : chacun ne voit que les demandes qu’il peut déjà voir.
      </PageHeader>
      <div className="panel mb-6 grid gap-4 p-5 lg:grid-cols-2">
        <TextField id="rep-name" label="Nom" required max={100} value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <TextField id="rep-desc" label="Description (facultative)" max={500} value={form.description} onChange={(description) => setForm({ ...form, description })} />
        <div className="lg:col-span-2">
          <SharingFields meta={meta} value={form} onChange={(v) => setForm({ ...form, visibility: v.visibility, groups: v.groups })} />
        </div>
      </div>
      <DefinitionEditor meta={meta} value={form.definition} onChange={(definition) => setForm({ ...form, definition })} idPrefix="rep" previewHeight={380} />
    </form>
  );
}
