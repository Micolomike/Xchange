import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiHelpCircle, FiX } from 'react-icons/fi';
import { useAuth } from '../auth/context';
import { api } from '../lib/api';
import { toastError } from '../lib/notify';

/**
 * Assistant guidé : la personne décrit son besoin, l'assistant propose des réponses aux questions
 * fréquentes et les formulaires du catalogue les plus proches. Rien ne quitte le serveur d'Xchange.
 */
export default function AssistantWidget() {
  const { user, canCreate } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [missSent, setMissSent] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!user || location.pathname.startsWith('/discussions')) return null;

  const search = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setMissSent(false);
    try {
      setResult(await api('/api/assistant/search', { query: { q: text.trim() } }));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const go = (path, prefill) => {
    setOpen(false);
    navigate(path, prefill ? { state: { prefill } } : undefined);
  };

  const nothingFits = async () => {
    setMissSent(true);
    api('/api/assistant/miss', { method: 'POST', body: { q: text.trim() } }).catch(() => {});
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-3 font-semibold text-white shadow-lg hover:bg-accent-hover"
        >
          <FiHelpCircle aria-hidden="true" className="text-lg" /> Besoin d’aide ?
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-labelledby="assistant-title"
          className="fixed bottom-5 right-5 z-40 flex max-h-[min(640px,calc(100vh-2.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 id="assistant-title" className="font-bold">
              Assistant
            </h2>
            <button type="button" className="btn btn-ghost px-2" onClick={() => setOpen(false)} aria-label="Fermer l’assistant">
              <FiX aria-hidden="true" />
            </button>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <form onSubmit={search} className="space-y-2">
              <label htmlFor="assistant-q" className="text-sm text-ink-soft">
                Décrivez votre besoin ou votre question en quelques mots.
              </label>
              <textarea
                id="assistant-q"
                ref={inputRef}
                rows={3}
                maxLength={300}
                className="field resize-none"
                placeholder="Exemple : mon wifi ne marche plus"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) search(e);
                }}
              />
              <button type="submit" className="btn btn-primary w-full" disabled={busy || !text.trim()}>
                {busy ? 'Recherche…' : 'Chercher'}
              </button>
            </form>

            {result && (
              <div className="space-y-4" aria-live="polite">
                {result.faq.length > 0 && (
                  <div className="space-y-2">
                    {result.faq.map((f) => (
                      <article key={f.question} className="rounded-md bg-paper p-3 text-sm">
                        <h3 className="font-semibold">{f.question}</h3>
                        <p className="mt-1 text-ink-soft">{f.answer}</p>
                        {f.link && (
                          <Link to={f.link} onClick={() => setOpen(false)} className="mt-2 inline-flex items-center gap-1 font-semibold text-accent-strong hover:underline">
                            Y aller <FiArrowRight aria-hidden="true" />
                          </Link>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {result.forms.length > 0 && canCreate && (
                  <div>
                    <h3 className="text-sm font-semibold">Formulaires qui peuvent convenir</h3>
                    <ul className="mt-2 space-y-2">
                      {result.forms.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => go(`/catalogue/${f.id}`, text.trim())}
                            className="w-full rounded-md border border-line px-3 py-2 text-left hover:border-accent hover:bg-accent-soft"
                          >
                            <span className="block font-semibold">{f.name}</span>
                            {f.description && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-mute">{f.description}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-ink-mute">Votre texte sera repris dans le formulaire.</p>
                  </div>
                )}
                {!result.faq.length && !result.forms.length && (
                  <p className="text-sm text-ink-soft">Je n’ai rien trouvé qui corresponde. Vous pouvez faire une demande libre : elle sera lue par un administrateur.</p>
                )}
                {canCreate && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <button type="button" className="btn btn-secondary w-full" onClick={() => go('/tickets/new', text.trim())}>
                      Faire une demande libre avec ce texte
                    </button>
                    {(result.faq.length > 0 || result.forms.length > 0) && !missSent && (
                      <button type="button" className="w-full text-center text-xs text-ink-mute underline hover:text-ink" onClick={nothingFits}>
                        Aucune proposition ne convient
                      </button>
                    )}
                    {missSent && <p className="text-center text-xs text-ink-mute">Merci, c’est noté pour améliorer l’assistant.</p>}
                  </div>
                )}
              </div>
            )}
          </div>
          <footer className="border-t border-line px-4 py-2 text-xs text-ink-mute">
            Assistant automatique, sans intelligence artificielle. Les besoins qu’il ne trouve pas sont gardés sans votre nom pour l’améliorer.
          </footer>
        </section>
      )}
    </>
  );
}
