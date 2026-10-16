"use client";

import { MotionConfig, motion } from "motion/react";
import {
  ArrowDownRight, ArrowUpRight, CalendarDays, ChartColumn, Check, CircleDollarSign, CreditCard, Flame, Gauge, Landmark,
  ListOrdered, Lock, PiggyBank, RefreshCw, Ruler, Sparkles, Tags, Target, TrendingUp, TriangleAlert, Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accuracyOf, ago, daysApart, isGapRow, pct } from "@/lib/accuracy";
import {
  buckets, byAccount, byCategory, cmp, comparable, covers, elapsed, fetchWindow, grainFor, heatLevels, inRange, kpis, pace,
  periodLabel, periodOf, shiftPeriod, spentOf, streaks, usableSeries, weekdayAverages, ymd, type Period, type Tx, type View,
} from "@/lib/dash";
import type { DashData } from "@/lib/dashData";
import { bkkToday, isoDate } from "@/lib/time";
import { BarChart, HBars, HeatMap, LineChart, baht } from "./charts";
import { AnimatedNumber, PeriodSwiper, Press, Segmented, Sheet, ThemeToggle } from "./ui";
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
const I = { size: 16, "aria-hidden": true } as const;
const fmtBaht = (n: number) => `${n < 0 ? "−" : ""}${baht(Math.abs(n))}`;
const fmtPct = (n: number) => `${Math.round(n)}%`;

type Status = "loading" | "ready" | "denied" | "error";
type Detail =
  | { kind: "day"; date: string }
  | { kind: "range"; from: string; to: string; title: string }
  | { kind: "category"; name: string };

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

