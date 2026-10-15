"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// 0, a round step, ... covering max
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const short = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));

// Rounded data-end (top), square at the baseline
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

const PAD = { top: 12, right: 8, bottom: 24, left: 40 };

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="tip" style={{ left: x, top: y }} role="status">
      {children}
    </div>
  );
}

export type BarDatum = { key: string; label: string; value: number; future?: boolean; title: string };

export function BarChart({ data, height = 200, ariaLabel }: { data: BarDatum[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const max = ticks[ticks.length - 1] || 1;
  const col = data.length ? plotW / data.length : 0;
  const gap = col > 10 ? 2 : 1;
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 36))));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "baseline" : "gridline"} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick num" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{short(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const bw = Math.min(32, Math.max(1, col - gap));
            const x = PAD.left + i * col + (col - bw) / 2;
            const bh = Math.max(0, (d.value / max) * plotH);
            return (
              <g key={d.key}>
                {bh > 0 && (
                  <path
                    d={barPath(x, y(d.value), bw, bh)}
                    fill="var(--series-1)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {i % every === 0 && (
                  <text className="tick" x={PAD.left + i * col + col / 2} y={height - 6} textAnchor="middle" opacity={d.future ? 0.5 : 1}>{d.label}</text>
                )}
                <rect
                  x={PAD.left + i * col} y={PAD.top} width={col} height={plotH} fill="transparent" tabIndex={0}
                  aria-label={`${d.title}: ${baht(d.value)}`}
                  onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {h && hover !== null && (
        <Tip x={PAD.left + hover * col + col / 2} y={y(h.value)}>
          <strong className="num">{h.future ? "not yet" : baht(h.value)}</strong>
          <span className="muted">{h.title}</span>
        </Tip>
      )}
    </div>
  );
}

export type LineSeries = { name: string; color: string; values: (number | null)[] };

// One axis, crosshair snaps to the nearest point, one tooltip lists every series
export function LineChart({ labels, titles, series, height = 200, ariaLabel }: {
  labels: string[]; titles: string[]; series: LineSeries[]; height?: number; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const max = ticks[ticks.length - 1] || 1;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 36))));

  const path = (vals: (number | null)[]) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v === null) return;
      d += `${d && vals[i - 1] !== null ? "L" : "M"}${x(i)},${y(v)} `;
    });
    return d;
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / Math.max(1, box.width);
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}><i className="key" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "baseline" : "gridline"} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick num" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{short(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => i % every === 0 && (
            <text key={i} className="tick" x={x(i)} y={height - 6} textAnchor="middle">{l}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--axis)" strokeWidth={1} />}
          {series.map((s) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) => {
            const i = hover ?? s.values.reduce<number>((last, v, j) => (v !== null ? j : last), -1);
            const v = i >= 0 ? s.values[i] : null;
            return v === null || v === undefined ? null : (
              <circle key={s.name} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
            );
          })}
          <rect
            x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" tabIndex={0} aria-label={ariaLabel}
            onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            }}
            onBlur={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && (
        <Tip x={x(hover)} y={PAD.top + 8}>
          <span className="muted">{titles[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="row">
              <i className="key" style={{ background: s.color }} />
              <strong className="num" style={{ display: "inline" }}>{s.values[hover] === null ? "–" : baht(s.values[hover]!)}</strong>
              <span className="muted">{s.name}</span>
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
}
