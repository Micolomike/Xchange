import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner } from '../components/ui';
import { MultiPick } from './common';
import { CHART_LABELS, TYPE_LABELS, defaultDefinition } from './labels';
import { ResultView } from './Charts';
import FieldFilters from './FieldFilters';

const PERIOD_FIELDS = { created: 'date de création', updated: 'dernière mise à jour', resolved: 'date de résolution' };

function Select({ id, label, value, onChange, options }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Éditeur d'une définition de rapport, avec un aperçu en direct calculé avec les droits de la personne.
 * Partagé par l'éditeur de rapport et les blocs des tableaux de bord.
 */
export default function DefinitionEditor({ value, onChange, meta, idPrefix = 'def', previewHeight = 300 }) {
  const def = value;
  const f = def.filters || {};
  const set = (patch) => onChange({ ...def, ...patch });
  const setF = (patch) => onChange({ ...def, filters: { ...f, ...patch } });
  const [preview, setPreview] = useState({ loading: true });
  // Variables du formulaire quand le rapport porte sur ce seul formulaire.
  const formId = f.form?.length === 1 && f.form[0] !== 'none' ? f.form[0] : null;
  const [vars, setVars] = useState({ form: null, list: [] });
  useEffect(() => {
    if (!formId) return undefined;
    let alive = true;
    api(`/api/analytics/forms/${formId}/variables`)
      .then((r) => alive && setVars({ form: formId, list: r.variables.map((v) => ({ ...v, variable: true })) }))
      .catch(() => alive && setVars({ form: formId, list: [] }));
    return () => {
      alive = false;
    };
  }, [formId]);
  const variables = formId && vars.form === formId ? vars.list : [];
  const extra = [...(meta.fields || []), ...variables];
  const extraLabel = (x) => `${x.variable ? 'Variable' : 'Champ'} : ${x.label}`;
  const columnEntries = [...Object.entries(meta.columns), ...extra.map((x) => [x.key, extraLabel(x)])];

  useEffect(() => {
    let alive = true;
    setPreview((p) => ({ ...p, loading: true }));
    const t = setTimeout(async () => {
      try {
        const r = await api('/api/analytics/preview', { method: 'POST', body: { definition: def } });
        if (alive) setPreview({ result: r.result });
      } catch (err) {
        if (alive) setPreview({ error: err.message });
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [def]);

  const changeType = (type) => onChange({ ...defaultDefinition(type, meta), filters: { ...defaultDefinition(type, meta).filters, ...f, period: f.period } });
  const dims = [...Object.entries(meta.dimensions), ...extra.filter((x) => x.groupable).map((x) => [x.key, extraLabel(x)])];
  const id = (s) => `${idPrefix}-${s}`;
  const periodOptions = Object.entries(meta.periods);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="space-y-5">
        <fieldset>
          <legend className="label">Type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {meta.types.map((t) => (
              <label
                key={t}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${def.type === t ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'}`}
              >
                <input type="radio" name={id('type')} className="mt-1" checked={def.type === t} onChange={() => changeType(t)} />
                <span>
                  <span className="block font-semibold">{TYPE_LABELS[t].label}</span>
                  <span className="block text-xs text-ink-mute">{TYPE_LABELS[t].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {meta.charts[def.type].length > 1 && (
          <fieldset>
            <legend className="label">Affichage</legend>
            <div className="flex flex-wrap gap-2">
              {meta.charts[def.type].map((c) => (
                <label
                  key={c}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-sm font-semibold ${def.chart === c ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink-soft'}`}
                >
                  <input type="radio" className="sr-only" name={id('chart')} checked={def.chart === c} onChange={() => set({ chart: c, ...(c === 'stacked' && !def.split ? { split: def.dimension === 'status' ? 'priority' : 'status' } : {}) })} />
                  {CHART_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {def.type === 'summary' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id={id('dim')} label="Regrouper par" value={def.dimension} onChange={(v) => set({ dimension: v, ...(def.split === v ? { split: undefined } : {}) })} options={dims} />
            <Select
              id={id('split')}
              label="Puis par (facultatif)"
              value={def.split || ''}
              onChange={(v) => set({ split: v || undefined, ...(v ? {} : def.chart === 'stacked' ? { chart: 'bar' } : {}) })}
              options={[['', 'Aucun'], ...dims.filter(([k]) => k !== def.dimension)]}
            />
            <Select id={id('metric')} label="Mesure" value={def.metric} onChange={(v) => set({ metric: v })} options={Object.entries(meta.metrics)} />
            <Select
              id={id('limit')}
              label="Valeurs affichées"
              value={String(def.limit || 12)}
              onChange={(v) => set({ limit: Number(v) })}
              options={[5, 8, 12, 20, 50].map((n) => [String(n), `${n} au plus`])}
            />
          </div>
        )}

        {def.type === 'trend' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id={id('interval')} label="Par" value={def.interval} onChange={(v) => set({ interval: v })} options={[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']]} />
            <MultiPick
              label="Courbes"
              allLabel="Créées et résolues"
              options={[
                { key: 'created', label: 'Créées' },
                { key: 'resolved', label: 'Résolues' },
                { key: 'sla_rate', label: 'Résolutions dans les délais (%), seule' },
              ]}
              value={def.series}
              onChange={(series) => set({ series })}
            />
          </div>
        )}

        {def.type === 'kpi' && <Select id={id('kpi')} label="Indicateur" value={def.metric} onChange={(v) => set({ metric: v })} options={Object.entries(meta.kpis)} />}

        {def.type === 'list' && (
          <div className="space-y-3">
            <MultiPick
              label="Colonnes"
              allLabel="Par défaut"
              options={columnEntries.map(([k, l]) => ({ key: k, label: l }))}
              value={def.columns}
              onChange={(columns) => set({ columns })}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Select id={id('sort')} label="Trier par" value={def.sort?.field} onChange={(v) => set({ sort: { ...def.sort, field: v } })} options={columnEntries} />
              <Select id={id('dir')} label="Ordre" value={def.sort?.dir} onChange={(v) => set({ sort: { ...def.sort, dir: v } })} options={[['desc', 'Décroissant'], ['asc', 'Croissant']]} />
              <Select id={id('lim')} label="Lignes" value={String(def.limit)} onChange={(v) => set({ limit: Number(v) })} options={[10, 25, 50, 100, 250, 500].map((n) => [String(n), String(n)])} />
            </div>
          </div>
        )}

        <fieldset className="space-y-3 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Quelles demandes ?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select id={id('range')} label="Période" value={f.period?.range || 'all'} onChange={(v) => setF({ period: { ...f.period, range: v } })} options={periodOptions} />
            {def.type !== 'trend' && def.type !== 'heatmap' && (
              <Select
                id={id('field')}
                label="Selon la"
                value={f.period?.field || 'created'}
                onChange={(v) => setF({ period: { ...f.period, field: v } })}
                options={Object.entries(PERIOD_FIELDS)}
              />
            )}
          </div>
          <div className="grid gap-2">
            <MultiPick label="Statut" options={meta.statuses} value={f.status || []} onChange={(v) => setF({ status: v })} />
            <MultiPick label="Priorité" options={meta.priorities} value={f.priority || []} onChange={(v) => setF({ priority: v })} />
            <MultiPick
              label="Catégorie"
              options={[...meta.categories, { key: '', label: 'Sans catégorie' }]}
              value={f.category || []}
              onChange={(v) => setF({ category: v })}
            />
            <MultiPick
              label="Groupe"
              options={[{ key: 'mine', label: 'Mes groupes' }, ...meta.groups.map((g) => ({ key: String(g.id), label: g.name })), { key: 'none', label: 'Sans groupe' }]}
              value={f.group || []}
              onChange={(v) => setF({ group: v })}
            />
            <MultiPick
              label="Formulaire"
              options={[...meta.forms.map((x) => ({ key: String(x.id), label: x.name })), { key: 'none', label: 'Demande libre' }]}
              value={f.form || []}
              onChange={(v) => setF({ form: v })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              id={id('assignee')}
              label="Responsable"
              value={f.assignee || 'any'}
              onChange={(v) => setF({ assignee: v })}
              options={[['any', 'Peu importe'], ['me', 'Moi'], ['assigned', 'Quelqu’un'], ['none', 'Personne']]}
            />
            <Select
              id={id('sla')}
              label="Délai de résolution (SLA)"
              value={f.sla || 'any'}
              onChange={(v) => setF({ sla: v })}
              options={[
                ['any', 'Peu importe'],
                ['attention', 'En cours : dépassé ou bientôt'],
                ['breached', 'En cours : dépassé'],
                ['at_risk', 'En cours : bientôt dépassé'],
                ['met', 'Respecté'],
                ['missed', 'Non respecté'],
                ['late', 'Dépassé (en cours ou terminé)'],
              ]}
            />
            <Select id={id('creator')} label="Demandeur" value={f.creator || 'any'} onChange={(v) => setF({ creator: v })} options={[['any', 'Peu importe'], ['me', 'Moi']]} />
            <Select
              id={id('conf')}
              label="Demandes confidentielles"
              value={f.confidential || 'any'}
              onChange={(v) => setF({ confidential: v })}
              options={[['any', 'Comprises'], ['exclude', 'Exclues'], ['only', 'Seulement elles']]}
            />
            <div>
              <label htmlFor={id('q')} className="label">
                Mot dans le titre ou la description
              </label>
              <input id={id('q')} className="field" maxLength={100} value={f.q || ''} onChange={(e) => setF({ q: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(f.overdue)} onChange={(e) => setF({ overdue: e.target.checked })} /> En retard seulement
          </label>
          {(extra.length > 0 || f.fields?.length > 0) && (
            <div className="space-y-1.5 border-t border-line pt-3">
              <p className="text-sm font-semibold">Champs et variables</p>
              <FieldFilters idPrefix={idPrefix} value={f.fields || []} onChange={(fields) => setF({ fields })} available={extra} groups={meta.groups} />
              {!formId && <p className="text-xs text-ink-mute">Pour utiliser les variables d’un formulaire, choisissez ce seul formulaire dans « Formulaire ».</p>}
            </div>
          )}
          <p className="text-xs text-ink-mute">« Moi » et « Mes groupes » désignent la personne qui consulte, ou le créateur pour un envoi par e-mail.</p>
        </fieldset>
      </div>

      <section aria-label="Aperçu" className="min-w-0">
        <div className="panel sticky top-20 p-4">
          <p className="mb-3 flex items-center justify-between text-sm font-semibold text-ink-soft">
            Aperçu, avec vos droits
            {preview.loading && <span className="text-xs font-normal text-ink-mute">Calcul…</span>}
          </p>
          {preview.error ? (
            <p role="alert" className="py-6 text-center text-sm text-danger">
              {preview.error}
            </p>
          ) : preview.result ? (
            <ResultView result={preview.result} height={previewHeight} />
          ) : (
            <Spinner />
          )}
        </div>
      </section>
    </div>
  );
}
