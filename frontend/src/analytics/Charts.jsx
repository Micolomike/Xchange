import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, seriesColor } from './format';
import { FiArrowDownRight, FiArrowUpRight, FiBarChart2, FiList, FiMinus } from 'react-icons/fi';

/*
 * Graphiques des Analyses, dessinés en SVG :
 * - couleurs de séries dans un ordre fixe (--series-1 à 8), une couleur suit toujours la même valeur
 *   (statut, priorité) ;
 * - traits fins, barres plafonnées à 24 px, extrémités arrondies, 2 px d'espace entre segments ;
 * - info-bulle au survol, légende dès deux séries, et une vue en tableau pour tout graphique.
 */

const SERIES_MAX = 8;
const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITY_ORDER = ['high', 'medium', 'low'];


/** Couleur d'une valeur : fixe pour les statuts et priorités, sinon selon sa place. */
function colorIndex(dimension, key, i) {
  if (dimension === 'status' && STATUS_ORDER.includes(key)) return STATUS_ORDER.indexOf(key);
  if (dimension === 'priority' && PRIORITY_ORDER.includes(key)) return [7, 1, 0][PRIORITY_ORDER.indexOf(key)];
  if (dimension === 'trend') return key === 'resolved' ? 2 : 0;
  if (dimension === 'sla_state' || dimension === 'sla_response_state') {
    // Respecté : vert ; dans les temps : bleu ; à risque : jaune ; dépassé : rouge ; non respecté : orange ; sans engagement : violet.
    const map = { met: 5, running: 0, at_risk: 3, breached: 7, missed: 1, none: 6 };
    if (key in map) return map[key];
  }
  return i;
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Graduations « propres » de 0 au maximum. */
function niceTicks(max, count = 4) {
  if (!max || max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
const compact = (v) => (v >= 10000 ? `${fmt(v / 1000)} k` : fmt(v, v % 1 ? 1 : 0));

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y, transform: `translate(${tip.flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}
    >
      <p className="mb-1 font-semibold text-ink">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-ink-soft">
          {r.color && <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.color }} aria-hidden="true" />}
          <span className="flex-1">{r.label}</span>
          <span className="font-semibold tabular-nums text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }) {
  if (items.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Légende">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Regroupe les séries au-delà de 8 dans « Autres » (une couleur n'est jamais inventée). */
function foldSeries(series) {
  if (series.length <= SERIES_MAX) return series;
  const kept = series.slice(0, SERIES_MAX - 1);
  const rest = series.slice(SERIES_MAX - 1);
  return [...kept, { key: '__other', label: 'Autres', values: rest[0].values.map((_, i) => rest.reduce((n, s) => n + (s.values[i] || 0), 0)) }];
}

const barPath = (x, y, w, h, horizontal, r = 4) => {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, horizontal ? h / 2 : w / 2, horizontal ? w : h);
  // Extrémité arrondie côté valeur, carrée côté ligne de base.
  if (horizontal) return `M${x},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z`;
  return `M${x},${y + h} v-${h - rr} a${rr},${rr} 0 0 1 ${rr},-${rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - rr} z`;
};

/** Barres verticales (simples, groupées ou empilées). */
function Columns({ categories, series, stacked, height, decimals, colors, single = false, unit = '' }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState(null);
  const left = 40;
  const bottom = 26;
  const top = 8;
  const plotW = Math.max(0, width - left - 8);
  const plotH = height - top - bottom;
  const totals = categories.map((_, i) => series.reduce((n, s) => n + (s.values[i] || 0), 0));
  const max = stacked ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0)));
  const ticks = niceTicks(max);
  const top_ = ticks[ticks.length - 1] || 1;
  const band = categories.length ? plotW / categories.length : 0;
  const groups = stacked ? 1 : series.length;
  const barW = Math.min(24, Math.max(2, (band * 0.7) / groups - (groups > 1 ? 2 : 0)));
  const y = (v) => top + plotH - (v / top_) * plotH;
  const labelEvery = Math.max(1, Math.ceil((categories.length * 56) / Math.max(plotW, 1)));
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Graphique en barres">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 8} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-mute text-[11px] tabular-nums">
                {compact(t)}
              </text>
            </g>
          ))}
          {categories.map((c, i) => {
            const cx = left + band * i + band / 2;
            const totalW = stacked ? barW : groups * barW + (groups - 1) * 2;
            let acc = 0;
            return (
              <g key={`${c.key}-${i}`}>
                {series.map((s, si) => {
                  const v = s.values[i] || 0;
                  const h = (v / top_) * plotH;
                  const x = stacked ? cx - barW / 2 : cx - totalW / 2 + si * (barW + 2);
                  const yy = stacked ? y(acc + v) : y(v);
                  acc += v;
                  const lastVisible = stacked ? series.slice(si + 1).every((o) => !(o.values[i] || 0)) : true;
                  return (
                    lastVisible && h > 0 ? <path key={s.key} d={barPath(x, yy, barW, h, false)} fill={colors[si]} /> : null
                  );
                })}
                {stacked &&
                  (() => {
                    // Segments empilés intérieurs : rectangles séparés de 2 px (fond), sommet arrondi par le dernier.
                    let a = 0;
                    return series.map((s, si) => {
                      const v = s.values[i] || 0;
                      const h = (v / top_) * plotH;
                      const yy = y(a + v);
                      a += v;
                      const lastVisible = series.slice(si + 1).every((o) => !(o.values[i] || 0));
                      if (lastVisible || h <= 0) return null;
                      return <rect key={`r-${s.key}`} x={cx - barW / 2} y={yy + 1} width={barW} height={Math.max(0, h - 2)} fill={colors[si]} />;
                    });
                  })()}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="fill-ink-mute text-[11px]">
                    {c.label.length > 14 ? `${c.label.slice(0, 13)}…` : c.label}
                  </text>
                )}
                <rect
                  x={left + band * i}
                  y={top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseMove={(e) => {
                    const box = ref.current.getBoundingClientRect();
                    const px = e.clientX - box.left;
                    setTip({
                      x: px,
                      y: e.clientY - box.top,
                      flip: px > width / 2,
                      title: c.label,
                      rows: single
                        ? [{ label: 'Valeur', value: `${fmt(series[i].values[i], decimals)}${unit}`, color: colors[i] }]
                        : series.map((s, si) => ({ label: s.label, value: `${fmt(s.values[i], decimals)}${unit}`, color: colors[si] })),
                    });
                  }}
                />
              </g>
            );
          })}
          <line x1={left} x2={width - 8} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth="1" />
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** Barres horizontales : libellés longs (catégories, groupes, personnes). Valeur en bout de barre. */
function HBars({ categories, series, stacked, decimals, colors, maxHeight, unit = '' }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState(null);
  const row = 30;
  const labelW = Math.min(170, Math.max(90, width * 0.32));
  const valueW = 48;
  const plotW = Math.max(0, width - labelW - valueW - 8);
  const totals = categories.map((_, i) => series.reduce((n, s) => n + (s.values[i] || 0), 0));
  const max = Math.max(1, ...(stacked ? totals : series.flatMap((s) => s.values.map((v) => v || 0))));
  const height = categories.length * row + 4;
  const barH = Math.min(18, row - 10);
  return (
    <div ref={ref} className="relative overflow-y-auto" style={{ maxHeight }} onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Graphique en barres horizontales">
          {categories.map((c, i) => {
            const yy = i * row + (row - barH) / 2;
            let acc = 0;
            const value = stacked || series.length === 1 ? totals[i] : null;
            return (
              <g key={`${c.key}-${i}`}>
                <text x={labelW - 8} y={yy + barH / 2} dy="0.32em" textAnchor="end" className="fill-ink-soft text-xs">
                  {c.label.length > 24 ? `${c.label.slice(0, 23)}…` : c.label}
                </text>
                {series.map((s, si) => {
                  const v = s.values[i] || 0;
                  const w = (v / max) * plotW;
                  const x = labelW + (stacked ? (acc / max) * plotW : 0);
                  acc += v;
                  if (w <= 0) return null;
                  const last = !stacked || series.slice(si + 1).every((o) => !(o.values[i] || 0));
                  const gap = stacked && !last ? 2 : 0;
                  return last ? (
                    <path key={s.key} d={barPath(x, yy + (stacked ? 0 : (si * barH) / series.length), w, stacked ? barH : barH / series.length, true)} fill={colors[si]} />
                  ) : (
                    <rect key={s.key} x={x} y={yy} width={Math.max(0, w - gap)} height={barH} fill={colors[si]} />
                  );
                })}
                {value != null && (
                  <text x={labelW + ((stacked ? totals[i] : series[0].values[i] || 0) / max) * plotW + 6} y={yy + barH / 2} dy="0.32em" className="fill-ink text-xs font-semibold tabular-nums">
                    {fmt(value, decimals)}
                    {unit}
                  </text>
                )}
                <rect
                  x={0}
                  y={i * row}
                  width={width}
                  height={row}
                  fill="transparent"
                  onMouseMove={(e) => {
                    const box = ref.current.getBoundingClientRect();
                    const px = e.clientX - box.left;
                    setTip({
                      x: px,
                      y: e.clientY - box.top,
                      flip: px > width / 2,
                      title: c.label,
                      rows: series.map((s, si) => ({ label: s.label, value: `${fmt(s.values[i], decimals)}${unit}`, color: colors[si] })),
                    });
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** Courbes (ou aires) dans le temps, avec un repère vertical au survol. */
function Lines({ categories, series, area, height, colors, unit = '', decimals = 0 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const left = 40;
  const bottom = 26;
  const top = 10;
  const plotW = Math.max(0, width - left - 12);
  const plotH = height - top - bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v != null)));
  const ticks = niceTicks(max);
  const top_ = ticks[ticks.length - 1] || 1;
  const n = categories.length;
  const x = (i) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => top + plotH - (v / top_) * plotH;
  const labelEvery = Math.max(1, Math.ceil((n * 60) / Math.max(plotW, 1)));
  const onMove = (e) => {
    const box = ref.current.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - left) / Math.max(plotW, 1)) * (n - 1))));
    setHover({ i, y: e.clientY - box.top });
  };
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label="Courbe dans le temps" onMouseMove={onMove}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 12} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-mute text-[11px] tabular-nums">
                {compact(t)}
              </text>
            </g>
          ))}
          {categories.map((c, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={c.key} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-ink-mute text-[11px]">
                {i === n - 1 || (n - 1 - i) / labelEvery >= 1 ? c.label : ''}
              </text>
            ) : null
          )}
          {series.map((s, si) => {
            // Une valeur absente (période sans données) coupe la courbe au lieu de la faire tomber à zéro.
            const segments = [];
            let cur = [];
            s.values.forEach((v, i) => {
              if (v == null) {
                if (cur.length) segments.push(cur);
                cur = [];
              } else cur.push([x(i), y(v)]);
            });
            if (cur.length) segments.push(cur);
            const lastIndex = s.values.findLastIndex((v) => v != null);
            return (
              <g key={s.key}>
                {segments.map((seg, k) => {
                  const pts = seg.map((p) => p.join(',')).join(' ');
                  return (
                    <g key={k}>
                      {area && seg.length > 1 && <polygon points={`${seg[0][0]},${y(0)} ${pts} ${seg[seg.length - 1][0]},${y(0)}`} fill={colors[si]} opacity="0.1" />}
                      {seg.length > 1 ? (
                        <polyline points={pts} fill="none" stroke={colors[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                      ) : (
                        <circle cx={seg[0][0]} cy={seg[0][1]} r="3" fill={colors[si]} />
                      )}
                    </g>
                  );
                })}
                {lastIndex >= 0 && <circle cx={x(lastIndex)} cy={y(s.values[lastIndex])} r="4" fill={colors[si]} stroke="var(--color-surface)" strokeWidth="2" />}
              </g>
            );
          })}
          <line x1={left} x2={width - 12} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth="1" />
          {hover && (
            <g>
              <line x1={x(hover.i)} x2={x(hover.i)} y1={top} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth="1" />
              {series.map((s, si) =>
                s.values[hover.i] == null ? null : (
                  <circle key={s.key} cx={x(hover.i)} cy={y(s.values[hover.i])} r="4.5" fill={colors[si]} stroke="var(--color-surface)" strokeWidth="2" />
                )
              )}
            </g>
          )}
        </svg>
      )}
      {hover && (
        <Tooltip
          tip={{
            x: x(hover.i),
            y: hover.y,
            flip: x(hover.i) > width / 2,
            title: categories[hover.i].label,
            rows: series.map((s, si) => ({ label: s.label, value: s.values[hover.i] == null ? 'Aucune donnée' : `${fmt(s.values[hover.i], decimals)}${unit}`, color: colors[si] })),
          }}
        />
      )}
    </div>
  );
}

/** Anneau : la part de chaque valeur, total au centre. 8 parts au plus. */
function Donut({ categories, values, colors, height, decimals }) {
  const [tip, setTip] = useState(null);
  const size = Math.min(height, 200);
  const r = size / 2 - 4;
  const inner = r * 0.62;
  const total = values.reduce((a, b) => a + (b || 0), 0);
  let angle = -Math.PI / 2;
  const pad = values.filter((v) => v > 0).length > 1 ? 0.012 : 0;
  const arcs = values.map((v, i) => {
    const a = total ? ((v || 0) / total) * Math.PI * 2 : 0;
    const start = angle + pad;
    const end = angle + a - pad;
    angle += a;
    if (a <= 0) return null;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${size / 2 + rad * Math.cos(ang)},${size / 2 + rad * Math.sin(ang)}`;
    const d =
      a >= Math.PI * 2 - 0.001
        ? `M${p(r, 0)} A${r},${r} 0 1 1 ${p(r, Math.PI)} A${r},${r} 0 1 1 ${p(r, 0)} M${p(inner, 0)} A${inner},${inner} 0 1 0 ${p(inner, Math.PI)} A${inner},${inner} 0 1 0 ${p(inner, 0)} Z`
        : `M${p(r, start)} A${r},${r} 0 ${large} 1 ${p(r, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z`;
    return { d, i, v };
  });
  return (
    <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3" onMouseLeave={() => setTip(null)}>
      <svg width={size} height={size} role="img" aria-label="Graphique en anneau" className="shrink-0">
        {arcs.map(
          (a) =>
            a && (
              <path
                key={a.i}
                d={a.d}
                fill={colors[a.i]}
                fillRule="evenodd"
                onMouseMove={(e) => {
                  const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                  setTip({
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                    title: categories[a.i].label,
                    rows: [{ label: 'Valeur', value: fmt(a.v, decimals) }, { label: 'Part', value: `${fmt(total ? (a.v / total) * 100 : 0, 1)} %` }],
                  });
                }}
              />
            )
        )}
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="fill-ink text-xl font-bold tabular-nums">
          {fmt(total, decimals)}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" className="fill-ink-mute text-[11px]">
          au total
        </text>
      </svg>
      <ul className="min-w-[11rem] flex-1 space-y-1 text-xs" aria-label="Légende">
        {categories.map((c, i) => (
          <li key={`${c.key}-${i}`} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{c.label}</span>
            <span className="font-semibold tabular-nums text-ink">{fmt(values[i], decimals)}</span>
            <span className="w-12 whitespace-nowrap text-right tabular-nums text-ink-mute">{total ? `${fmt(((values[i] || 0) / total) * 100)} %` : ''}</span>
          </li>
        ))}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Carte de chaleur jour × heure : une seule teinte, du clair au foncé. */
function Heatmap({ result }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState(null);
  const labelW = 64;
  const cell = Math.max(8, Math.min(28, (width - labelW) / 24));
  const gap = 2;
  return (
    <div ref={ref} className="relative overflow-x-auto" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={labelW + 24 * cell} height={7 * cell + 20} role="img" aria-label="Carte de chaleur des créations par jour et par heure">
          {result.rows.map((day, r) => (
            <g key={day}>
              <text x={labelW - 6} y={r * cell + cell / 2} dy="0.32em" textAnchor="end" className="fill-ink-mute text-[11px]">
                {day.slice(0, 3)}.
              </text>
              {result.values[r].map((v, h) => (
                <rect
                  key={h}
                  x={labelW + h * cell}
                  y={r * cell}
                  width={cell - gap}
                  height={cell - gap}
                  rx="2"
                  fill={v ? 'var(--series-1)' : 'var(--chart-grid)'}
                  opacity={v ? 0.18 + 0.82 * (v / (result.max || 1)) : 1}
                  onMouseMove={(e) => {
                    const box = ref.current.getBoundingClientRect();
                    const px = e.clientX - box.left;
                    setTip({ x: px, y: e.clientY - box.top, flip: px > width / 2, title: `${day}, ${h} h à ${h + 1} h`, rows: [{ label: 'Demandes créées', value: fmt(v) }] });
                  }}
                />
              ))}
            </g>
          ))}
          {[0, 6, 12, 18, 23].map((h) => (
            <text key={h} x={labelW + h * cell + cell / 2} y={7 * cell + 14} textAnchor="middle" className="fill-ink-mute text-[11px]">
              {h} h
            </text>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** Petite courbe sous un indicateur. */
function Spark({ values }) {
  if (!values || values.length < 2) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true" className="shrink-0">
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="var(--series-1)" opacity="0.1" />
      <polyline points={pts} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Kpi({ result }) {
  const { value, previous, metric } = result;
  const d = metric.decimals || 0;
  const delta = previous == null ? null : value - previous;
  // Pour un délai, une baisse est une bonne nouvelle ; ici on montre le sens, sans juger.
  const Icon = delta == null || delta === 0 ? FiMinus : delta > 0 ? FiArrowUpRight : FiArrowDownRight;
  return (
    <div className="flex h-full flex-col justify-between gap-1">
      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl font-bold tabular-nums tracking-tight text-ink">
          {fmt(value, d)}
          {metric.unit && <span className="ml-1 text-lg font-semibold text-ink-mute">{metric.unit}</span>}
        </p>
        <Spark values={result.spark} />
      </div>
      <p className="text-xs text-ink-mute">
        {delta == null ? (
          result.period || ''
        ) : (
          <span className="inline-flex items-center gap-1">
            <Icon aria-hidden="true" className="shrink-0" />
            <span>
              {delta === 0 ? 'Stable' : `${delta > 0 ? '+' : ''}${fmt(delta, d)}`} par rapport à la période précédente ({fmt(previous, d)}
              {metric.unit ? ` ${metric.unit}` : ''})
            </span>
          </span>
        )}
      </p>
    </div>
  );
}

const cellText = (key, v, kind) => {
  if (v == null || v === '') return '-';
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`).toLocaleDateString('fr-FR') : v;
  if (kind === 'number') return typeof v === 'number' ? fmt(v, 2) : v;
  if (kind) return v;
  if (/_at$|_due$/.test(key)) return new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  if (key === 'due_date') return new Date(`${v}T12:00:00`).toLocaleDateString('fr-FR');
  if (key === 'id') return `#${String(v).padStart(4, '0')}`;
  if (typeof v === 'number') return fmt(v, 1);
  return v;
};

function ListTable({ result, maxHeight }) {
  if (!result.rows.length) return <p className="py-6 text-center text-sm text-ink-mute">Aucune demande ne correspond.</p>;
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {result.columns.map((c) => (
              <th key={c.key} scope="col" className="whitespace-nowrap border-b border-line px-2 py-1.5 text-xs font-semibold text-ink-mute">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper">
              {result.columns.map((c) => (
                <td key={c.key} className={`px-2 py-1.5 ${c.key === 'title' ? 'min-w-48' : 'whitespace-nowrap'} ${typeof r[c.key] === 'number' ? 'tabular-nums' : ''}`}>
                  {c.key === 'title' ? (
                    <Link to={`/tickets/${r.id}`} className="font-semibold text-accent-strong hover:underline">
                      {r[c.key]}
                    </Link>
                  ) : (
                    cellText(c.key, r[c.key], c.kind)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && <p className="px-2 py-1.5 text-xs text-ink-mute">{result.rows.length} premières lignes sur {result.total}.</p>}
    </div>
  );
}

/** Vue en tableau d'un graphique (toujours disponible : accessibilité, impression, couleurs peu contrastées). */
function DataTable({ result, maxHeight }) {
  if (result.type === 'kpi') return null;
  if (result.type === 'heatmap') {
    return (
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="text-right text-xs tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="px-1.5 py-1 text-left text-ink-mute">
                Jour
              </th>
              {result.columns.map((c) => (
                <th key={c} scope="col" className="px-1.5 py-1 font-semibold text-ink-mute">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={r} className="border-t border-line">
                <th scope="row" className="px-1.5 py-1 text-left font-semibold">
                  {r}
                </th>
                {result.values[i].map((v, h) => (
                  <td key={h} className="px-1.5 py-1">
                    {v || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const d = result.metric?.decimals || 0;
  const head = result.type === 'summary' ? result.dimension.label : 'Période';
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className="border-b border-line px-2 py-1.5 text-left text-xs font-semibold text-ink-mute">
              {head}
            </th>
            {result.series.map((s) => (
              <th key={s.key} scope="col" className="border-b border-line px-2 py-1.5 text-right text-xs font-semibold text-ink-mute">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.categories.map((c, i) => (
            <tr key={`${c.key}-${i}`} className="border-b border-line last:border-0">
              <th scope="row" className="px-2 py-1.5 text-left font-normal">
                {c.label}
              </th>
              {result.series.map((s) => (
                <td key={s.key} className="px-2 py-1.5 text-right tabular-nums">
                  {s.values[i] == null ? '-' : `${fmt(s.values[i], d)}${result.metric?.unit ? `\u00a0${result.metric.unit}` : ''}`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isEmpty = (r) =>
  r.type === 'list'
    ? !r.rows.length
    : r.type === 'heatmap'
      ? !r.total
      : r.type === 'kpi'
        ? false
        : !r.categories.length || r.series.every((s) => s.values.every((v) => v == null || (v === 0 && !s.unit)));

/**
 * Affiche un résultat de rapport. `height` : hauteur disponible pour le graphique.
 * Un bouton bascule entre le graphique et le tableau des valeurs.
 */
export function ResultView({ result, height = 260, toggle = true }) {
  const [table, setTable] = useState(false);
  useEffect(() => setTable(false), [result?.type, result?.chart]);
  const view = useMemo(() => {
    if (!result || result.type === 'list' || result.type === 'kpi' || result.type === 'heatmap') return null;
    const dimension = result.type === 'trend' ? 'trend' : result.split ? result.split.key : null;
    let series = result.series;
    if (result.split) series = foldSeries(series);
    const colors = series.map((s, i) => seriesColor(colorIndex(dimension, s.key, i)));
    return { series, colors };
  }, [result]);

  if (!result) return null;
  if (result.type === 'kpi') return <Kpi result={result} />;
  if (result.type === 'list') return <ListTable result={result} maxHeight={height} />;
  if (isEmpty(result)) return <p className="py-8 text-center text-sm text-ink-mute">Aucune donnée sur cette période.</p>;

  const chartLabel = result.type === 'heatmap' ? 'carte' : 'graphique';
  const switcher = toggle && (
    <button
      type="button"
      className="absolute right-0 top-0 z-[1] rounded-md p-1.5 text-ink-mute hover:bg-ink/5 hover:text-ink"
      onClick={() => setTable((t) => !t)}
      aria-pressed={table}
      aria-label={table ? `Revenir au ${chartLabel}` : 'Voir les valeurs en tableau'}
      title={table ? `Revenir au ${chartLabel}` : 'Voir les valeurs en tableau'}
    >
      {table ? <FiBarChart2 aria-hidden="true" /> : <FiList aria-hidden="true" />}
    </button>
  );

  let chart;
  const decimals = result.metric?.decimals || 0;
  const unit = result.metric?.unit ? `\u00a0${result.metric.unit}` : '';
  if (table) chart = <DataTable result={result} maxHeight={height} />;
  else if (result.type === 'heatmap') chart = <Heatmap result={result} />;
  else if (result.chart === 'table') chart = <DataTable result={result} maxHeight={height} />;
  else if (result.chart === 'donut') {
    // Une seule série : une couleur par valeur, 8 au plus.
    let cats = result.categories;
    let values = result.series[0].values;
    if (cats.length > SERIES_MAX) {
      cats = [...cats.slice(0, SERIES_MAX - 1), { key: '__other', label: 'Autres' }];
      values = [...values.slice(0, SERIES_MAX - 1), values.slice(SERIES_MAX - 1).reduce((a, b) => a + (b || 0), 0)];
    }
    const colors = cats.map((c, i) => seriesColor(colorIndex(result.dimension.key, c.key, i)));
    chart = <Donut categories={cats} values={values} colors={colors} height={height - 8} decimals={decimals} />;
  } else if (result.chart === 'hbar' || (result.chart === 'stacked' && result.categories.length > 8)) {
    chart = (
      <>
        <Legend items={view.series.map((s, i) => ({ label: s.label, color: view.colors[i] }))} />
        <HBars categories={result.categories} series={view.series} stacked={result.chart === 'stacked'} decimals={decimals} colors={view.colors} maxHeight={height - 24} unit={unit} />
      </>
    );
  } else if (result.type === 'trend' && result.chart !== 'bar') {
    chart = (
      <>
        <Legend items={view.series.map((s, i) => ({ label: s.label, color: view.colors[i] }))} />
        <Lines categories={result.categories} series={view.series} area={result.chart === 'area'} height={height - (view.series.length > 1 ? 24 : 0)} colors={view.colors} unit={unit} decimals={decimals} />
      </>
    );
  } else {
    // Barres verticales : une seule série prend la couleur de chaque valeur si l'axe en a une (statut, priorité).
    const single = view.series.length === 1 && result.type === 'summary' && ['status', 'priority', 'sla_state', 'sla_response_state'].includes(result.dimension.key);
    if (single) {
      const per = result.categories.map((c, i) => seriesColor(colorIndex(result.dimension.key, c.key, i)));
      chart = <PerValueColumns result={result} colors={per} height={height} decimals={decimals} unit={unit} />;
    } else {
      chart = (
        <>
          <Legend items={view.series.map((s, i) => ({ label: s.label, color: view.colors[i] }))} />
          <Columns
            categories={result.categories}
            series={view.series}
            stacked={result.chart === 'stacked'}
            height={height - (view.series.length > 1 ? 24 : 0)}
            decimals={decimals}
            colors={view.colors}
            unit={unit}
          />
        </>
      );
    }
  }
  return (
    <div className="relative pr-8">
      {switcher}
      {chart}
    </div>
  );
}

/** Colonnes d'une seule série où chaque valeur garde sa couleur (statuts, priorités). */
function PerValueColumns({ result, colors, height, decimals, unit }) {
  // Une série par valeur, chacune nulle ailleurs : réutilise le dessin groupé sans décalage.
  const s = result.series[0];
  const series = result.categories.map((c, i) => ({ key: c.key, label: c.label, values: result.categories.map((_, j) => (i === j ? s.values[j] : 0)) }));
  return <Columns categories={result.categories} series={series} stacked single height={height} decimals={decimals} colors={colors} unit={unit} />;
}
