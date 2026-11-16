import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { api } from '../lib/api';
import { toast, toastError } from '../lib/notify';
import FormRenderer from '../catalog/FormRenderer';
import ConfidentialOption from '../components/ConfidentialOption';
import { checkRequired } from '../catalog/fields';
import { ErrorState, Spinner } from '../components/ui';

export default function CatalogForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [confidential, setConfidential] = useState(false);

  useEffect(() => {
    setItem(null);
    setError(null);
    api(`/api/catalog/${id}`).then(setItem).catch(setError);
  }, [id]);

  if (error) {
    return (
      <div className="py-8">
        <ErrorState error={error} />
        <p className="mt-6 text-center">
          <Link to="/catalogue" className="font-semibold text-accent hover:underline">
            Revenir au catalogue
          </Link>
        </p>
      </div>
    );
  }
  if (!item) return <Spinner />;

  const change = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const local = checkRequired(item.fields, values);
    if (Object.keys(local).length) {
      setErrors(local);
      document.getElementById(`cf-${Object.keys(local)[0]}`)?.focus();
      return;
    }
    setSubmitting(true);
    const answers = Object.fromEntries(
      item.fields.map((f) => [f.key, f.type === 'file' ? values[f.key]?.length || 0 : values[f.key] ?? ''])
    );
    try {
      const ticket = await api(`/api/catalog/${item.id}/submit`, { method: 'POST', body: { answers, confidential } });
      // Pièces jointes : envoyées une fois le ticket créé, champ par champ.
      const failed = [];
      for (const f of item.fields.filter((x) => x.type === 'file' && values[x.key]?.length)) {
        const fd = new FormData();
        values[f.key].forEach((file) => fd.append('files', file));
        try {
          await api(`/api/tickets/${ticket.id}/attachments`, { method: 'POST', body: fd });
        } catch {
          failed.push(f.label);
        }
      }
      if (failed.length) toastError({ message: `Demande envoyée, mais fichiers non joints (${failed.join(', ')}) : ajoutez-les depuis le ticket.` });
      else toast('Demande envoyée');
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      setErrors(err.details || {});
      toastError(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/catalogue" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink">
        <FiArrowLeft aria-hidden="true" /> Catalogue
      </Link>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{item.name}</h1>
      {item.description && <p className="mt-1 whitespace-pre-line text-ink-mute">{item.description}</p>}

      <form onSubmit={submit} className="panel mt-6 space-y-6 p-5 sm:p-6" noValidate>
        {item.fields.length ? (
          <FormRenderer fields={item.fields} values={values} onChange={change} errors={errors} />
        ) : (
          <p className="text-sm text-ink-mute">Ce formulaire n'a pas de question : envoyez-le directement.</p>
        )}
        <ConfidentialOption checked={confidential} onChange={setConfidential} />
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
          <Link to="/catalogue" className="btn btn-secondary">
            Annuler
          </Link>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Envoi…' : 'Envoyer la demande'}
          </button>
        </div>
      </form>
    </div>
  );
}
