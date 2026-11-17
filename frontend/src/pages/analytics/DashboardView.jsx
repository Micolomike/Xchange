import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  FiArrowLeft,
  FiArrowRight,
  FiCopy,
  FiEdit2,
  FiMaximize,
  FiMinimize,
  FiMove,
  FiPlus,
  FiSave,
  FiSettings,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import { api } from '../../lib/api';
import { confirmAction, toast, toastError } from '../../lib/notify';
import { ErrorState, Spinner } from '../../components/ui';
import Modal from '../../components/Modal';
import { useChat } from '../../chat/context';
import { useMeta } from '../../analytics/useMeta';
import { ResultView } from '../../analytics/Charts';
import { SharingFields, TextField } from '../../analytics/common';
import { defaultDefinition } from '../../analytics/labels';
import DefinitionEditor from '../../analytics/DefinitionEditor';

const SPAN = {
  3: 'md:col-span-3 lg:col-span-3',
  4: 'md:col-span-3 lg:col-span-4',
  6: 'md:col-span-6 lg:col-span-6',
  8: 'md:col-span-6 lg:col-span-8',
  12: 'md:col-span-6 lg:col-span-12',
};
const HEIGHT = { 1: 'min-h-[150px]', 2: 'min-h-[340px]', 3: 'min-h-[520px]' };
const CHART_H = { 1: 96, 2: 270, 3: 450 };
const WIDTH_LABELS = { 3: 'Quart', 4: 'Tiers', 6: 'Moitié', 8: 'Deux tiers', 12: 'Pleine largeur' };
const HEIGHT_LABELS = { 1: 'Basse', 2: 'Moyenne', 3: 'Haute' };

/** Bloc en cours de modification : aperçu calculé à part. */
function DraftPreview({ definition, h }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let alive = true;
    api('/api/analytics/preview', { method: 'POST', body: { definition } })
      .then((r) => alive && setRes({ result: r.result }))
      .catch((err) => alive && setRes({ error: err.message }));
    return () => {
      alive = false;
    };
  }, [definition]);
  if (!res) return <Spinner />;
  if (res.error) return <p className="text-sm text-danger">{res.error}</p>;
  return <ResultView result={res.result} height={CHART_H[h]} />;
}

function WidgetDialog({ open, widget, meta, onClose, onSave }) {
  const [w, setW] = useState(null);
  const [reports, setReports] = useState([]);
  useEffect(() => {
    if (!open) return;
    setW(widget || { id: `b${Date.now().toString(36)}`, title: '', w: 6, h: 2, definition: defaultDefinition('summary', meta) });
    api('/api/analytics/reports')
      .then((r) => setReports([...r.mine, ...r.shared]))
      .catch(() => setReports([]));
  }, [open, widget, meta]);
  if (!w) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={widget ? 'Modifier le bloc' : 'Ajouter un bloc'}
      labelId="widget-title"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!w.title.trim()} onClick={() => onSave(w)}>
            {widget ? 'Appliquer' : 'Ajouter'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TextField id="w-title" label="Titre du bloc" required max={80} value={w.title} onChange={(title) => setW({ ...w, title })} />
        {reports.length > 0 && (
          <div>
            <label htmlFor="w-from" className="label">
              Reprendre un rapport (facultatif)
            </label>
            <select
              id="w-from"
              className="field"
              value=""
              onChange={(e) => {
                const r = reports.find((x) => String(x.id) === e.target.value);
                if (r) setW({ ...w, title: w.title || r.name, definition: r.definition, reportId: r.id, h: r.definition.type === 'kpi' ? 1 : w.h });
              }}
            >
              <option value="">Choisir…</option>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <DefinitionEditor meta={meta} value={w.definition} onChange={(definition) => setW({ ...w, definition })} idPrefix="w" previewHeight={260} />
    </Modal>
  );
}

function SettingsDialog({ open, value, meta, onClose, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (open) setV(value);
  }, [open, value]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Réglages du tableau de bord"
      labelId="dash-settings-title"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!v.name?.trim()} onClick={() => onSave(v)}>
            Appliquer
          </button>
        </>
      }
    >
      <TextField id="d-name" label="Nom" required max={100} value={v.name || ''} onChange={(name) => setV({ ...v, name })} />
      <TextField id="d-desc" label="Description (facultative)" max={500} value={v.description || ''} onChange={(description) => setV({ ...v, description })} />
      <SharingFields meta={meta} what="ce tableau de bord" value={v} onChange={(s) => setV({ ...v, visibility: s.visibility, groups: s.groups })} />
    </Modal>
  );
}

