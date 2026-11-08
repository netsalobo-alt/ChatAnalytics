// Gráficos em SVG puro: área com barras, anel e barras horizontais.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui.tsx';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Curva suave (Catmull-Rom → Bézier). */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0]},${Math.min(c1[1], Math.max(p1[1], p2[1]))} ${c2[0]},${Math.min(c2[1], Math.max(p1[1], p2[1]))} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export interface TrendDatum {
  key: string;
  label: string;
  a: number; // série principal (área)
  b: number; // série secundária (barras)
}

export function TrendChart({
  data, height = 260, aLabel, bLabel, format = (v) => String(v),
}: {
  data: TrendDatum[];
  height?: number;
  aLabel: string;
  bLabel: string;
  format?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 26, left: 36 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.a, d.b))));
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const x = (i: number) => pad.left + (data.length > 1 ? i * step : w / 2);
  const y = (v: number) => pad.top + h - (v / max) * h;
  const pts = data.map((d, i) => [x(i), y(d.a)] as [number, number]);
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L${x(data.length - 1)},${pad.top + h} L${x(0)},${pad.top + h} Z` : '';
  const barW = Math.max(2, Math.min(14, step * 0.42));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 78))));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.left;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(px / (step || 1)))));
  };

  const hd = hover !== null ? data[hover] : null;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${aLabel} e ${bLabel} por período`}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} stroke="var(--separator)" strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" className="fill-label-3 text-[11px] tabular">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => (
            <rect key={d.key} x={x(i) - barW / 2} y={y(d.b)} width={barW} height={Math.max(0, pad.top + h - y(d.b))} rx={Math.min(3, barW / 2)} fill="var(--green-fill)" opacity={hover === null || hover === i ? 0.9 : 0.35} />
          ))}
          <path d={area} fill="url(#trend-fill)" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
          {data.map((d, i) =>
            (i % labelEvery === 0 && data.length - 1 - i >= labelEvery * 0.6) || i === data.length - 1 ? (
              <text key={d.key} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="fill-label-3 text-[11px]">
                {d.label}
              </text>
            ) : null,
          )}
          {hover !== null && hd && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} stroke="var(--label-3)" strokeOpacity={0.4} />
              <circle cx={x(hover)} cy={y(hd.a)} r={5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2.5} />
            </g>
          )}
        </svg>
      )}
      {hover !== null && hd && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-[140px] -translate-x-1/2 rounded-xl bg-elevated/95 px-3 py-2 text-[12px] shadow-pop backdrop-blur-xl"
          style={{ left: Math.min(Math.max(x(hover), 80), width - 80) }}
        >
          <div className="mb-1 font-semibold text-label">{hd.label}</div>
          <div className="flex items-center justify-between gap-4 text-label-2">
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-accent" />{aLabel}</span>
            <b className="tabular text-label">{format(hd.a)}</b>
          </div>
          <div className="flex items-center justify-between gap-4 text-label-2">
            <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-green-fill" />{bLabel}</span>
            <b className="tabular text-label">{format(hd.b)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function Ring({
  segments, size = 168, thickness = 16, center,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  const arcs = useMemo(() => {
    let offset = 0;
    return segments.map((s) => {
      const len = total ? (s.value / total) * c : 0;
      const arc = { ...s, dash: Math.max(0, len - gap), offset };
      offset += len;
      return arc;
    });
  }, [segments, total, c, gap]);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-2)" strokeWidth={thickness} />
        {arcs.map((a) =>
          a.dash > 0 ? (
            <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={thickness} strokeLinecap="round"
              strokeDasharray={`${a.dash} ${c}`} strokeDashoffset={-a.offset} className="transition-[stroke-dasharray] duration-700" />
          ) : null,
        )}
      </svg>
      {center && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  );
}

export function Meter({ value, max, color = 'var(--accent)', className }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-fill-2', className)}>
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function MiniBars({ values, color = 'var(--accent)', height = 36 }: { values: number[]; color?: string; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="flex-1 rounded-[2px]" style={{ height: `${Math.max(6, (v / max) * 100)}%`, background: color, opacity: i === values.length - 1 ? 1 : 0.28 }} />
      ))}
    </div>
  );
}
