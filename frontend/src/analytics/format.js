const nf = (d = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Nombre au format français (espaces des milliers, virgule). */
export const fmt = (v, d = 0) => (v == null ? '-' : nf(d).format(v));

/** Couleur de série n° i (8 couleurs dans un ordre fixe, voir index.css). */
export const seriesColor = (i) => `var(--series-${(i % 8) + 1})`;
