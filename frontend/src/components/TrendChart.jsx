import { useEffect, useRef, useState } from 'react';

const SERIES = [
  { key: 'created', label: 'Créés', color: '#2f4bd8' },
  { key: 'resolved', label: 'Résolus', color: '#1f7a4d' },
];

const H = 170;
const PAD = { top: 10, right: 6, bottom: 24, left: 26 };
const GAP = 2; // espace entre les deux colonnes d'un même jour
const FONT = 11;

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const asDate = (iso) => new Date(`${iso}T12:00:00`);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Colonne à extrémité arrondie (4 px), carrée sur la ligne de base. */
function columnPath(x, y, w, h) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const step = v <= 10 ? 2 : v <= 25 ? 5 : 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

/** Tickets créés et résolus par jour sur les 14 derniers jours. */
export default function TrendChart({ data }) {
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(360);
  const boxRef = useRef(null);

  // Le SVG est dessiné à la taille réelle du conteneur : le texte garde 11 px quelle que soit la largeur.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.created, d.resolved])));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const BAR = Math.max(3, Math.min(10, (band - 4 - GAP) / 2)); // colonnes fines, jamais plus de 24 px
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </figcaption>
      <div className="relative" ref={boxRef}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label="Tickets créés et résolus par jour, 14 derniers jours">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e6e9ee" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={FONT} fill="#626e7d">
                {Number.isInteger(t) ? t : ''}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const groupW = BAR * 2 + GAP;
            return (
              <g key={d.date}>
                {hover === i && (
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} fill="#2f4bd8" opacity="0.06" />
                )}
                {SERIES.map((s, si) => {
                  const v = d[s.key];
                  if (!v) return null;
                  const x = cx - groupW / 2 + si * (BAR + GAP);
                  return <path key={s.key} d={columnPath(x, y(v), BAR, y(0) - y(v))} fill={s.color} />;
                })}
                {(i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={FONT} fill="#626e7d">
                    {dayFmt.format(asDate(d.date))}
                  </text>
                )}
                <rect
                  x={PAD.left + band * i}
                  y={0}
                  width={band}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${longFmt.format(asDate(d.date))} : ${d.created} créé(s), ${d.resolved} résolu(s)`}
                />
              </g>
            );
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#c5ccd6" strokeWidth="1" />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-md"
            style={{ left: `${Math.min(82, Math.max(18, ((PAD.left + band * hover + band / 2) / W) * 100))}%` }}
          >
            <p className="mb-1 font-semibold text-ink">{capitalize(longFmt.format(asDate(data[hover].date)))}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-ink-soft">
                <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                {s.label} : <span className="font-semibold text-ink">{data[hover][s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Tickets créés et résolus par jour</caption>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Créés</th>
            <th scope="col">Résolus</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <th scope="row">{longFmt.format(asDate(d.date))}</th>
              <td>{d.created}</td>
              <td>{d.resolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
