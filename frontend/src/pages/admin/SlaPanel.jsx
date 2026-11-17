import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiBarChart2, FiPlus, FiRefreshCw, FiSave, FiTrash2 } from 'react-icons/fi';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { ErrorState, Spinner } from '../../components/ui';

const DAYS = [
  [1, 'Lun.'],
  [2, 'Mar.'],
  [3, 'Mer.'],
  [4, 'Jeu.'],
  [5, 'Ven.'],
  [6, 'Sam.'],
  [0, 'Dim.'],
];
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};

/** Longueur d'une journée de travail, en minutes (pour l'unité « jours »). */
const dayLength = (cal) => (cal.mode === 'continuous' ? 1440 : Math.max(60, toMin(cal.end) - toMin(cal.start)));

function bestUnit(min, day) {
  if (!min) return 'h';
  if (min % day === 0) return 'd';
  if (min % 60 === 0) return 'h';
  return 'm';
}

/** Durée saisie en minutes, heures ou jours ouvrés ; vide = pas d'engagement. */
function Duration({ id, label, value, onChange, day }) {
  const [unit, setUnit] = useState(bestUnit(value, day));
  const factor = unit === 'd' ? day : unit === 'h' ? 60 : 1;
  const shown = value ? Math.round((value / factor) * 100) / 100 : '';
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min="0"
        step="any"
        className="field w-20"
        placeholder="Aucun"
        value={shown}
        onChange={(e) => onChange(e.target.value === '' || Number(e.target.value) <= 0 ? null : Math.round(Number(e.target.value) * factor))}
      />
      <label htmlFor={`${id}-u`} className="sr-only">
        Unité
      </label>
      <select id={`${id}-u`} className="field w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}>
        <option value="m">minutes</option>
        <option value="h">heures</option>
        <option value="d">jours</option>
      </select>
    </div>
  );
}

