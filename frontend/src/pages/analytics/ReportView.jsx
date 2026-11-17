import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft, FiClock, FiCopy, FiDownload, FiEdit2, FiMail, FiPlus, FiSend, FiTrash2, FiX } from 'react-icons/fi';
import { api, downloadFile } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { ErrorState, Field, PageHeader, Spinner } from '../../components/ui';
import Modal from '../../components/Modal';
import { useMeta } from '../../analytics/useMeta';
import { ResultView } from '../../analytics/Charts';
import { TYPE_LABELS } from '../../analytics/labels';
import ExportMenu from '../../components/ExportMenu';

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const RUN_STATUS = { ok: 'Envoyé', empty: 'Rien à envoyer (rapport vide)', error: 'Échec' };

/** Destinataires : moi, des personnes, des groupes dont je suis membre. */
function RecipientsPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ people: [], groups: [] });
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/analytics/recipients', { query: { q } })
        .then(setFound)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const people = found.people.filter((p) => !value.users.some((u) => u.id === p.id));
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.includeSelf} onChange={(e) => onChange({ ...value, includeSelf: e.target.checked })} /> M’envoyer aussi le rapport
      </label>
      <div>
        <p className="label">Groupes</p>
        {found.groups.length ? (
          <div className="flex flex-wrap gap-2">
            {found.groups.map((g) => {
              const on = value.groups.some((x) => x.id === g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, groups: on ? value.groups.filter((x) => x.id !== g.id) : [...value.groups, g] })}
                  className={`rounded-full border px-3 py-1 text-sm font-semibold ${on ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft'}`}
                >
                  {g.name} <span className="font-normal text-ink-mute">({g.members})</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-ink-mute">Vous n’êtes membre d’aucun groupe : vous pouvez choisir des personnes une par une.</p>
        )}
      </div>
      <div>
        <p className="label">Personnes ({value.users.length})</p>
        {value.users.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {value.users.map((u) => (
              <li key={u.id} className="inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1">
                {u.name}
                <button type="button" aria-label={`Retirer ${u.name}`} className="text-ink-mute hover:text-ink" onClick={() => onChange({ ...value, users: value.users.filter((x) => x.id !== u.id) })}>
                  <FiX aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="rcpt-q" className="sr-only">
          Ajouter une personne
        </label>
        <input id="rcpt-q" type="search" className="field" placeholder="Ajouter une personne : pseudonyme ou nom" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line">
            {people.length === 0 && <li className="px-3 py-2 text-ink-mute">Personne ne correspond.</li>}
            {people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-paper"
                  onClick={() => {
                    onChange({ ...value, users: [...value.users, p] });
                    setQ('');
                  }}
                >
                  <span className="font-semibold">{p.name}</span>
                  {p.name !== p.username && <span className="ml-2 text-ink-mute">{p.username}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const FILE_FORMATS = { xlsx: 'Excel (.xlsx)', csv: 'CSV (.csv)', json: 'JSON (.json)' };

function ScheduleDialog({ open, onClose, reportId, schedule, onSaved }) {
  const blank = { frequency: 'weekly', weekday: 1, monthday: 1, time: '08:00', includeSelf: true, users: [], groups: [], message: '', skipEmpty: false, fileFormat: 'xlsx', active: true };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setV(schedule ? { ...blank, ...schedule, weekday: schedule.weekday ?? 1, monthday: schedule.monthday ?? 1 } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...v, users: v.users.map((u) => u.id), groups: v.groups.map((g) => g.id) };
      const r = await api(schedule ? `/api/analytics/schedules/${schedule.id}` : `/api/analytics/reports/${reportId}/schedules`, { method: schedule ? 'PUT' : 'POST', body });
      toast(schedule ? 'Envoi programmé modifié' : 'Envoi programmé');
      onSaved(r.schedule);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule ? 'Modifier l’envoi programmé' : 'Programmer un envoi par e-mail'}
      labelId="schedule-title"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            <FiClock aria-hidden="true" /> {schedule ? 'Enregistrer' : 'Programmer'}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-line bg-paper p-3 text-ink-soft">
        Le rapport est calculé <strong>avec vos droits</strong>. Il n’est envoyé qu’aux personnes qui voient elles-mêmes toutes les demandes qu’il contient ; les
        autres sont écartées, et l’historique de l’envoi l’indique.
      </div>
      <fieldset>
        <legend className="label">Fréquence</legend>
        <div className="flex flex-wrap gap-2">
          {[
            ['daily', 'Chaque jour'],
            ['weekly', 'Chaque semaine'],
            ['monthly', 'Chaque mois'],
          ].map(([k, l]) => (
            <label key={k} className={`cursor-pointer rounded-full border px-3 py-1 font-semibold ${v.frequency === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft'}`}>
              <input type="radio" className="sr-only" name="freq" checked={v.frequency === k} onChange={() => setV({ ...v, frequency: k })} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {v.frequency === 'weekly' && (
          <Field id="sch-wd" label="Jour">
            {(p) => (
              <select {...p} className="field" value={v.weekday} onChange={(e) => setV({ ...v, weekday: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {v.frequency === 'monthly' && (
          <Field id="sch-md" label="Jour du mois" hint="Du 1er au 28, pour exister tous les mois.">
            {(p) => (
              <select {...p} className="field" value={v.monthday} onChange={(e) => setV({ ...v, monthday: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1er' : d}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field id="sch-time" label="Heure">
          {(p) => <input {...p} type="time" className="field" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />}
        </Field>
      </div>
      <RecipientsPicker value={v} onChange={setV} />
      <Field id="sch-msg" label="Message ajouté à l’e-mail (facultatif)">
        {(p) => <textarea {...p} className="field" rows={2} maxLength={500} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />}
      </Field>
      <Field id="sch-format" label="Fichier joint">
        {(p) => (
          <select {...p} className="field" value={v.fileFormat} onChange={(e) => setV({ ...v, fileFormat: e.target.value })}>
            {Object.entries(FILE_FORMATS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.skipEmpty} onChange={(e) => setV({ ...v, skipEmpty: e.target.checked })} /> Ne rien envoyer quand le rapport est vide
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Envoi actif
      </label>
    </Modal>
  );
}

function RunsDialog({ schedule, onClose }) {
  const [runs, setRuns] = useState(null);
  useEffect(() => {
    if (!schedule) return;
    setRuns(null);
    api(`/api/analytics/schedules/${schedule.id}/runs`)
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]));
  }, [schedule]);
  return (
    <Modal open={Boolean(schedule)} onClose={onClose} title="Historique des envois" labelId="runs-title">
      {!runs ? (
        <Spinner />
      ) : !runs.length ? (
        <p className="text-ink-mute">Aucun envoi pour le moment.</p>
      ) : (
        <ul className="divide-y divide-line">
          {runs.map((r, i) => (
            <li key={i} className="py-2">
              <p className="flex justify-between gap-2">
                <span className="font-semibold">{formatDateTime(r.at)}</span>
                <span className={r.status === 'error' ? 'text-danger' : 'text-ink-soft'}>
                  {RUN_STATUS[r.status]}
                  {r.sent ? `, ${r.sent} destinataire${r.sent > 1 ? 's' : ''}` : ''}
                </span>
              </p>
              {r.error && <p className="text-danger">{r.error}</p>}
              {r.skipped.length > 0 && (
                <ul className="mt-1 text-xs text-ink-mute">
                  {r.skipped.map((s, j) => (
                    <li key={j}>
                      Non envoyé à {s.name} : {s.reason}.
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Schedules({ reportId }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [runsOf, setRunsOf] = useState(null);
  const load = useCallback(() => {
    api(`/api/analytics/reports/${reportId}/schedules`)
      .then((r) => setList(r.schedules))
      .catch(() => setList([]));
  }, [reportId]);
  useEffect(load, [load]);

  const sendNow = async (s) => {
    try {
      const { run } = await api(`/api/analytics/schedules/${s.id}/send`, { method: 'POST' });
      if (run.status === 'ok') toast(`Envoyé à ${run.sent} destinataire${run.sent > 1 ? 's' : ''}${run.skipped.length ? `, ${run.skipped.length} écarté(s)` : ''}`);
      else toast(run.error || RUN_STATUS[run.status], run.status === 'error' ? 'error' : 'info');
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const remove = async (s) => {
    if (!(await confirmAction({ title: 'Supprimer cet envoi programmé ?', confirmText: 'Supprimer', danger: true }))) return;
    try {
      await api(`/api/analytics/schedules/${s.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <section className="panel mt-6 p-5" aria-labelledby="schedules-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="schedules-title" className="flex items-center gap-2 font-bold">
          <FiMail aria-hidden="true" /> Envois programmés
        </h2>
        <button type="button" className="btn btn-secondary" onClick={() => setEditing('new')}>
          <FiPlus aria-hidden="true" /> Programmer un envoi
        </button>
      </div>
      {!list ? (
        <Spinner />
      ) : !list.length ? (
        <p className="text-sm text-ink-mute">Recevez ce rapport par e-mail, chaque jour, chaque semaine ou chaque mois, avec le détail en fichier joint (Excel, CSV ou JSON).</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold first-letter:uppercase">{s.label}</p>
                <p className="text-ink-soft">
                  À {[s.includeSelf && 'moi', ...s.groups.map((g) => `groupe ${g.name}`), ...s.users.map((u) => u.name)].filter(Boolean).join(', ') || 'personne'}, fichier{' '}
                  {FILE_FORMATS[s.fileFormat] || FILE_FORMATS.csv}
                </p>
                <p className="text-xs text-ink-mute">
                  {s.active ? `Prochain envoi : ${formatDateTime(s.nextRunAt)}` : `Arrêté${s.disabledReason ? ` : ${s.disabledReason}` : ''}`}
                  {s.lastRun && ` · Dernier : ${formatDateTime(s.lastRun.at)}, ${RUN_STATUS[s.lastRun.status].toLowerCase()}${s.lastRun.skipped.length ? `, ${s.lastRun.skipped.length} écarté(s)` : ''}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="btn btn-ghost" onClick={() => sendNow(s)}>
                  <FiSend aria-hidden="true" /> Envoyer maintenant
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setRunsOf(s)}>
                  Historique
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(s)} aria-label="Modifier cet envoi">
                  <FiEdit2 aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-ghost text-danger" onClick={() => remove(s)} aria-label="Supprimer cet envoi">
                  <FiTrash2 aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ScheduleDialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        reportId={reportId}
        schedule={editing === 'new' ? null : editing}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <RunsDialog schedule={runsOf} onClose={() => setRunsOf(null)} />
    </section>
  );
}

export default function ReportView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meta } = useMeta();
  const [report, setReport] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('');
  const [group, setGroup] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReport(null);
    api(`/api/analytics/reports/${id}`)
      .then((r) => setReport(r.report))
      .catch(setError);
  }, [id]);

  const run = useCallback(() => {
    setLoading(true);
    api(`/api/analytics/reports/${id}/run`, { query: { period, group } })
      .then((r) => setResult(r.result))
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id, period, group]);
  useEffect(run, [run]);

  const download = async (format) => {
    try {
      await downloadFile(`/api/analytics/reports/${id}/export`, { query: { period, group, format } });
    } catch (err) {
      toastError(err);
    }
  };
  const duplicate = async () => {
    try {
      const { report: copy } = await api(`/api/analytics/reports/${id}/duplicate`, { method: 'POST' });
      toast('Copie créée : elle vous appartient');
      navigate(`/analyses/rapports/${copy.id}/modifier`);
    } catch (err) {
      toastError(err);
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: 'Supprimer ce rapport ?', text: 'Ses envois programmés seront supprimés aussi.', confirmText: 'Supprimer', danger: true }))) return;
    try {
      await api(`/api/analytics/reports/${id}`, { method: 'DELETE' });
      toast('Rapport supprimé');
      navigate('/analyses/rapports');
    } catch (err) {
      toastError(err);
    }
  };

  if (error) return <ErrorState error={error} />;
  if (!report) return <Spinner />;

  return (
    <div>
      <Link to="/analyses/rapports" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
        <FiArrowLeft aria-hidden="true" /> Rapports
      </Link>
      <PageHeader
        title={report.name}
        actions={
          <>
            {report.mine && (
              <Link to={`/analyses/rapports/${id}/modifier`} className="btn btn-secondary">
                <FiEdit2 aria-hidden="true" /> Modifier
              </Link>
            )}
            <ExportMenu onExport={download} />
            <button type="button" className="btn btn-secondary" onClick={duplicate}>
              <FiCopy aria-hidden="true" /> Dupliquer
            </button>
            {report.mine && (
              <button type="button" className="btn btn-ghost text-danger" onClick={remove} aria-label="Supprimer le rapport">
                <FiTrash2 aria-hidden="true" />
              </button>
            )}
          </>
        }
      >
        {report.description || TYPE_LABELS[report.definition.type]?.label}
        {!report.mine && ` · Partagé par ${report.owner.name}`}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rv-period" className="label">
            Période
          </label>
          <select id="rv-period" className="field" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="">Celle du rapport ({meta?.periods[report.definition.filters?.period?.range || 'all']?.toLowerCase()})</option>
            {meta && Object.entries(meta.periods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rv-group" className="label">
            Groupe
          </label>
          <select id="rv-group" className="field" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Celui du rapport</option>
            <option value="mine">Mes groupes</option>
            {meta?.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {loading && <span className="pb-2 text-sm text-ink-mute">Calcul…</span>}
      </div>

      <div className="panel p-5">
        {result ? <ResultView result={result} height={result.type === 'kpi' ? 120 : 420} /> : <Spinner />}
        {result && <p className="mt-3 text-xs text-ink-mute">Calculé avec vos droits, le {formatDateTime(result.generatedAt)}.</p>}
      </div>

      {report.mine && <Schedules reportId={report.id} />}
    </div>
  );
}
