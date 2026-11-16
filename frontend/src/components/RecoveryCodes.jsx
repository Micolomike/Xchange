import { FiCopy, FiDownload } from 'react-icons/fi';
import { toast, toastError } from '../lib/notify';

/** Liste des codes de secours, à télécharger ou copier ; chacun ne sert qu'une fois. */
export default function RecoveryCodes({ codes, username }) {
  const text = [
    `Codes de secours Xchange pour ${username}`,
    `Créés le ${new Date().toLocaleString('fr-FR')}`,
    '',
    "Chaque code permet une seule connexion si vous n'avez plus accès à votre appli d'authentification.",
    '',
    ...codes,
    '',
  ].join('\r\n');

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `xchange-codes-de-secours-${username}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Codes copiés');
    } catch {
      toastError({ message: 'Copie impossible ici : utilisez le téléchargement.' });
    }
  };

  return (
    <div>
      <ul
        aria-label="Codes de secours"
        className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line bg-paper px-5 py-4 font-mono text-[0.95rem] tracking-wide text-ink"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={download}>
          <FiDownload aria-hidden="true" /> Télécharger (.txt)
        </button>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          <FiCopy aria-hidden="true" /> Copier
        </button>
      </div>
    </div>
  );
}