export default function DashboardView({ templateKey = null }) {
  const { id: routeId } = useParams();
  const id = templateKey ? null : routeId;
  const base = templateKey ? `/api/analytics/templates/${templateKey}` : `/api/analytics/dashboards/${id}`;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const chat = useChat();
  const { meta } = useMeta();
  const [dash, setDash] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editingWidget, setEditingWidget] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [dragging, setDragging] = useState(null);
  const wrapper = useRef(null);
  const editing = Boolean(draft);

  const loadDash = useCallback(() => {
    api(base)
      .then(({ dashboard }) => {
        setDash(dashboard);
        setFilters((f) => f ?? { period: dashboard.filters.period || '', group: dashboard.filters.group ? String(dashboard.filters.group) : '' });
      })
      .catch(setError);
  }, [base]);
  useEffect(loadDash, [loadDash]);

  const refresh = useCallback(() => {
    if (!filters) return;
    api(`${base}/data`, { query: { period: filters.period || '', group: filters.group || '' } })
      .then((r) => {
        setData(r.data);
        setUpdatedAt(new Date(r.generatedAt));
      })
      .catch((err) => toastError(err));
  }, [base, filters]);
  useEffect(refresh, [refresh, dash?.updatedAt]);

  // En direct : recalcul quand une demande change (signal sans contenu), et toutes les minutes.
  useEffect(() => {
    if (editing) return undefined;
    let timer = null;
    const unsub = chat?.subscribe((event) => {
      if (event !== 'tickets') return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 1500);
    });
    const every = setInterval(refresh, 60_000);
    return () => {
      unsub?.();
      clearTimeout(timer);
      clearInterval(every);
    };
  }, [chat, refresh, editing]);

  // Ouverture directe en modification (tableau vide tout juste créé).
  useEffect(() => {
    if (dash && params.get('modifier') === '1' && dash.mine && !draft) {
      setDraft({ ...dash, groups: dash.groups.map((g) => g.id) });
      setParams({}, { replace: true });
    }
  }, [dash, params, draft, setParams]);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrapper.current?.requestFullscreen?.().catch(() => toast('Le plein écran n’est pas disponible sur ce navigateur.', 'info'));
  };

  const save = async () => {
    try {
      const { dashboard } = await api(`/api/analytics/dashboards/${id}`, {
        method: 'PUT',
        body: {
          name: draft.name,
          description: draft.description,
          widgets: draft.widgets,
          filters: { period: filters.period || undefined, group: filters.group || undefined },
          visibility: draft.visibility,
          groups: draft.groups,
        },
      });
      setDash(dashboard);
      setDraft(null);
      toast('Tableau de bord enregistré');
    } catch (err) {
      toastError(err);
    }
  };
  const duplicate = async () => {
    try {
      const { dashboard } = templateKey
        ? await api('/api/analytics/dashboards', { method: 'POST', body: { template: templateKey } })
        : await api(`/api/analytics/dashboards/${id}/duplicate`, { method: 'POST' });
      toast('Copie créée : elle vous appartient');
      navigate(`/analyses/tableaux/${dashboard.id}`);
    } catch (err) {
      toastError(err);
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: 'Supprimer ce tableau de bord ?', confirmText: 'Supprimer', danger: true }))) return;
    try {
      await api(`/api/analytics/dashboards/${id}`, { method: 'DELETE' });
      navigate('/analyses/tableaux');
    } catch (err) {
      toastError(err);
    }
  };

  const updateWidget = (wid, patch) => setDraft((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === wid ? { ...w, ...patch } : w)) }));
  const moveWidget = (from, to) =>
    setDraft((d) => {
      if (to < 0 || to >= d.widgets.length || from === to) return d;
      const list = [...d.widgets];
      const [x] = list.splice(from, 1);
      list.splice(to, 0, x);
      return { ...d, widgets: list };
    });

  if (error) return <ErrorState error={error} />;
  if (!dash || !meta || !filters) return <Spinner />;
  const widgets = editing ? draft.widgets : dash.widgets;

  return (
    <div ref={wrapper} className={full ? 'overflow-auto bg-paper p-6' : ''}>
      {!full && !templateKey && (
        <Link to="/analyses/tableaux" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <FiArrowLeft aria-hidden="true" /> Tableaux de bord
        </Link>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {templateKey ? (
            <h2 className="text-xl font-bold tracking-tight text-ink">{dash.name}</h2>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight text-ink">{editing ? draft.name : dash.name}</h1>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-mute">
            {(editing ? draft.description : dash.description) && <span>{editing ? draft.description : dash.description}</span>}
            {!dash.mine && dash.owner && <span>Partagé par {dash.owner.name}</span>}
            {!editing && (
              <span className="inline-flex items-center gap-1.5" aria-live="polite">
                <span className={`size-2 rounded-full ${chat?.status === 'online' ? 'bg-resolved' : 'bg-line-strong'}`} aria-hidden="true" />
                {chat?.status === 'online' ? 'En direct' : 'Actualisé chaque minute'}
                {updatedAt && `, mis à jour à ${updatedAt.toLocaleTimeString('fr-FR')}`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="dv-period" className="sr-only">
              Période
            </label>
            <select id="dv-period" className="field" value={filters.period} onChange={(e) => setFilters({ ...filters, period: e.target.value })}>
              <option value="">Période de chaque bloc</option>
              {Object.entries(meta.periods).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dv-group" className="sr-only">
              Groupe
            </label>
            <select id="dv-group" className="field" value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
              <option value="">Tous les groupes</option>
              <option value="mine">Mes groupes</option>
              {meta.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {editing ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>
                <FiSettings aria-hidden="true" /> Réglages
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                <FiSave aria-hidden="true" /> Enregistrer
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={toggleFull} aria-label={full ? 'Quitter le plein écran' : 'Plein écran'} title={full ? 'Quitter le plein écran' : 'Plein écran'}>
                {full ? <FiMinimize aria-hidden="true" /> : <FiMaximize aria-hidden="true" />}
              </button>
              {!full && dash.mine && (
                <button type="button" className="btn btn-secondary" onClick={() => setDraft({ ...dash, groups: dash.groups.map((g) => g.id) })}>
                  <FiEdit2 aria-hidden="true" /> Modifier
                </button>
              )}
              {!full && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={duplicate}
                  aria-label={templateKey ? 'Personnaliser (crée votre copie)' : 'Dupliquer'}
                  title={templateKey ? 'Personnaliser (crée votre copie)' : 'Dupliquer'}
                >
                  <FiCopy aria-hidden="true" /> {templateKey && 'Personnaliser'}
                </button>
              )}
              {!full && dash.mine && (
                <button type="button" className="btn btn-ghost text-danger" onClick={remove} aria-label="Supprimer le tableau de bord" title="Supprimer">
                  <FiTrash2 aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <p className="mb-3 rounded-md border border-dashed border-accent bg-accent-soft px-4 py-2 text-sm text-accent-strong">
          Mode modification : glissez les blocs pour les réordonner, changez leur taille, ajoutez-en. Les filtres choisis en haut deviennent ceux du tableau.
        </p>
      )}

      {widgets.length === 0 && !editing && (
        <div className="panel p-10 text-center text-ink-mute">
          Ce tableau de bord est vide.{' '}
          {dash.mine && (
            <button type="button" className="font-semibold text-accent-strong underline" onClick={() => setDraft({ ...dash, groups: dash.groups.map((g) => g.id) })}>
              Ajouter des blocs
            </button>
          )}
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
        {widgets.map((w, i) => {
          const d = data?.[w.id];
          return (
            <li
              key={w.id}
              className={`panel flex flex-col p-4 ${SPAN[w.w] || SPAN[6]} ${HEIGHT[w.h] || HEIGHT[2]} ${dragging === i ? 'opacity-50' : ''}`}
              draggable={editing}
              onDragStart={() => setDragging(i)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={() => {
                if (dragging != null) moveWidget(dragging, i);
                setDragging(null);
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-soft">
                  {editing && <FiMove aria-hidden="true" className="shrink-0 cursor-grab text-ink-mute" />}
                  <span className="truncate">{w.title}</span>
                </h2>
                {!editing && d?.result?.period && w.definition.type !== 'kpi' && <span className="shrink-0 text-xs text-ink-mute">{d.result.period}</span>}
              </div>
              {editing && (
                <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-line pb-2 text-xs">
                  <button type="button" className="btn btn-ghost px-1.5 py-1" aria-label={`Déplacer « ${w.title} » avant`} onClick={() => moveWidget(i, i - 1)} disabled={i === 0}>
                    <FiArrowLeft aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-ghost px-1.5 py-1" aria-label={`Déplacer « ${w.title} » après`} onClick={() => moveWidget(i, i + 1)} disabled={i === widgets.length - 1}>
                    <FiArrowRight aria-hidden="true" />
                  </button>
                  <label className="sr-only" htmlFor={`ww-${w.id}`}>
                    Largeur
                  </label>
                  <select id={`ww-${w.id}`} className="field h-8 w-auto py-0 text-xs" value={w.w} onChange={(e) => updateWidget(w.id, { w: Number(e.target.value) })}>
                    {meta.widths.map((x) => (
                      <option key={x} value={x}>
                        {WIDTH_LABELS[x]}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor={`wh-${w.id}`}>
                    Hauteur
                  </label>
                  <select id={`wh-${w.id}`} className="field h-8 w-auto py-0 text-xs" value={w.h} onChange={(e) => updateWidget(w.id, { h: Number(e.target.value) })}>
                    {meta.heights.map((x) => (
                      <option key={x} value={x}>
                        {HEIGHT_LABELS[x]}
                      </option>
                    ))}
                  </select>
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="btn btn-ghost px-1.5 py-1" aria-label={`Modifier « ${w.title} »`} onClick={() => setEditingWidget(w)}>
                      <FiEdit2 aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost px-1.5 py-1 text-danger"
                      aria-label={`Retirer « ${w.title} »`}
                      onClick={() => setDraft((dd) => ({ ...dd, widgets: dd.widgets.filter((x) => x.id !== w.id) }))}
                    >
                      <FiX aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {editing ? (
                  <DraftPreview definition={w.definition} h={w.h} />
                ) : !d ? (
                  <Spinner />
                ) : d.error ? (
                  <p className="text-sm text-danger">{d.error}</p>
                ) : (
                  <ResultView result={d.result} height={CHART_H[w.h] || CHART_H[2]} />
                )}
              </div>
            </li>
          );
        })}
        {editing && (
          <li className="md:col-span-3 lg:col-span-4">
            <button
              type="button"
              onClick={() => setEditingWidget('new')}
              className="flex h-full min-h-[150px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent-strong"
            >
              <FiPlus aria-hidden="true" className="text-xl" /> Ajouter un bloc
            </button>
          </li>
        )}
      </ul>

      {meta && (
        <WidgetDialog
          open={Boolean(editingWidget)}
          widget={editingWidget === 'new' ? null : editingWidget}
          meta={meta}
          onClose={() => setEditingWidget(null)}
          onSave={(w) => {
            setDraft((d) => ({ ...d, widgets: d.widgets.some((x) => x.id === w.id) ? d.widgets.map((x) => (x.id === w.id ? w : x)) : [...d.widgets, w] }));
            setEditingWidget(null);
          }}
        />
      )}
      {draft && (
        <SettingsDialog
          open={settingsOpen}
          meta={meta}
          value={draft}
          onClose={() => setSettingsOpen(false)}
          onSave={(v) => {
            setDraft({ ...draft, ...v });
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}
