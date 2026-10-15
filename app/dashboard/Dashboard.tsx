"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buckets, byCategory, cmp, comparable, covers, elapsed, fetchWindow, grainFor, inRange, kpis, pace,
  periodLabel, periodOf, shiftPeriod, spentOf, ymd, type Period, type Tx, type View,
} from "@/lib/dash";
import type { DashData } from "@/lib/dashData";
import { bkkToday, isoDate } from "@/lib/time";
import { BarChart, LineChart, baht } from "./charts";
import "./dashboard.css";

const VIEWS: { v: View; label: string }[] = [
  { v: "day", label: "Day" }, { v: "week", label: "Week" }, { v: "month", label: "Month" },
  { v: "quarter", label: "Quarter" }, { v: "year", label: "Year" },
];
const PREV: Record<View, string> = {
  day: "yesterday", week: "same days last week", month: "same days last month",
  quarter: "same days last quarter", year: "same days last year",
};
const GRAIN_TITLE = { day: "Spending per day", week: "Spending per week", month: "Spending per month" };

type Status = "loading" | "ready" | "denied" | "error";

function amountOf(t: Tx): [string, number] {
  const e = Object.entries(t.amounts);
  if (t.type === "Transfer") {
    const from = e.find(([, v]) => v < 0);
    const to = e.find(([, v]) => v > 0);
    return [`${from?.[0] ?? "?"} → ${to?.[0] ?? "?"}`, Math.abs(from?.[1] ?? to?.[1] ?? 0)];
  }
  return [e[0]?.[0] ?? "", e[0]?.[1] ?? 0];
}