function TxList({ rows, limit }: { rows: Tx[]; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <ul className="txs">
      {shown.map((t) => {
        const [acct, amt] = amountOf(t);
        const what = t.type === "Expense" ? (isGapRow(t) ? "Found missing" : t.category || "No category") : t.type;
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
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="dash">{children}</div>
    </MotionConfig>
  );
}

export default function Dashboard({ liffId, demo }: { liffId: string; demo: boolean }) {
  const today = useMemo(() => bkkToday(), []);
  const todayS = isoDate(today);
  const [view, setView] = useState<View>("month");
  const [period, setPeriod] = useState<Period>(() => periodOf("month", today));
  const [dir, setDir] = useState<1 | -1>(1);
  const [data, setData] = useState<DashData | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [today]);

  const load = useCallback(async (p: Period, force = false) => {
    const w = fetchWindow(p, today);
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
  }, [demo, liffId, today]);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const pick = (v: View) => {
    setView(v);
    setDir(1);
    setPeriod(periodOf(v, today));
    setCatFilter(null);
    try { localStorage.setItem("dash-view", v); } catch {}
  };
  const go = (d: 1 | -1) => {
    setDir(d);
    setPeriod((p) => shiftPeriod(p, d));
  };
  const openDetail = (d: Detail) => {
    setDetail(d);
    setSheetOpen(true);
  };
  const openDay = (date: string) => {
    setSheetOpen(false);
    setView("day");
    setDir(date < isoDate(period.from) ? -1 : 1);
    setPeriod(periodOf("day", ymd(date)));
  };

  if (status === "denied") {
    return <Shell><div className="center"><div><h1>Not allowed</h1><p className="sub">This dashboard only opens for the LINE account set in LINE_USER_ID.</p></div></div></Shell>;
  }
  if (status === "error" && !data) {
    return <Shell><div className="center"><div><h1>Couldn&apos;t load</h1><p className="err">{error}</p><Press onClick={() => load(period, true)}>Try again</Press></div></div></Shell>;
  }
  if (!data) {
    return <Shell><div className="center"><p className="sub">Loading your sheet…</p></div></Shell>;
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
  const used = k.budget ? (k.spent / k.budget) * 100 : null;
  const rows = inPeriod.filter((t) => !catFilter || (t.category || "(no category)") === catFilter).slice().reverse();
  const allCats = [...new Set([...data.categories, ...Object.keys(data.budget)])];
  const usableNames = data.balances.filter((b) => b.usable).map((b) => b.name);
  const usableVals = grain ? usableSeries(bs, txs, today, data.usable.now, usableNames, data.covered) : [];
  const runway = data.usable.perDay30 > 0 ? Math.floor(Math.max(0, data.usable.now) / data.usable.perDay30) : null;
  const accNow = e ? accuracyOf(txs, isoDate(e.from), isoDate(e.to)) : null;
  const accPrev = comp0 && fair ? accuracyOf(txs, isoDate(comp0.from), isoDate(comp0.to)) : null;
  const unloggedBars = grain ? bs.map((b) => ({ ...b, unlogged: accuracyOf(txs, isoDate(b.from), isoDate(b.to)).unlogged })) : [];
  const noSpend = new Set(data.noSpend);
  const st = streaks(data.heat.days, data.noSpend, data.heat.from, today);
  const level = heatLevels(data.heat.days);
  const wk = e && period.view !== "day" ? weekdayAverages(txs, e.from, e.to) : [];
  const accts = byAccount(inPeriod);
  const animKey = `${period.view}-${isoDate(period.from)}`;
  const usableGroups = [
    { title: "Usable", icon: <Wallet {...I} />, rows: data.balances.filter((b) => b.usable) },
    { title: "Not usable", icon: <Lock {...I} />, rows: data.balances.filter((b) => !b.usable) },
  ].filter((g) => g.rows.length);
  const onTrack = k.budget !== null && k.spent <= k.budget;

  // What the sheet shows
  let sheetTitle: React.ReactNode = "";
  let sheetBody: React.ReactNode = null;
  if (detail) {
    const list = (from: string, to: string, cat?: string) =>
      txs.filter((t) => t.date >= from && t.date <= to && (!cat || (t.category || "(no category)") === cat)).slice().reverse();
    if (detail.kind === "day") {
      const inWindow = detail.date >= data.from && detail.date <= data.to;
      const h = data.heat.days[detail.date];
      const r = inWindow ? list(detail.date, detail.date) : [];
      sheetTitle = <span><CalendarDays {...I} className="inline-icon" />{periodLabel(periodOf("day", ymd(detail.date)))}</span>;
      sheetBody = (
        <>
          <div className="stats">
            <div><div className="sub">Spent</div><div className="v num">{baht(inWindow ? spentOf(r.filter((t) => !isGapRow(t))) : h?.spent ?? 0)}</div></div>
            <div><div className="sub">Entries</div><div className="v num">{inWindow ? r.filter((t) => !isGapRow(t)).length : h?.n ?? 0}</div></div>
          </div>
          {noSpend.has(detail.date) && <p className="sub"><Check {...I} className="inline-icon" color="var(--good)" />Marked as a no-spend day</p>}
          {!h && !noSpend.has(detail.date) && detail.date <= todayS && <p className="sub"><TriangleAlert {...I} className="inline-icon" />Nothing logged this day. Send it in LINE with the date&apos;s spending, or <code>0</code> next time.</p>}
          {inWindow ? <TxList rows={r} /> : <Press className="btn" onClick={() => openDay(detail.date)}>Open this day</Press>}
        </>
      );
    } else if (detail.kind === "range") {
      const r = list(detail.from, detail.to);
      sheetTitle = <span><ChartColumn {...I} className="inline-icon" />{detail.title}</span>;
      sheetBody = (
        <>
          <div className="stats">
            <div><div className="sub">Spent</div><div className="v num">{baht(spentOf(r))}</div></div>
            <div><div className="sub">Entries</div><div className="v num">{r.length}</div></div>
          </div>
          <TxList rows={r} />
        </>
      );
    } else {
      const r = list(isoDate(period.from), isoDate(period.to), detail.name);
      const c = cats.find((x) => x.name === detail.name);
      sheetTitle = <span><Tags {...I} className="inline-icon" />{detail.name}</span>;
      sheetBody = (
        <>
          <div className="stats">
            <div><div className="sub">Spent · {periodLabel(period)}</div><div className="v num">{baht(c?.spent ?? 0)}</div></div>
            {c?.budget != null && <div><div className="sub">Target</div><div className="v num">{baht(c.budget)}</div></div>}
          </div>
          <TxList rows={r} />
        </>
      );
    }
  }

  return (
    <Shell>
      <div className="dash-wrap">
        <header className={`topbar${scrolled ? " scrolled" : ""}`}>
          <div className="row">
            <div>
              <h1><Wallet size={20} aria-hidden />Money</h1>
              <div className="sub">{demo ? "Demo data" : "From your Google Sheet"} · today {todayS}</div>
            </div>
            <div className="actions">
              <ThemeToggle />
              <Press className="btn icon" onClick={() => { cache.current.clear(); load(period, true); }} aria-label="Refresh"><RefreshCw size={18} aria-hidden /></Press>
            </div>
          </div>
          <Segmented label="Time scale" options={VIEWS} value={view} onChange={pick} />
          <PeriodSwiper
            label={periodLabel(period)} dir={dir} onPrev={() => go(-1)} onNext={() => go(1)}
            canNext={cmp(shiftPeriod(period, 1).from, today) <= 0}
          />
          {!(cmp(period.from, today) <= 0 && cmp(today, period.to) <= 0) && (
            <div style={{ textAlign: "center", marginTop: 6 }}>
              <Press className="btn" onClick={() => { setDir(1); setPeriod(periodOf(view, today)); }}>Back to now</Press>
            </div>
          )}
        </header>

        {!e && <p className="sub">This period hasn&apos;t started yet.</p>}

        <div className="card hero mt">
          <div>
            <div className="k"><Wallet {...I} />Usable now</div>
            <div className="hero-v" style={data.usable.now < 0 ? { color: "var(--critical)" } : undefined}>
              <AnimatedNumber value={data.usable.now} format={fmtBaht} />
            </div>
            <div className="d">
              {runway === null ? "No recent spending to estimate from" : <>Lasts <strong>~{runway} {runway === 1 ? "day" : "days"}</strong> at {baht(data.usable.perDay30)}/day (30-day average)</>}
            </div>
            {data.accuracy.drift > 0 && (
              <div className="d" style={{ marginTop: 6 }}>
                <TriangleAlert {...I} className="inline-icon" />Could be ~{baht(data.accuracy.drift)} lower: you usually miss ~{baht(data.accuracy.missPerDay)}/day since each account&apos;s last check
              </div>
            )}
            <div className="sub" style={{ marginTop: 6 }}>Total, all accounts {baht(data.usable.total)}</div>
          </div>
          {grain && usableVals.some((v) => v !== null) && (
            <div>
              <div className="sub" style={{ marginBottom: 4 }}>Usable money, end of each {grain}</div>
              <LineChart
                ariaLabel="Usable money over time" legend={false} height={150}
                labels={bs.map((b) => b.label)}
                titles={bs.map((b) => (grain === "day" ? isoDate(b.from) : `end of ${isoDate(cmp(b.to, today) > 0 ? today : b.to)}`))}
                series={[{ name: "Usable", color: "var(--series-1)", values: usableVals }]}
              />
            </div>
          )}
        </div>

        <div className="card mt habit">
          <div className="streak">
            <motion.div className="flame" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", visualDuration: 0.4, bounce: st.current >= 7 ? 0.35 : 0 }}>
              <Flame size={26} aria-hidden />
            </motion.div>
            <div>
              <div className="big"><AnimatedNumber value={st.current} format={(n) => String(Math.round(n))} /><span style={{ fontSize: 15, fontWeight: 600 }}> day streak</span></div>
              <div className="sub">Best {st.best} · logged {st.logged} of {st.total} days</div>
              <div className="sub">{st.current >= 7 ? "On fire. Keep it going." : st.current > 0 ? "Log today to keep it alive." : "Log something or send 0 to start one."}</div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <HeatMap from={data.heat.from} today={todayS} days={data.heat.days} noSpend={noSpend} level={level} onSelect={(date) => openDetail({ kind: "day", date })} />
          </div>
        </div>

        <div className="grid tiles mt">
          <div className="card tile">
            <div className="k"><CircleDollarSign {...I} />Spent</div>
            <div className="v"><AnimatedNumber value={k.spent} format={fmtBaht} /></div>
            <div className="d">
              {diff === null ? `${k.entries} entries${comp0 && !fair ? " · no data to compare" : ""}` : diff === 0 ? `same as ${PREV[period.view]}` : (
                <span className={diff > 0 ? "delta-up" : "delta-down"}>
                  {diff > 0 ? <ArrowUpRight {...I} className="inline-icon" /> : <ArrowDownRight {...I} className="inline-icon" />}
                  {baht(Math.abs(diff))} {diff > 0 ? "more" : "less"} than {PREV[period.view]}
                </span>
              )}
            </div>
          </div>
          <div className="card tile">
            <div className="k"><Target {...I} />Budget used</div>
            <div className="v">{used === null ? "–" : <AnimatedNumber value={used} format={fmtPct} />}</div>
            <div className="d">
              {k.budget === null ? "No targets yet" : k.spent > k.budget ? (
                <span className="delta-up"><TriangleAlert {...I} className="inline-icon" />Over by {baht(k.spent - k.budget)}</span>
              ) : <span>{onTrack && <Sparkles {...I} className="inline-icon" color="var(--good)" />}{baht(k.budget - k.spent)} left of {baht(k.budget)}</span>}
            </div>
          </div>
          <div className="card tile">
            <div className="k"><TrendingUp {...I} />Income</div>
            <div className="v"><AnimatedNumber value={k.income} format={fmtBaht} /></div>
            <div className="d">Net {k.net >= 0 ? "+" : "−"}{baht(Math.abs(k.net))}</div>
          </div>
          <div className="card tile">
            <div className="k"><Gauge {...I} />Per day</div>
            <div className="v"><AnimatedNumber value={k.perDay} format={fmtBaht} /></div>
            <div className="d">Logged {k.daysLogged} of {k.daysElapsed} days</div>
          </div>
        </div>

        {grain && (
          <div className="grid two mt">
            <div className="card">
              <h2><ChartColumn {...I} />{GRAIN_TITLE[grain]}</h2>
              <BarChart
                ariaLabel={GRAIN_TITLE[grain]} animKey={animKey}
                data={bs.map((b) => ({
                  key: b.key, label: b.label, value: b.spent, future: b.future,
                  title: grain === "day" ? isoDate(b.from) : `${isoDate(b.from)} to ${isoDate(b.to)}`,
                }))}
                onSelect={(i) => {
                  const b = bs[i];
                  if (grain === "day") openDetail({ kind: "day", date: isoDate(b.from) });
                  else openDetail({ kind: "range", from: isoDate(b.from), to: isoDate(b.to), title: `${isoDate(b.from)} to ${isoDate(b.to)}` });
                }}
              />
              <p className="sub" style={{ margin: "6px 0 0" }}>Tap a bar for its entries.</p>
            </div>
            <div className="card">
              <h2><TrendingUp {...I} />Running total vs budget</h2>
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

        {(wk.some((w) => w.avg > 0) || accts.length > 0) && (
          <div className="grid halves mt">
            {wk.some((w) => w.avg > 0) && (
              <div className="card">
                <h2><CalendarDays {...I} />Average by weekday</h2>
                <BarChart
                  ariaLabel="Average spending by weekday" height={170} animKey={`wd-${animKey}`}
                  data={wk.map((w) => ({ key: w.label, label: w.label, value: w.avg, title: `${w.label}, average of ${w.days} days` }))}
                />
              </div>
            )}
            {accts.length > 0 && (
              <div className="card">
                <h2><CreditCard {...I} />Paid from</h2>
                <HBars rows={accts.map((a) => ({ name: a.name, value: a.spent }))} />
              </div>
            )}
          </div>
        )}

        <div className="card mt">
          <h2><Ruler {...I} />Logging accuracy</h2>
          <div className="grid acc">
            <div>
              <div className="hero-v" style={{ fontSize: 30 }}>{accNow && accNow.captured !== null ? <AnimatedNumber value={accNow.captured * 100} format={fmtPct} /> : "–"}</div>
              <div className="d">of spending logged{accNow && accNow.captured !== null ? "" : " (nothing to judge yet)"}</div>
              {accNow && (
                <div className="sub" style={{ marginTop: 6 }}>
                  {baht(accNow.logged)} logged · {baht(accNow.unlogged)} unlogged{accNow.extra > 0 ? ` · ${baht(accNow.extra)} extra` : ""}
                </div>
              )}
              {accPrev && accPrev.captured !== null && accNow && accNow.captured !== null && (
                <div className="sub">{PREV[period.view].replace(/^same days /, "Same days ").replace(/^yesterday/, "Yesterday")}: {pct(accPrev.captured)}</div>
              )}
              <p className="sub" style={{ marginTop: 8 }}>Unlogged = money found missing at a balance check (<code>bal</code>) or a Recalibrate row.</p>
            </div>
            {grain && unloggedBars.some((b) => b.unlogged > 0) ? (
              <div>
                <div className="sub" style={{ marginBottom: 4 }}>Found missing per {grain}</div>
                <BarChart
                  ariaLabel={`Unlogged money per ${grain}`} height={150} animKey={`miss-${animKey}`}
                  data={unloggedBars.map((b) => ({ key: b.key, label: b.label, value: b.unlogged, future: b.future, title: grain === "day" ? isoDate(b.from) : `${isoDate(b.from)} to ${isoDate(b.to)}` }))}
                />
              </div>
            ) : <div className="sub">No gaps found in this period.</div>}
            <div>
              <div className="sub" style={{ marginBottom: 4 }}>Last checked</div>
              <table className="list">
                <tbody>
                  {Object.entries(data.accuracy.lastChecked).map(([a, d]) => {
                    const stale = !d || daysApart(d, todayS) > 14;
                    return (
                      <tr key={a}>
                        <td>{a}</td>
                        <td className="r">{stale ? <span className="warn"><TriangleAlert size={14} aria-hidden />{ago(d, todayS)}</span> : ago(d, todayS)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid two mt">
          <div className="card">
            <h2><Tags {...I} />Categories</h2>
            {cats.length === 0 && <p className="sub">No spending in this period.</p>}
            {cats.map((c, i) => {
              const over = c.budget !== null && c.spent > c.budget;
              return (
                <motion.button
                  key={c.name} className="cat" whileTap={{ scale: 0.98 }}
                  onClick={() => openDetail({ kind: "category", name: c.name })}
                >
                  <span className="name">{c.name}</span>
                  <span className="track" aria-hidden>
                    <motion.span
                      key={`${animKey}-${c.name}`} className="fill"
                      style={{ width: `${(Math.max(0, c.spent) / maxCat) * 100}%`, transformOrigin: "0% 50%" }}
                      initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ type: "spring", visualDuration: 0.45, bounce: 0, delay: i * 0.025 }}
                    />
                    {c.budget !== null && <span className="target" style={{ left: `calc(${(c.budget / maxCat) * 100}% - 1px)` }} />}
                  </span>
                  <span className="vals num">
                    <span>{baht(c.spent)}{c.budget !== null ? ` of ${baht(c.budget)}` : ""}</span>
                    {over ? <span className="over"><TriangleAlert size={13} aria-hidden />over {baht(c.spent - c.budget!)}</span> : c.budget !== null ? <span>{baht(c.budget - c.spent)} left</span> : <span className="muted">{c.count} {c.count === 1 ? "item" : "items"}</span>}
                  </span>
                </motion.button>
              );
            })}
            {cats.some((c) => c.budget !== null) && (
              <p className="sub" style={{ marginTop: 8 }}>The black tick is the target for this period (monthly target spread over its days). Tap a category for its entries.</p>
            )}
          </div>

          <div className="card">
            <h2><Landmark {...I} />Balances</h2>
            <table className="list num">
              {usableGroups.map((g) => (
                <tbody key={g.title}>
                  <tr>
                    <td><strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{g.icon}{g.title}</strong></td>
                    <td className="r"><strong>{baht(g.rows.reduce((s, b) => s + b.value, 0))}</strong></td>
                  </tr>
                  {g.rows.map((b) => (
                    <tr key={b.name}>
                      <td style={{ paddingLeft: 26 }}>{b.name} <span className="pill">{b.code}</span></td>
                      <td className="r" style={b.value < 0 ? { color: "var(--critical)" } : undefined}>{fmtBaht(b.value)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tbody>
                <tr>
                  <td className="muted">Total, all accounts</td>
                  <td className="r muted">{baht(data.usable.total)}</td>
                </tr>
              </tbody>
            </table>
            <p className="sub" style={{ marginTop: 8 }}>Off? Send <code>bal k 3200</code> in LINE.</p>
          </div>
        </div>

        <BudgetEditor
          categories={allCats}
          budget={data.budget}
          monthSpent={(name) => spentOf(txs.filter((t) => (t.category || "(no category)") === name && t.date.slice(0, 7) === todayS.slice(0, 7)))}
          hasThisMonth={txs.some((t) => t.date.slice(0, 7) === todayS.slice(0, 7)) || isoDate(period.from).slice(0, 7) === todayS.slice(0, 7)}
          onSaved={(cat, target) => {
            cache.current.clear();
            setData({ ...data, budget: Object.fromEntries(Object.entries({ ...data.budget, [cat]: target }).filter(([, v]) => v > 0)) });
          }}
        />

        <div className="card mt">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}><ListOrdered {...I} />Transactions</h2>
            {catFilter && <Press className="btn" onClick={() => setCatFilter(null)}>{catFilter} ×</Press>}
          </div>
          <TxList rows={rows} limit={showAll ? undefined : 30} />
          {!showAll && rows.length > 30 && <Press className="btn mt" onClick={() => setShowAll(true)}>Show all {rows.length}</Press>}
        </div>

        {data.skipped.length > 0 && (
          <p className="sub mt">Not included (older sheet layout): {data.skipped.join(", ")}</p>
        )}
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={sheetTitle}>{sheetBody}</Sheet>
    </Shell>
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
    setMsg({ ...msg, [cat]: "Saved" });
    onSaved(cat, target);
  };

  return (
    <div className="card mt">
      <h2><PiggyBank {...I} />Monthly budget</h2>
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
                      {t && spent > t ? <TriangleAlert size={13} aria-hidden className="inline-icon" /> : null}{baht(spent)}
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
                      <Press className="btn primary" disabled={busy === c} onClick={() => save(c)}>{busy === c ? "…" : "Save"}</Press>
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
