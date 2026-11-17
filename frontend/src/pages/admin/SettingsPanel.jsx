import { useEffect, useRef, useState } from 'react';
import { FiArrowDown, FiArrowUp, FiPlus, FiTrash2, FiUpload } from 'react-icons/fi';
import { api } from '../../lib/api';
import { PRIORITY_COLORS, PRIORITY_ORDER } from '../../lib/constants';
import { toast, toastError } from '../../lib/notify';
import { useSettings } from '../../settings/context';
import { accentShades } from '../../settings/apply';
import { formatDateTime } from '../../lib/format';
import { ErrorState, Field, Spinner } from '../../components/ui';

function ListsSection({ initial }) {
  const { update } = useSettings();
  const [categories, setCategories] = useState(initial.categories);
  const [priorities, setPriorities] = useState(initial.priorities);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const setCat = (i, patch) => setCategories((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveCat = (i, d) =>
    setCategories((list) => {
      const next = [...list];
      const [c] = next.splice(i, 1);
      next.splice(i + d, 0, c);
      return next;
    });
  const setPrio = (key, patch) => setPriorities((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        categories: categories.map(({ key, label, active }) => ({ key, label, active })),
        priorities: Object.fromEntries(
          PRIORITY_ORDER.map((k) => [k, { ...priorities[k], days: priorities[k].days === '' ? null : priorities[k].days }])
        ),
      };
      const data = await api('/api/admin/settings/lists', { method: 'PUT', body });
      update(data);
      // Les nouvelles catégories reçoivent leur identifiant du serveur.
      setCategories((await api('/api/admin/settings')).categories);
      toast('Listes enregistrées');
    } catch (err) {
      setError(err.message);
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="panel p-5 sm:p-6" noValidate aria-labelledby="set-lists">
      <h2 id="set-lists" className="font-bold">
        Listes du ticket
      </h2>

      <h3 className="mt-5 text-sm font-semibold text-ink-soft">Catégories</h3>
      <p className="mt-0.5 text-xs text-ink-mute">
        Une catégorie désactivée n'est plus proposée, mais les tickets qui l'utilisent la gardent. Une catégorie supprimée de
        la liste est simplement désactivée si des tickets l'utilisent.
      </p>
      <ul className="mt-3 space-y-2">
        {categories.map((c, i) => (
          <li key={c.key || `new-${i}`} className="flex flex-wrap items-center gap-2">
            <input
              className="field max-w-xs flex-1"
              aria-label={`Nom de la catégorie ${i + 1}`}
              value={c.label}
              maxLength={40}
              onChange={(e) => setCat(i, { label: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="size-4" checked={c.active} onChange={(e) => setCat(i, { active: e.target.checked })} />
              Proposée
            </label>
            <span className="flex">
              <button type="button" className="btn btn-ghost px-2 py-1" disabled={i === 0} onClick={() => moveCat(i, -1)} aria-label={`Monter ${c.label}`}>
                <FiArrowUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1"
                disabled={i === categories.length - 1}
                onClick={() => moveCat(i, 1)}
                aria-label={`Descendre ${c.label}`}
              >
                <FiArrowDown aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 hover:text-danger"
                onClick={() => setCategories((list) => list.filter((_, j) => j !== i))}
                aria-label={`Supprimer ${c.label}`}
              >
                <FiTrash2 aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-secondary mt-3"
        onClick={() => setCategories((list) => [...list, { key: '', label: '', active: true }])}
      >
        <FiPlus aria-hidden="true" /> Ajouter une catégorie
      </button>

      <h3 className="mt-7 text-sm font-semibold text-ink-soft">Priorités</h3>
      <p className="mt-0.5 text-xs text-ink-mute">
        Toujours trois niveaux. Le délai remplit la date limite d'un nouveau ticket quand le demandeur n'en donne pas.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs text-ink-mute">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Niveau</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Nom</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Couleur</th>
              <th scope="col" className="py-1.5 font-semibold">Délai par défaut (jours)</th>
            </tr>
          </thead>
          <tbody>
            {PRIORITY_ORDER.map((k, i) => (
              <tr key={k}>
                <td className="py-1.5 pr-3 text-ink-mute">{['Le plus haut', 'Intermédiaire', 'Le plus bas'][i]}</td>
                <td className="py-1.5 pr-3">
                  <input
                    className="field"
                    aria-label={`Nom de la priorité ${i + 1}`}
                    value={priorities[k].label}
                    maxLength={30}
                    onChange={(e) => setPrio(k, { label: e.target.value })}
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <span className={`text-lg ${PRIORITY_COLORS[priorities[k].color]?.className}`} aria-hidden="true">
                      ●
                    </span>
                    <select
                      className="field py-1.5"
                      aria-label={`Couleur de la priorité ${i + 1}`}
                      value={priorities[k].color}
                      onChange={(e) => setPrio(k, { color: e.target.value })}
                    >
                      {Object.entries(PRIORITY_COLORS).map(([c, v]) => (
                        <option key={c} value={c}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td className="py-1.5">
                  <input
                    className="field max-w-28"
                    inputMode="numeric"
                    aria-label={`Délai par défaut de la priorité ${i + 1}, en jours`}
                    placeholder="Aucun"
                    value={priorities[k].days ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      setPrio(k, { days: v === '' ? '' : Number(v) });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer les listes'}
        </button>
      </div>
    </form>
  );
}

function AppearanceSection({ initial }) {
  const { settings, update } = useSettings();
  const [form, setForm] = useState({
    appName: initial.appName,
    primaryColor: initial.primaryColor,
    homeTitle: initial.homeTitle,
    homeText: initial.homeText,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const validHex = /^#[0-9a-f]{6}$/i.test(form.primaryColor);
  const shades = accentShades(validHex ? form.primaryColor : settings.primaryColor);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      update(await api('/api/admin/settings/appearance', { method: 'PUT', body: form }));
      toast('Apparence enregistrée');
    } catch (err) {
      setError(err.message);
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      update(await api('/api/admin/settings/logo', { method: 'POST', body: fd }));
      toast('Logo enregistré');
    } catch (err) {
      toastError(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    try {
      update(await api('/api/admin/settings/logo', { method: 'DELETE' }));
      toast('Logo retiré');
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <form onSubmit={save} className="panel p-5 sm:p-6" noValidate aria-labelledby="set-look">
      <h2 id="set-look" className="font-bold">
        Apparence
      </h2>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="space-y-4">
          <Field id="set-name" label="Nom de l'application" hint="Menu, onglet du navigateur et page d'accueil.">
            {(p) => <input {...p} className="field max-w-sm" value={form.appName} maxLength={30} onChange={(e) => set({ appName: e.target.value })} />}
          </Field>

          <Field id="set-color" label="Couleur principale" hint="Boutons, liens et onglets actifs. Une teinte foncée garde le texte blanc lisible.">
            {(p) => (
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Choisir la couleur"
                  className="h-10 w-12 cursor-pointer rounded-md border border-line-strong bg-white p-1"
                  value={validHex ? form.primaryColor : '#2f4bd8'}
                  onChange={(e) => set({ primaryColor: e.target.value })}
                />
                <input {...p} className="field max-w-32 font-mono" value={form.primaryColor} maxLength={7} onChange={(e) => set({ primaryColor: e.target.value })} />
              </span>
            )}
          </Field>

          <div>
            <p className="label">Logo</p>
            <div className="flex flex-wrap items-center gap-3">
              <img src={settings.logoSrc || '/favicon.svg'} alt="Logo actuel" className="size-12 rounded-md border border-line bg-white object-contain p-1" />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                id="set-logo"
                onChange={(e) => uploadLogo(e.target.files[0])}
              />
              <label htmlFor="set-logo" className="btn btn-secondary cursor-pointer">
                <FiUpload aria-hidden="true" /> {uploading ? 'Envoi…' : 'Changer le logo'}
              </label>
              {settings.logoSrc && (
                <button type="button" className="btn btn-ghost" onClick={removeLogo}>
                  Revenir au logo d'origine
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-mute">PNG, JPG ou WEBP, 512 Ko au plus. Une image carrée rend le mieux.</p>
          </div>

          <Field id="set-home-title" label="Titre de la page d'accueil" hint="Vu par les visiteurs non connectés. Vide : texte d'origine.">
            {(p) => <input {...p} className="field" value={form.homeTitle} maxLength={120} onChange={(e) => set({ homeTitle: e.target.value })} />}
          </Field>
          <Field id="set-home-text" label="Texte de la page d'accueil">
            {(p) => (
              <textarea {...p} rows={3} className="field" value={form.homeText} maxLength={600} onChange={(e) => set({ homeText: e.target.value })} />
            )}
          </Field>
        </div>

        <aside aria-label="Aperçu de la couleur" className="self-start rounded-lg border border-line bg-paper p-4">
          <p className="mb-3 text-xs font-semibold text-ink-mute">Aperçu</p>
          <p className="flex items-center gap-2 font-extrabold">
            <img src={settings.logoSrc || '/favicon.svg'} alt="" className="size-6 rounded object-contain" />
            {form.appName || 'Nom'}
          </p>
          <span className="mt-3 inline-flex rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: shades.accent }}>
            Nouveau ticket
          </span>
          <p className="mt-3 text-sm font-semibold" style={{ color: shades.accent }}>
            Un lien
          </p>
          <span className="mt-2 inline-flex rounded-md px-3 py-1.5 text-sm font-semibold" style={{ background: shades.soft, color: shades.strong }}>
            Onglet actif
          </span>
        </aside>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : "Enregistrer l'apparence"}
        </button>
      </div>
    </form>
  );
}

const RIGHT_COLUMNS = [
  { key: 'create', label: 'Créer', help: 'Faire une demande (ticket libre ou formulaire du catalogue).' },
  { key: 'work', label: 'Traiter', help: 'Prendre en charge et changer le statut des tickets visibles.' },
  { key: 'assign', label: 'Assigner', help: 'Choisir le responsable et transférer à un autre groupe.' },
  { key: 'edit', label: 'Modifier', help: 'Changer le titre, la description, la priorité et la catégorie de tickets qui ne sont pas les siens.' },
  { key: 'delete', label: 'Supprimer', help: 'Mettre des tickets à la corbeille.' },
];
const VIEW_LABELS = { own: 'Les siens', group: 'Ceux de son groupe', all: 'Tous' };

function AccessSection({ categories }) {
  const [access, setAccess] = useState(null);
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api('/api/admin/settings/access'), api('/api/groups')])
      .then(([a, g]) => {
        setAccess(a);
        setGroups(g);
      })
      .catch(setError);
  }, []);

  if (error) return <ErrorState error={error} />;
  if (!access || !groups) return <Spinner />;

  const setRow = (id, patch) =>
    setAccess((a) =>
      id === 'base' ? { ...a, base: { ...a.base, ...patch } } : { ...a, groups: { ...a.groups, [id]: { ...a.groups[id], ...patch } } }
    );
  const toggleCategory = (key, gid) =>
    setAccess((a) => {
      const list = a.categories[key] || [];
      const next = list.includes(gid) ? list.filter((x) => x !== gid) : [...list, gid];
      return { ...a, categories: { ...a.categories, [key]: next } };
    });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      setAccess(await api('/api/admin/settings/access', { method: 'PUT', body: access }));
      toast('Droits enregistrés');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const rows = [
    { id: 'base', name: 'Tous les utilisateurs', hint: 'Chaque compte, membre ou non d’un groupe', row: access.base },
    ...groups.map((g) => ({ id: g.id, name: g.name, hint: `${g.members.length} membre${g.members.length > 1 ? 's' : ''}`, row: access.groups[g.id] })),
  ];

  return (
    <form onSubmit={save} className="panel p-5 sm:p-6" noValidate aria-labelledby="set-access">
      <h2 id="set-access" className="font-bold">
        Droits et visibilité
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        Une personne cumule les droits de « Tous les utilisateurs » et ceux de ses groupes ; ils s'appliquent à tous les
        tickets qu'elle voit. L'auteur d'un ticket peut toujours le voir, le modifier et le commenter. Les administrateurs ont
        tous les droits, sauf sur les demandes confidentielles dont ils ne s'occupent pas.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="bg-paper text-xs text-ink-mute">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Qui</th>
              <th scope="col" className="px-3 py-2 font-semibold">Voit les tickets</th>
              {RIGHT_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-center font-semibold" title={c.help}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ id, name, hint, row }) => (
              <tr key={id}>
                <th scope="row" className="px-3 py-2.5 font-normal">
                  <span className="block font-semibold">{name}</span>
                  <span className="block text-xs text-ink-mute">{hint}</span>
                </th>
                <td className="px-3 py-2.5">
                  <select
                    className="field py-1.5"
                    aria-label={`Tickets visibles : ${name}`}
                    value={row.view}
                    onChange={(e) => setRow(id, { view: e.target.value })}
                  >
                    {(id === 'base' ? ['own', 'all'] : ['own', 'group', 'all']).map((v) => (
                      <option key={v} value={v}>
                        {VIEW_LABELS[v]}
                      </option>
                    ))}
                  </select>
                </td>
                {RIGHT_COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={`${c.label} : ${name}`}
                      checked={row[c.key]}
                      onChange={(e) => setRow(id, { [c.key]: e.target.checked })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-mute sm:grid-cols-2">
        <div>
          <dt className="inline font-semibold">Voit les tickets : </dt>
          <dd className="inline">
            les siens (créés ou assignés), ceux affectés à son groupe, ou tous sauf les catégories réservées à d'autres groupes.
          </dd>
        </div>
        {RIGHT_COLUMNS.map((c) => (
          <div key={c.key}>
            <dt className="inline font-semibold">{c.label} : </dt>
            <dd className="inline">{c.help}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-7 text-sm font-semibold text-ink-soft">Visibilité par catégorie</h3>
      <p className="mt-0.5 max-w-3xl text-xs text-ink-mute">
        Les groupes cochés voient tous les tickets de la catégorie, même ceux qui ne leur sont pas affectés. Une catégorie avec
        au moins un groupe coché est réservée : le droit « Tous » des autres groupes ne la montre plus.
      </p>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-ink-mute">Créez d'abord des groupes (onglet Groupes).</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {categories
            .filter((c) => c.active)
            .map((c) => {
              const chosen = access.categories[c.key] || [];
              return (
                <li key={c.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                  <span className="w-40 shrink-0 font-semibold">{c.label}</span>
                  <span className="flex flex-1 flex-wrap gap-1.5">
                    {groups.map((g) => (
                      <label
                        key={g.id}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                          chosen.includes(g.id) ? 'border-accent bg-accent-soft font-semibold text-accent-strong' : 'border-line-strong text-ink-soft'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5"
                          aria-label={`${c.label} visible par ${g.name}`}
                          checked={chosen.includes(g.id)}
                          onChange={() => toggleCategory(c.key, g.id)}
                        />
                        {g.name}
                      </label>
                    ))}
                  </span>
                  <span className="text-xs text-ink-mute">{chosen.length ? 'Réservée' : 'Sans restriction'}</span>
                </li>
              );
            })}
        </ul>
      )}

      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer les droits'}
        </button>
      </div>
    </form>
  );
}

function MailSection() {
  const [info, setInfo] = useState(null);
  const [appUrl, setAppUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = (d) => {
    setInfo(d);
    setAppUrl(d.settings.appUrl || '');
  };
  useEffect(() => {
    api('/api/admin/settings/mail').then(apply).catch(setError);
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!info) return <Spinner />;

  const save = async (patch) => {
    setBusy(true);
    try {
      apply(await api('/api/admin/settings/mail', { method: 'PUT', body: patch }));
      toast('Notifications enregistrées');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const sendTest = async () => {
    setBusy(true);
    try {
      const r = await api('/api/admin/settings/mail/test', { method: 'POST' });
      toast(`E-mail de test envoyé à ${r.to}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
      api('/api/admin/settings/mail').then(apply).catch(() => {});
    }
  };
  const suggested = typeof window !== 'undefined' ? window.location.origin : '';
  const { state } = info;

  return (
    <section className="panel space-y-4 p-5 sm:p-6" aria-labelledby="mail-title">
      <div>
        <h2 id="mail-title" className="font-bold">Notifications par e-mail</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Les e-mails partent de la boîte configurée dans le fichier xchange.env du serveur (SMTP_HOST, SMTP_USER, SMTP_PASSWORD). Le mot de passe n’apparaît jamais ici.
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-mute">État</dt>
        <dd>{info.configured ? `Configuré (${info.host})` : 'Non configuré : ajoutez les lignes SMTP dans xchange.env puis redémarrez'}</dd>
        {info.from && (
          <>
            <dt className="text-ink-mute">Expéditeur</dt>
            <dd>{info.from}</dd>
          </>
        )}
        <dt className="text-ink-mute">Dernier envoi</dt>
        <dd>{state.lastSentAt ? formatDateTime(state.lastSentAt) : 'aucun'}</dd>
        {state.lastError && state.lastErrorAt && (!state.lastSentAt || state.lastErrorAt > state.lastSentAt) && (
          <>
            <dt className="text-ink-mute">Dernière erreur</dt>
            <dd className="text-red-700">
              {formatDateTime(state.lastErrorAt)} : {state.lastError}
            </dd>
          </>
        )}
      </dl>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={info.settings.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} />
        Envoyer les notifications
      </label>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save({ appUrl });
        }}
      >
        <Field id="mail-appurl" label="Adresse publique d’Xchange (pour les liens dans les e-mails)">
          {(p) => <input {...p} className="field min-w-72" placeholder={suggested} value={appUrl} onChange={(e) => setAppUrl(e.target.value)} />}
        </Field>
        {!appUrl && suggested && (
          <button type="button" className="btn" onClick={() => setAppUrl(suggested)}>
            Utiliser {suggested}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Enregistrer
        </button>
      </form>
      <div>
        <button type="button" className="btn" onClick={sendTest} disabled={busy || !info.configured}>
          M’envoyer un e-mail de test
        </button>
      </div>
    </section>
  );
}

export default function SettingsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    api('/api/admin/settings').then(setData).catch(setError);
  };
  useEffect(load, []);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-6">
      <AccessSection categories={data.categories} />
      <MailSection />
      <ListsSection initial={data} />
      <AppearanceSection initial={data} />
    </div>
  );
}