async function startSession(liffId: string): Promise<"ok" | "redirect" | "denied"> {
  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return "redirect";
  }
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error("No ID token. Turn on the openid scope for this LIFF app.");
  const res = await fetch("/api/dash/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (res.status === 403) return "denied";
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Login failed (${res.status})`);
  return "ok";
}

export default function Dashboard({ liffId, demo }: { liffId: string; demo: boolean }) {
  const today = useMemo(() => bkkToday(), []);
  const [view, setView] = useState<View>("month");
  const [period, setPeriod] = useState<Period>(() => periodOf("month", today));
  const [data, setData] = useState<DashData | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const cache = useRef(new Map<string, DashData>());
  const sessionTried = useRef(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem("dash-view") as View | null;
      if (v && VIEWS.some((x) => x.v === v)) {
        setView(v);
        setPeriod(periodOf(v, today));
      }
    } catch {}
  }, [today]);

  const load = useCallback(async (p: Period, force = false) => {
    const w = fetchWindow(p);
    const key = `${w.from}_${w.to}`;
    if (!force && cache.current.has(key)) {
      setData(cache.current.get(key)!);
      setStatus("ready");
      return;
    }
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    try {
      let res = await fetch(`/api/dash/data?from=${w.from}&to=${w.to}`, { cache: "no-store" });
      if (res.status === 401 && !demo && !sessionTried.current) {
        sessionTried.current = true;
        const r = await startSession(liffId);
        if (r === "redirect") return;
        if (r === "denied") return setStatus("denied");
        res = await fetch(`/api/dash/data?from=${w.from}&to=${w.to}`, { cache: "no-store" });
      }
      if (res.status === 401) return setStatus("denied");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      cache.current.set(key, json);
      setData(json);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [demo, liffId]);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const pick = (v: View) => {
    setView(v);
    setPeriod(periodOf(v, today));
    setCatFilter(null);
    try { localStorage.setItem("dash-view", v); } catch {}
  };

  const isCurrent = cmp(period.from, today) <= 0 && cmp(today, period.to) <= 0;
  const canNext = cmp(shiftPeriod(period, 1).from, today) <= 0;

  if (status === "denied") {
    return <div className="dash"><div className="center"><div><h1>Not allowed</h1><p className="sub">This dashboard only opens for the LINE account set in LINE_USER_ID.</p></div></div></div>;
  }
  if (status === "error" && !data) {
    return <div className="dash"><div className="center"><div><h1>Couldn&apos;t load</h1><p className="err">{error}</p><button className="btn" onClick={() => load(period, true)}>Try again</button></div></div></div>;
  }
  if (!data) {
    return <div className="dash"><div className="center"><p className="sub">Loading your sheet…</p></div></div>;
  }

  const txs = data.txs;
  const e = elapsed(period, today);
  const inPeriod = e ? txs.filter((t) => inRange(t, period.from, period.to)) : [];
  const k = kpis(period, txs, today, data.budget, data.noSpend);
  const grain = grainFor(period.view);
  const bs = buckets(period, txs, today);
  const pc = pace(period, txs, today, data.budget);
  const cats = byCategory(inPeriod, period.from, period.to, data.budget);
  const maxCat = Math.max(1, ...cats.map((c) => Math.max(c.spent, c.budget ?? 0)));
  const comp0 = comparable(period, today);
  const fair = comp0 !== null && covers(data.covered, comp0.from, comp0.to);
  const diff = k.prevSpent !== null && fair ? Math.round(k.spent - k.prevSpent) : null;
  const used = k.budget ? k.spent / k.budget : null;
  const rows = inPeriod.filter((t) => !catFilter || (t.category || "(no category)") === catFilter).slice().reverse();
  const comp = comparable(period, today);
  const allCats = [...new Set([...data.categories, ...Object.keys(data.budget)])];

  return (
    <div className="dash">
      <div className="dash-wrap">
        <div className="dash-top">
          <div>
            <h1>Money</h1>
            <div className="sub">{demo ? "Demo data" : "From your Google Sheet"} · today {isoDate(today)}</div>
          </div>
          <button className="btn" onClick={() => { cache.current.clear(); load(period, true); }} aria-label="Refresh">↻</button>
        </div>

        <div className="seg" role="group" aria-label="Time scale">
          {VIEWS.map(({ v, label }) => (
            <button key={v} aria-pressed={view === v} onClick={() => pick(v)}>{label}</button>
          ))}
        </div>

        <div className="nav">
          <button className="btn" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous">‹</button>
          <div className="label">{periodLabel(period)}</div>
          {isCurrent ? (
            <button className="btn" onClick={() => setPeriod(shiftPeriod(period, 1))} disabled={!canNext} aria-label="Next">›</button>
          ) : (
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn" onClick={() => setPeriod(shiftPeriod(period, 1))} disabled={!canNext} aria-label="Next">›</button>
              <button className="btn" onClick={() => setPeriod(periodOf(view, today))}>Now</button>
            </span>
          )}
        </div>

        {!e && <p className="sub">This period hasn&apos;t started yet.</p>}

        <div className="grid tiles">
          <div className="card tile">
            <div className="k">Spent</div>
            <div className="v">{baht(k.spent)}</div>
            <div className="d">
              {diff === null || !comp ? `${k.entries} entries${comp && !fair ? " · no data to compare" : ""}` : diff === 0 ? `same as ${PREV[period.view]}` : (
                <span className={diff > 0 ? "delta-up" : "delta-down"}>{diff > 0 ? "▲" : "▼"} {baht(Math.abs(diff))} {diff > 0 ? "more" : "less"} than {PREV[period.view]}</span>
              )}
            </div>
          </div>
          <div className="card tile">
            <div className="k">Budget used</div>
            <div className="v">{used === null ? "–" : `${Math.round(used * 100)}%`}</div>
            <div className="d">
              {k.budget === null ? "No targets yet" : k.spent > k.budget ? (
                <span className="delta-up">⚠ Over by {baht(k.spent - k.budget)}</span>
              ) : `${baht(k.budget - k.spent)} left of ${baht(k.budget)}`}
            </div>
          </div>
          <div className="card tile">
            <div className="k">Income</div>
            <div className="v">{baht(k.income)}</div>
            <div className="d">Net {k.net >= 0 ? "+" : "−"}{baht(Math.abs(k.net))}</div>
          </div>
          <div className="card tile">
            <div className="k">Per day</div>
            <div className="v">{baht(k.perDay)}</div>
            <div className="d">Logged {k.daysLogged} of {k.daysElapsed} days</div>
          </div>
        </div>

        {grain && (
          <div className="grid two" style={{ marginTop: 12 }}>
            <div className="card">
              <h2>{GRAIN_TITLE[grain]}</h2>
              <BarChart
                ariaLabel={GRAIN_TITLE[grain]}
                data={bs.map((b) => ({
                  key: b.key, label: b.label, value: b.spent, future: b.future,
                  title: grain === "day" ? isoDate(b.from) : `${isoDate(b.from)} to ${isoDate(b.to)}`,
                }))}
              />
            </div>
            <div className="card">
              <h2>Running total vs budget</h2>
              {Object.keys(data.budget).length ? (
                <LineChart
                  ariaLabel="Cumulative spending compared with cumulative budget"
                  labels={pc.map((p) => p.label)}
                  titles={bs.map((b) => (grain === "day" ? isoDate(b.from) : `to ${isoDate(b.to)}`))}
                  series={[
                    { name: "Spent", color: "var(--series-1)", values: pc.map((p) => p.actual) },
                    { name: "Budget", color: "var(--series-2)", values: pc.map((p) => p.budget) },
                  ]}
                />
              ) : <p className="sub">Set monthly targets below to see this.</p>}
            </div>
          </div>
        )}

        <div className="grid two" style={{ marginTop: 12 }}>
          <div className="card">
            <h2>Categories</h2>
            {cats.length === 0 && <p className="sub">No spending in this period.</p>}
            {cats.map((c) => {
              const over = c.budget !== null && c.spent > c.budget;
              return (
                <button
                  key={c.name} className="cat" onClick={() => setCatFilter(catFilter === c.name ? null : c.name)}
                  style={{ width: "100%", background: catFilter === c.name ? "var(--hover)" : "transparent", border: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer", borderRadius: 8 }}
                  aria-pressed={catFilter === c.name}
                >
                  <span className="name">{c.name}</span>
                  <span className="track" aria-hidden>
                    <span className="fill" style={{ width: `${(Math.max(0, c.spent) / maxCat) * 100}%` }} />
                    {c.budget !== null && <span className="target" style={{ left: `calc(${(c.budget / maxCat) * 100}% - 1px)` }} />}
                  </span>
                  <span className="vals num">
                    <span>{baht(c.spent)}{c.budget !== null ? ` of ${baht(c.budget)}` : ""}</span>
                    {over ? <span className="over">⚠ over {baht(c.spent - c.budget!)}</span> : c.budget !== null ? <span>{baht(c.budget - c.spent)} left</span> : <span className="muted">{c.count} {c.count === 1 ? "item" : "items"}</span>}
                  </span>
                </button>
              );
            })}
            {cats.some((c) => c.budget !== null) && (
              <p className="sub" style={{ marginTop: 8 }}>▏ marks the target for this period (monthly target spread over its days).</p>
            )}
          </div>

          <div className="stack" style={{ marginTop: 0 }}>
            <div className="card">
              <h2>Balances</h2>
              <table className="list num">
                <tbody>
                  {data.balances.map((b) => (
                    <tr key={b.name}>
                      <td>{b.name} <span className="pill">{b.code}</span></td>
                      <td className="r" style={b.value < 0 ? { color: "var(--critical)" } : undefined}>{b.value < 0 ? "−" : ""}{baht(Math.abs(b.value))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="r"><strong>{baht(data.balances.reduce((s, b) => s + b.value, 0))}</strong></td>
                  </tr>
                </tbody>
              </table>
              <p className="sub" style={{ marginTop: 8 }}>Current sheet balances. Off? Send <code>bal k 3200</code> in LINE.</p>
            </div>
          </div>
        </div>

        <BudgetEditor
          categories={allCats}
          budget={data.budget}
          monthSpent={(name) => spentOf(txs.filter((t) => (t.category || "(no category)") === name && t.date.slice(0, 7) === isoDate(today).slice(0, 7)))}
          hasThisMonth={txs.some((t) => t.date.slice(0, 7) === isoDate(today).slice(0, 7)) || isoDate(period.from).slice(0, 7) === isoDate(today).slice(0, 7)}
          onSaved={(cat, target) => {
            cache.current.clear();
            setData({ ...data, budget: Object.fromEntries(Object.entries({ ...data.budget, [cat]: target }).filter(([, v]) => v > 0)) });
          }}
        />

        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Transactions</h2>
            {catFilter && <button className="btn" onClick={() => setCatFilter(null)}>{catFilter} ✕</button>}
          </div>
          <ul className="txs">
            {(showAll ? rows : rows.slice(0, 30)).map((t) => {
              const [acct, amt] = amountOf(t);
              const what = t.type === "Expense" ? (t.category || "No category") : t.type;
              return (
                <li key={`${t.tab}-${t.row}`}>
                  <div className="main">
                    <span className="what">{what}{t.description ? <span className="muted"> · {t.description}</span> : null}</span>
                    <span className="amt num">{t.type === "Transfer" ? baht(amt) : `${amt > 0 ? "+" : "−"}${baht(Math.abs(amt))}`}</span>
                  </div>
                  <div className="meta num">{t.date} · {acct}</div>
                </li>
              );
            })}
            {rows.length === 0 && <li className="muted">Nothing here.</li>}
          </ul>
          {!showAll && rows.length > 30 && <button className="btn" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>Show all {rows.length}</button>}
        </div>

        {data.skipped.length > 0 && (
          <p className="sub" style={{ marginTop: 12 }}>Not included (older sheet layout): {data.skipped.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

function BudgetEditor({ categories, budget, monthSpent, hasThisMonth, onSaved }: {
  categories: string[];
  budget: Record<string, number>;
  monthSpent: (name: string) => number;
  hasThisMonth: boolean;
  onSaved: (cat: string, target: number) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  const save = async (cat: string) => {
    const raw = (draft[cat] ?? "").replace(/,/g, "").trim();
    const target = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(target) || target < 0) return setMsg({ ...msg, [cat]: "Not a number" });
    setBusy(cat);
    const res = await fetch("/api/dash/budget", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: cat, target }),
    });
    setBusy(null);
    if (!res.ok) return setMsg({ ...msg, [cat]: "Save failed" });
    const { [cat]: _, ...rest } = draft;
    setDraft(rest);
    setMsg({ ...msg, [cat]: "Saved ✓" });
    onSaved(cat, target);
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>Monthly budget</h2>
      <p className="sub" style={{ marginTop: -6, marginBottom: 8 }}>Saved to the _Budget tab. The nightly digest and stats use these too. Leave empty to remove a target.</p>
      <div className="scroll">
        <table className="list">
          <thead>
            <tr><th>Category</th>{hasThisMonth && <th className="r">This month</th>}<th className="r">Target / month</th><th /></tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const dirty = draft[c] !== undefined && draft[c] !== String(budget[c] ?? "");
              const spent = monthSpent(c);
              const t = budget[c];
              return (
                <tr key={c}>
                  <td>{c}</td>
                  {hasThisMonth && (
                    <td className="r num" style={t && spent > t ? { color: "var(--critical)" } : undefined}>
                      {t && spent > t ? "⚠ " : ""}{baht(spent)}
                    </td>
                  )}
                  <td className="r">
                    <input
                      className="budget-input num" inputMode="decimal" aria-label={`Monthly target for ${c}`}
                      value={draft[c] ?? (t ? String(t) : "")} placeholder="none"
                      onChange={(ev) => setDraft({ ...draft, [c]: ev.target.value })}
                      onKeyDown={(ev) => { if (ev.key === "Enter" && dirty) save(c); }}
                    />
                  </td>
                  <td style={{ width: 80 }}>
                    {dirty ? (
                      <button className="btn primary" disabled={busy === c} onClick={() => save(c)}>{busy === c ? "…" : "Save"}</button>
                    ) : <span className="sub">{msg[c] ?? ""}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
