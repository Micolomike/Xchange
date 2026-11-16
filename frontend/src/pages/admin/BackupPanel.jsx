import { useCallback, useEffect, useState } from 'react';
import { FiDownload, FiHardDrive, FiRefreshCw } from 'react-icons/fi';
import { api } from '../../lib/api';
import { toast, toastError } from '../../lib/notify';
import { Field, Spinner } from '../../components/ui';

function formatSize(bytes) {
  if (bytes == null) return '';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${units[i]}`;
}

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

/** Téléchargement dans le navigateur, avec choix de l'emplacement quand le navigateur le permet (Chrome, Edge). */
function DownloadCard() {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const name = `xchange_${stampNow()}.zip`;
    let handle = null;
    // La fenêtre « Enregistrer sous » doit s'ouvrir tout de suite après le clic, avant le téléchargement.
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Sauvegarde Xchange', accept: { 'application/zip': ['.zip'] } }],
        });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        handle = null;
      }
    }
    setBusy(true);
    try {
      const res = await api('/api/admin/backup/download', { raw: true });
      const blob = await res.blob();
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        toast(`Sauvegarde enregistrée : ${handle.name}`);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Sauvegarde téléchargée');
      }
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="backup-download-title">
      <h2 id="backup-download-title" className="font-bold">
        Télécharger une sauvegarde
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Une archive .zip avec la base (tickets, comptes, commentaires) et les pièces jointes. Sur Chrome ou Edge, vous choisissez
        où l'enregistrer : clé USB, disque externe ; ailleurs, elle va dans vos téléchargements.
      </p>
      <button type="button" className="btn btn-primary mt-4" onClick={download} disabled={busy}>
        <FiDownload aria-hidden="true" /> {busy ? 'Préparation…' : 'Télécharger la sauvegarde'}
      </button>
    </section>
  );
}

/** Écriture directe par le serveur sur un disque du PC qui héberge Xchange. */
function ServerCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [destination, setDestination] = useState('');
  const [folder, setFolder] = useState('Xchange-sauvegardes');
  const [folderError, setFolderError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api('/api/admin/backup/destinations')
      .then((d) => {
        setData(d);
        setDestination((current) =>
          d.destinations.some((x) => x.id === current) ? current : d.destinations.find((x) => !x.sameAsData)?.id || ''
        );
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const write = async (e) => {
    e.preventDefault();
    setFolderError(null);
    setBusy(true);
    try {
      const result = await api('/api/admin/backup/write', { method: 'POST', body: { destination, folder } });
      setLast(result);
      toast('Sauvegarde écrite sur le disque');
      load();
    } catch (err) {
      setFolderError(err.details?.folder || null);
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const chosen = data?.destinations.find((d) => d.id === destination);

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="backup-server-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="backup-server-title" className="font-bold">
            Enregistrer sur un disque du PC serveur
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Branchez la clé USB ou le disque externe sur le PC qui héberge Xchange, puis actualisez la liste.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load}>
          <FiRefreshCw aria-hidden="true" /> Actualiser
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error.message}
        </p>
      ) : !data ? (
        <Spinner label="Recherche des disques…" className="py-8" />
      ) : data.destinations.length === 0 ? (
        <p className="mt-4 rounded-md bg-paper px-4 py-3 text-sm text-ink-soft">
          Aucun disque disponible sur ce serveur. Utilisez le téléchargement ci-dessus.
        </p>
      ) : (
        <form onSubmit={write} className="mt-4 space-y-4" noValidate>
          <fieldset>
            <legend className="label">Disque</legend>
            <div className="space-y-2">
              {data.destinations.map((d) => (
                <label
                  key={d.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
                    destination === d.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="destination"
                    value={d.id}
                    checked={destination === d.id}
                    onChange={() => setDestination(d.id)}
                    className="size-4"
                  />
                  <FiHardDrive aria-hidden="true" className="shrink-0 text-ink-mute" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{d.label}</span>
                    <span className="block text-xs text-ink-mute">
                      {d.free != null ? `${formatSize(d.free)} libres sur ${formatSize(d.total)}` : 'Espace libre inconnu'}
                      {d.sameAsData && ', sur le même disque que les données'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {chosen?.sameAsData && (
            <p className="rounded-md bg-progress-soft px-3 py-2 text-sm text-progress">
              Ce disque contient déjà Xchange : si le disque tombe en panne, la sauvegarde est perdue avec lui. Préférez une
              clé USB ou un disque externe.
            </p>
          )}
          <Field id="backup-folder" label="Dossier" error={folderError} hint="Créé s'il n'existe pas, à la racine du disque.">
            {(p) => (
              <input {...p} className="field max-w-sm" value={folder} onChange={(e) => setFolder(e.target.value)} />
            )}
          </Field>
          <button type="submit" className="btn btn-primary" disabled={busy || !destination || !folder.trim()}>
            {busy ? 'Écriture…' : 'Enregistrer la sauvegarde'}
          </button>
          {last && (
            <p role="status" className="rounded-md bg-resolved-soft px-3 py-2 text-sm text-resolved">
              Sauvegarde écrite : <span className="break-all font-mono">{last.path}</span> ({formatSize(last.size)})
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function formatWhen(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Sauvegarde automatique faite chaque jour par Xchange (uniquement quand il est hébergé sur un PC). */
function ScheduleCard() {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [probe, setProbe] = useState(null);

  const apply = (data) => {
    setInfo(data);
    setForm({ ...data.settings });
  };
  const load = useCallback(() => {
    setError(null);
    api('/api/admin/backup/schedule').then(apply).catch(setError);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="panel px-5 py-4 text-sm text-danger">
        {error.message}
      </p>
    );
  }
  if (!info) return <Spinner label="Chargement des réglages…" className="py-8" />;
  if (!info.available) {
    return (
      <section className="panel p-5 sm:p-6">
        <h2 className="font-bold">Sauvegarde automatique</h2>
        <p className="mt-1 text-sm text-ink-mute">Non disponible sur ce serveur : elle fonctionne quand Xchange est hébergé sur un PC.</p>
      </section>
    );
  }

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setFieldErrors({});
    if ('copyDir' in patch) setProbe(null);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      apply(await api('/api/admin/backup/schedule', { method: 'PUT', body: { ...form, keep: Number(form.keep) } }));
      toast('Réglages des sauvegardes enregistrés');
    } catch (err) {
      setFieldErrors(err.details || {});
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const data = await api('/api/admin/backup/run', { method: 'POST' });
      setInfo(data);
      if (data.state.lastStatus === 'ok' && data.state.copyStatus !== 'error') toast('Sauvegarde faite');
      else toastError({ message: data.state.lastError || data.state.copyError });
    } catch (err) {
      toastError(err);
    } finally {
      setRunning(false);
    }
  };

  const testDir = async () => {
    setProbe(null);
    try {
      setProbe(await api('/api/admin/backup/test-dir', { method: 'POST', body: { dir: form.copyDir } }));
    } catch (err) {
      setProbe({ ok: false, message: err.message });
    }
  };

  const { state } = info;

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="backup-auto-title">
      <h2 id="backup-auto-title" className="font-bold">
        Sauvegarde automatique
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Chaque jour, Xchange copie la base et les pièces jointes dans <span className="font-mono text-xs">{info.directory}</span>. Si
        le PC était éteint à l'heure prévue, la sauvegarde est faite à son redémarrage.
      </p>

      <dl className="mt-4 grid gap-3 rounded-md bg-paper px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-ink-mute">Dernière sauvegarde</dt>
          <dd>
            {!state.lastRunAt ? (
              <span className="text-ink-mute">Pas encore faite par Xchange</span>
            ) : state.lastStatus === 'ok' ? (
              <span className="text-resolved">Réussie, {formatWhen(state.lastRunAt)}</span>
            ) : (
              <span className="text-danger">Échec, {formatWhen(state.lastRunAt)} : {state.lastError}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-mute">Prochaine</dt>
          <dd>{info.nextRun ? formatWhen(info.nextRun) : <span className="text-ink-mute">Désactivée</span>}</dd>
        </div>
        {state.copyStatus && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-ink-mute">Dernière copie vers l'autre disque</dt>
            <dd>
              {state.copyStatus === 'ok' ? (
                <span className="break-all text-resolved">Réussie : {state.copyFile}</span>
              ) : (
                <span className="text-danger">Échec : {state.copyError}</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      <form onSubmit={save} className="mt-5 space-y-4" noValidate>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Sauvegarder automatiquement chaque jour
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="backup-time" label="Heure" error={fieldErrors.time}>
            {(p) => <input {...p} type="time" className="field max-w-40" value={form.time} onChange={(e) => set({ time: e.target.value })} />}
          </Field>
          <Field id="backup-keep" label="Nombre de sauvegardes gardées" error={fieldErrors.keep} hint="Les plus anciennes sont supprimées au-delà.">
            {(p) => (
              <input
                {...p}
                inputMode="numeric"
                className="field max-w-28"
                value={form.keep}
                onChange={(e) => set({ keep: e.target.value.replace(/\D/g, '') })}
              />
            )}
          </Field>
        </div>
        <Field
          id="backup-copy"
          label="Copier aussi dans ce dossier (autre disque)"
          error={fieldErrors.copyDir}
          hint="Par exemple D:\Xchange-sauvegardes. Une archive .zip complète y est écrite à chaque sauvegarde. Vide : pas de copie."
        >
          {(p) => (
            <span className="flex flex-wrap gap-2">
              <input
                {...p}
                className="field max-w-md flex-1 font-mono text-sm"
                placeholder="D:\Xchange-sauvegardes"
                value={form.copyDir}
                onChange={(e) => set({ copyDir: e.target.value })}
              />
              <button type="button" className="btn btn-secondary" onClick={testDir} disabled={!form.copyDir.trim()}>
                Tester l'écriture
              </button>
            </span>
          )}
        </Field>
        {probe && (
          <p role="status" className={`rounded-md px-3 py-2 text-sm ${probe.ok ? 'bg-resolved-soft text-resolved' : 'bg-danger-soft text-danger'}`}>
            {probe.message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={runNow} disabled={running}>
            {running ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function BackupPanel() {
  return (
    <div className="space-y-6">
      <ScheduleCard />
      <DownloadCard />
      <ServerCard />
      <p className="text-sm text-ink-mute">
        Pour remettre Xchange dans l'état d'une sauvegarde, utilisez le script restaurer.ps1 sur le PC serveur (voir le guide).
      </p>
    </div>
  );
}
