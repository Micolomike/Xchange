/** Fait télécharger un objet au format JSON lisible. */
export function saveJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFileName(data) {
  const name = String(data.account?.username || 'compte').replace(/[^a-z0-9._-]+/gi, '_');
  return `xchange-donnees-${name}-${String(data.exported_at || '').slice(0, 10)}.json`;
}
