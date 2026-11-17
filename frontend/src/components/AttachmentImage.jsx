import { useEffect, useState } from 'react';
import { FiDownload, FiImage } from 'react-icons/fi';
import { loadImage } from '../lib/images';
import Modal from './Modal';

function useImage(attachment) {
  const [state, setState] = useState({ id: null, url: null, failed: false });
  const id = attachment?.id;
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    loadImage(id)
      .then((url) => alive && setState({ id, url, failed: false }))
      .catch(() => alive && setState({ id, url: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [id]);
  return state.id === id ? state : { url: null, failed: false };
}

/** Vignette cliquable d'une image jointe. */
export function ImageThumb({ attachment, onOpen, className = '', natural = false }) {
  const { url, failed } = useImage(attachment);
  return (
    <button
      type="button"
      onClick={() => onOpen(attachment)}
      className={`group relative block overflow-hidden rounded-md border border-line bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
      aria-label={`Agrandir l'image ${attachment.name}`}
      title={attachment.name}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          className={`block transition-opacity group-hover:opacity-90 ${natural ? 'max-h-80 w-auto max-w-full' : 'h-full w-full object-cover'}`}
        />
      ) : (
        <span className={`flex ${natural ? 'h-48 w-64 max-w-full' : 'h-full min-h-16 w-full'} items-center justify-center text-ink-mute ${failed ? '' : 'animate-pulse'}`}>
          <FiImage aria-hidden="true" />
          {failed && <span className="ml-1 text-xs">Image indisponible</span>}
        </span>
      )}
    </button>
  );
}

/** Image affichée en grand, avec téléchargement. */
export function ImageViewer({ attachment, onClose, onDownload }) {
  const { url } = useImage(attachment);
  return (
    <Modal
      open={Boolean(attachment)}
      onClose={onClose}
      title={attachment?.name}
      labelId="image-viewer-title"
      size="lg"
      footer={
        attachment && (
          <button type="button" className="btn btn-secondary" onClick={() => onDownload(attachment)}>
            <FiDownload aria-hidden="true" /> Télécharger
          </button>
        )
      }
    >
      {url ? (
        <img src={url} alt={attachment?.name || ''} className="mx-auto block max-h-[70dvh] max-w-full rounded-md object-contain" />
      ) : (
        <div className="flex h-64 items-center justify-center text-ink-mute">
          <FiImage aria-hidden="true" className="animate-pulse text-2xl" />
        </div>
      )}
    </Modal>
  );
}