function Card({ title, children, hint }) {
  return (
    <section className="panel p-5">
      <h3 className="font-bold">{title}</h3>
      {hint && <p className="mt-1 text-sm text-ink-mute">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SlaPanel() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api('/api/admin/sla')
      .then((r) => {
        setData(r);
        setDraft(r.settings);
        setPreview(r.preview);
      })
      .catch(setError);
  }, []);
  useEffect(load, [load]);

  // Aperçu recalculé pendant la saisie.
  useEffect(() => {
    if (!draft) return undefined;
    const t = setTimeout(() => {
      api('/api/admin/sla/preview', { method: 'POST', body: draft })
        .then((r) => setPreview(r.preview))
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [draft]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data || !draft) return <Spinner />;

  const cal = draft.calendar;
  const day = dayLength(cal);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setCal = (patch) => set({ calendar: { ...cal, ...patch } });
  const setTarget = (p, k, v) => set({ targets: { ...draft.targets, [p]: { ...draft.targets[p], [k]: v } } });
  const setRule = (i, patch) => set({ rules: draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const labelOf = (key) => data.priorities.find((p) => p.key === key)?.label || key;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api('/api/admin/sla', { method: 'PUT', body: draft });
      setData((d) => ({ ...d, settings: r.settings, summary: r.summary }));
      setDraft(r.settings);
      toast('Délais enregistrés : ils s’appliquent aux nouvelles demandes');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };
  const recalc = async () => {
    const ok = await confirmAction({
      title: 'Appliquer aux demandes en cours ?',
      text: 'Les échéances des demandes ouvertes ou en cours seront recalculées avec les réglages enregistrés, depuis leur date de création. Les demandes terminées gardent leur historique.',
      confirmText: 'Recalculer',
    });
    if (!ok) return;
    try {
      const r = await api('/api/admin/sla/recalculate', { method: 'POST' });
      setData((d) => ({ ...d, summary: r.summary }));
      toast(`${r.count} demande(s) recalculée(s)`);
    } catch (err) {
      toastError(err);
    }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  return (
    <div className="space-y-4">
      <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" className="size-4" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Suivre des délais (SLA) sur les demandes
          </label>
          <p className="mt-1 text-sm text-ink-mute">
            {data.summary.running} demande(s) en cours suivie(s), dont{' '}
            <Link to="/tickets?sla=breached" className="font-semibold text-danger hover:underline">
              {data.summary.breached} en dépassement
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/analyses/sla" className="btn btn-secondary">
            <FiBarChart2 aria-hidden="true" /> Tableau de bord SLA
          </Link>
          <button type="button" className="btn btn-secondary" onClick={recalc} disabled={dirty} title={dirty ? 'Enregistrez d’abord vos modifications' : undefined}>
            <FiRefreshCw aria-hidden="true" /> Appliquer aux demandes en cours
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            <FiSave aria-hidden="true" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Temps décompté" hint="Les délais avancent seulement pendant ces heures. Les jours fériés français sont calculés automatiquement, Pâques et Pentecôte comprises.">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Mode de calcul</legend>
            {[
              ['business', 'Heures ouvrées'],
              ['continuous', '24 h sur 24, 7 jours sur 7'],
            ].map(([k, l]) => (
              <label key={k} className={`cursor-pointer rounded-full border px-3 py-1 text-sm font-semibold ${cal.mode === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft'}`}>
                <input type="radio" className="sr-only" name="sla-mode" checked={cal.mode === k} onChange={() => setCal({ mode: k })} />
                {l}
              </label>
            ))}
          </fieldset>
          {cal.mode === 'business' && (
            <div className="mt-4 space-y-3">
              <fieldset>
                <legend className="label">Jours ouvrés</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(([d, l]) => {
                    const on = cal.days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCal({ days: on ? cal.days.filter((x) => x !== d) : [...cal.days, d] })}
                        className={`w-12 rounded-md border py-1.5 text-sm font-semibold ${on ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-mute'}`}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="sla-start" className="label">
                    De
                  </label>
                  <input id="sla-start" type="time" className="field" value={cal.start} onChange={(e) => setCal({ start: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="sla-end" className="label">
                    À
                  </label>
                  <input id="sla-end" type="time" className="field" value={cal.end} onChange={(e) => setCal({ end: e.target.value })} />
                </div>
                <p className="pb-2 text-sm text-ink-mute">Un jour = {Math.round((day / 60) * 10) / 10} h</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cal.holidays} onChange={(e) => setCal({ holidays: e.target.checked })} /> Exclure les jours fériés
              </label>
            </div>
          )}
        </Card>

        <Card title="Alertes" hint="Envoyées au responsable de la demande, ou aux membres de son groupe s’il n’y en a pas. Chacun peut les couper dans « Mon compte ».">
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sla-warn">Alerte quand</label>
              <input
                id="sla-warn"
                type="number"
                min="10"
                max="95"
                className="field w-20"
                value={draft.warnPercent}
                onChange={(e) => set({ warnPercent: Number(e.target.value) })}
              />
              <span>% du délai est écoulé</span>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.notify.warning} onChange={(e) => set({ notify: { ...draft.notify, warning: e.target.checked } })} /> E-mail
              quand le délai approche
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.notify.breach} onChange={(e) => set({ notify: { ...draft.notify, breach: e.target.checked } })} /> E-mail
              quand le délai est dépassé
            </label>
            <p className="text-ink-mute">
              Les deux e-mails doivent aussi être actifs dans Paramètres, Notifications. Une demande devient « à risque » dans les listes et les tableaux de
              bord au même seuil.
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="Délais par priorité"
        hint="Prise en charge : un responsable, un changement de statut ou un message d’une autre personne que l’auteur. Résolution : passage à « Résolu » ou « Fermé ». Laissez vide pour ne pas prendre d’engagement."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-mute">
                <th className="py-2 pr-4">Priorité</th>
                <th className="py-2 pr-4">Prise en charge</th>
                <th className="py-2 pr-4">Résolution</th>
                <th className="py-2">Pour une demande créée maintenant</th>
              </tr>
            </thead>
            <tbody>
              {data.priorities.map((p) => (
                <tr key={p.key} className="border-t border-line">
                  <th scope="row" className="py-2 pr-4 font-semibold">
                    {p.label}
                  </th>
                  <td className="py-2 pr-4">
                    <Duration id={`t-${p.key}-r`} label={`Prise en charge, ${p.label}`} day={day} value={draft.targets[p.key]?.response} onChange={(v) => setTarget(p.key, 'response', v)} />
                  </td>
                  <td className="py-2 pr-4">
                    <Duration id={`t-${p.key}-s`} label={`Résolution, ${p.label}`} day={day} value={draft.targets[p.key]?.resolution} onChange={(v) => setTarget(p.key, 'resolution', v)} />
                  </td>
                  <td className="py-2 text-xs text-ink-soft">
                    {preview?.[p.key] ? (
                      <>
                        {preview[p.key].response && <span className="block">Prise en charge avant le {formatDateTime(preview[p.key].response)}</span>}
                        {preview[p.key].resolution && <span className="block">Résolution avant le {formatDateTime(preview[p.key].resolution)}</span>}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Règles par catégorie" hint="Des délais différents pour une catégorie (et éventuellement une seule priorité). La première règle qui correspond l’emporte sur les délais par priorité.">
        {draft.rules.length === 0 && <p className="mb-3 text-sm text-ink-mute">Aucune règle : les délais par priorité s’appliquent partout.</p>}
        <ul className="space-y-2">
          {draft.rules.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
              <label htmlFor={`rule-c-${i}`} className="sr-only">
                Catégorie
              </label>
              <select id={`rule-c-${i}`} className="field w-auto" value={r.category} onChange={(e) => setRule(i, { category: e.target.value })}>
                {data.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
                <option value="">Sans catégorie</option>
              </select>
              <label htmlFor={`rule-p-${i}`} className="sr-only">
                Priorité
              </label>
              <select id={`rule-p-${i}`} className="field w-auto" value={r.priority} onChange={(e) => setRule(i, { priority: e.target.value })}>
                <option value="all">Toutes priorités</option>
                {data.priorities.map((p) => (
                  <option key={p.key} value={p.key}>
                    {labelOf(p.key)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-ink-mute">prise en charge</span>
              <Duration id={`rule-r-${i}`} label="Prise en charge" day={day} value={r.response} onChange={(v) => setRule(i, { response: v })} />
              <span className="text-xs text-ink-mute">résolution</span>
              <Duration id={`rule-s-${i}`} label="Résolution" day={day} value={r.resolution} onChange={(v) => setRule(i, { resolution: v })} />
              <button type="button" className="btn btn-ghost ml-auto text-danger" aria-label="Retirer la règle" onClick={() => set({ rules: draft.rules.filter((_, j) => j !== i) })}>
                <FiTrash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-secondary mt-3"
          onClick={() => set({ rules: [...draft.rules, { category: data.categories[0]?.key ?? '', priority: 'all', response: 240, resolution: 1080 }] })}
        >
          <FiPlus aria-hidden="true" /> Ajouter une règle
        </button>
      </Card>

      <p className="text-xs text-ink-mute">
        Les échéances sont fixées à la création de chaque demande, et recalculées si sa priorité ou sa catégorie change. Modifier ces réglages ne touche que les
        nouvelles demandes, sauf avec « Appliquer aux demandes en cours ».
      </p>
    </div>
  );
}
