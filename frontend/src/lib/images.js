import { api } from './api';

// Formats affichés directement (le SVG est refusé à l'envoi, il pourrait contenir du script).
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/** Vrai si la pièce jointe (ou le fichier choisi) est une image affichable. */
export function isImageAttachment(a) {
  if (!a) return false;
  const type = a.mime_type ?? a.type ?? '';
  return type ? IMAGE_TYPES.test(type) : IMAGE_EXT.test(a.name || '');
}

// Images déjà chargées (le fichier d'une pièce jointe ne change jamais) : une seule requête par image.
const cache = new Map();

export function loadImage(id) {
  if (!cache.has(id)) {
    const p = api(`/api/attachments/${id}`, { raw: true })
      .then((res) => res.blob())
      .then((blob) => URL.createObjectURL(blob));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return cache.get(id);
}

/** Libère l'image d'une pièce jointe retirée. */
export function forgetImage(id) {
  const p = cache.get(id);
  cache.delete(id);
  p?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
}
