"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { addDays, isoDate, parseIso, weekdayOf, MONTHS } from "@/lib/time";

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

export function BarChart({ data, height = 200, ariaLabel, animKey = "", onSelect }: {
  data: BarDatum[]; height?: number; ariaLabel: string; animKey?: string; onSelect?: (i: number) => void;
}) {
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
                  <motion.path
                    key={`${animKey}-${d.key}`}
                    d={barPath(x, y(d.value), bw, bh)}
                    fill="var(--series-1)"
                    style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1, opacity: hover === null || hover === i ? 1 : 0.55 }}
                    transition={{ type: "spring", visualDuration: 0.4, bounce: 0, delay: Math.min(i * 0.008, 0.25) }}
                  />
                )}
                {i % every === 0 && (
                  <text className="tick" x={PAD.left + i * col + col / 2} y={height - 6} textAnchor="middle" opacity={d.future ? 0.5 : 1}>{d.label}</text>
                )}
                <rect
                  x={PAD.left + i * col} y={PAD.top} width={col} height={plotH} fill="transparent" tabIndex={0}
                  aria-label={`${d.title}: ${baht(d.value)}`}
                  onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  onClick={onSelect && !d.future ? () => onSelect(i) : undefined}
                  onKeyDown={onSelect && !d.future ? (e) => { if (e.key === "Enter" || e.key === " ") onSelect(i); } : undefined}
                  style={onSelect && !d.future ? { cursor: "pointer" } : undefined}
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
export function LineChart({ labels, titles, series, height = 200, ariaLabel, legend = true }: {
  labels: string[]; titles: string[]; series: LineSeries[]; height?: number; ariaLabel: string; legend?: boolean;
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
      {legend && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}><i className="key" style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
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

// --- Logging heat map: one column per week (Mon..Sun), colour = how much was spent ---

export type HeatDay = { n: number; spent: number };
const WD = ["Mon", "", "Wed", "", "Fri", "", ""];

export function HeatMap({ from, today, days, noSpend, level, onSelect }: {
  from: string; today: string; days: Record<string, HeatDay>; noSpend: Set<string>; level: (spent: number) => number; onSelect: (date: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null);
  const first = parseIso(from)!;
  const end = parseIso(today)!;
  const allWeeks = Math.ceil((Date.UTC(end.y, end.m - 1, end.d) - Date.UTC(first.y, first.m - 1, first.d)) / 86400000 / 7) + 1;
  const left = 26;
  const top = 16;
  const gap = 3;
  // Keep squares tappable (>= 12px): on narrow screens show only the most recent weeks that fit
  const weeks = Math.max(1, Math.min(allWeeks, Math.floor((width - left) / (12 + gap))));
  const start = addDays(first, (allWeeks - weeks) * 7);
  const cell = Math.max(12, Math.min(18, Math.floor((width - left) / weeks) - gap));
  const step = cell + gap;
  const h = top + 7 * step;

  const cells: { date: string; col: number; row: number }[] = [];
  const monthMarks: { col: number; label: string }[] = [];
  for (let d = start, i = 0; isoDate(d) <= today; d = addDays(d, 1), i++) {
    const col = Math.floor(i / 7);
    cells.push({ date: isoDate(d), col, row: (weekdayOf(d) + 6) % 7 });
    if (d.d <= 7 && (weekdayOf(d) + 6) % 7 === 0) monthMarks.push({ col, label: MONTHS[d.m - 1].slice(0, 3).replace(/^./, (c) => c.toUpperCase()) });
  }
  const info = hover ? days[hover.date] : null;

  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={Math.min(width, left + weeks * step)} height={h} role="img" aria-label="Logging heat map, one square per day">
          {monthMarks.map((m) => <text key={m.col} className="tick" x={left + m.col * step} y={10}>{m.label}</text>)}
          {WD.map((w, r) => w && <text key={w} className="tick" x={0} y={top + r * step + cell / 2} dy="0.32em">{w}</text>)}
          {cells.map((c) => {
            const d = days[c.date];
            const ns = noSpend.has(c.date) && !(d && d.n > 0);
            const logged = (d && d.n > 0) || ns;
            const lv = d && d.n > 0 ? level(d.spent) : 0;
            const x = left + c.col * step;
            const y = top + c.row * step;
            const fill = !logged ? "transparent" : lv === 0 ? "var(--heat-0)" : `var(--heat-${lv})`;
            return (
              <g key={c.date}>
                <motion.rect
                  x={x + 0.5} y={y + 0.5} width={cell - 1} height={cell - 1} rx={3}
                  fill={fill} stroke={!logged ? "var(--axis)" : c.date === today ? "var(--text-primary)" : "none"} strokeWidth={1}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, delay: Math.min(c.col * 0.012, 0.35) }}
                />
                {ns && cell >= 10 && (
                  <Check x={x + cell * 0.2} y={y + cell * 0.2} width={cell * 0.6} height={cell * 0.6} color="var(--good)" strokeWidth={3} aria-hidden />
                )}
                <rect
                  x={x - 1} y={y - 1} width={step} height={step} fill="transparent" tabIndex={0} style={{ cursor: "pointer" }}
                  aria-label={`${c.date}: ${ns ? "no-spend day" : d && d.n > 0 ? `${d.n} entries, ${baht(d.spent)}` : "nothing logged"}`}
                  onPointerEnter={() => setHover({ date: c.date, x: x + cell / 2, y })}
                  onFocus={() => setHover({ date: c.date, x: x + cell / 2, y })}
                  onClick={() => onSelect(c.date)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(c.date); }}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <Tip x={hover.x} y={hover.y}>
          <strong className="num">{info && info.n > 0 ? baht(info.spent) : noSpend.has(hover.date) ? "No-spend day" : "Nothing logged"}</strong>
          <span className="muted">{hover.date}{info && info.n > 0 ? ` · ${info.n} ${info.n === 1 ? "entry" : "entries"}` : ""}</span>
        </Tip>
      )}
      <div className="heat-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => <i key={l} style={{ background: `var(--heat-${l})` }} />)}
        <span>More</span>
        <span className="sep" />
        <i className="ns"><Check size={9} color="var(--good)" strokeWidth={3} aria-hidden /></i><span>No-spend</span>
        <i className="miss" /><span>Not logged</span>
      </div>
    </div>
  );
}

// Simple ranked horizontal bars (one series, values in the label)
export function HBars({ rows, onSelect }: { rows: { name: string; value: number; note?: string }[]; onSelect?: (name: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <button key={r.name} className="hbar" onClick={onSelect ? () => onSelect(r.name) : undefined} disabled={!onSelect}>
          <span className="name">{r.name}</span>
          <span className="track" aria-hidden>
            <motion.span
              className="fill" style={{ width: `${(r.value / max) * 100}%`, transformOrigin: "0% 50%" }}
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
              transition={{ type: "spring", visualDuration: 0.45, bounce: 0, delay: i * 0.03 }}
            />
          </span>
          <span className="val num">{baht(r.value)}{r.note ? <span className="muted"> {r.note}</span> : null}</span>
        </button>
      ))}
    </div>
  );
}
