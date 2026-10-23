import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Progress } from "./api";
import { money, typeLabel } from "../../server/narrative/format";
import type { PropertyType } from "../../server/engine/types";

type RoleFilter = "all" | "buyer_agent" | "seller_agent";
type Deal = Progress["deals"][number];

const RULE_LABELS: Record<keyof Progress["totals"]["byRule"], string> = {
  confidentiality: "Confidential information",
  misrepresentation: "Misrepresentation",
  disclosure_direction: "Disclosure without direction",
  client_instructions: "Outside client's instructions",
  legal_advice: "Legal advice",
  count_rule: "Offer count rule",
};

/** Progress across practice deals: headline numbers, score trend, compliance breakdown, and every deal. */
export function ProgressView({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<RoleFilter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const load = () => api.progress().then(setProgress).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const deals = useMemo(() => (progress?.deals ?? []).filter((d) => role === "all" || d.role === role), [progress, role]);
  const finished = deals.filter((d) => d.scores);

  async function remove(id: string) {
    await api.deleteScenario(id).catch((e: Error) => setError(e.message));
    await load();
    onChanged();
  }

  async function clearAll() {
    await api.deleteAll().catch((e: Error) => setError(e.message));
    setConfirmClear(false);
    await load();
    onChanged();
  }

  if (error) return <div className="form-error">{error}</div>;
  if (!progress) return <div className="typing">Adding up your deals…</div>;

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const overall = finished.map((d) => d.scores!.overall);
  const recent = avg(overall.slice(-5));
  const all = avg(overall);
  const completed = finished.filter((d) => d.outcome === "Completed" || d.outcome === "Sold to another buyer").length;
  const byRule = new Map<string, number>();
  for (const d of finished) for (const r of d.complianceRules) byRule.set(r, (byRule.get(r) ?? 0) + 1);

  return (
    <div className="progress">
      <div className="progress-head">
        <div>
          <h1>Your progress</h1>
          <p className="muted small">Scores come from each deal's debrief. Only finished deals are scored.</p>
        </div>
        <div className="row filter-row" role="group" aria-label="Filter by role">
          {(["all", "buyer_agent", "seller_agent"] as RoleFilter[]).map((r) => (
            <button key={r} className={role === r ? "seg active" : "seg"} onClick={() => setRole(r)}>
              {r === "all" ? "All deals" : r === "buyer_agent" ? "As buyer's agent" : "As listing agent"}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Deals finished" value={String(finished.length)} sub={`${deals.length - finished.length} not finished`} />
        <Kpi label="Closed or sold" value={finished.length ? `${Math.round((completed / finished.length) * 100)}%` : "—"} sub={`${completed} of ${finished.length}`} />
        <Kpi label="Average score" value={all === null ? "—" : String(all)} sub={recent !== null && all !== null && overall.length > 5 ? `${recent >= all ? "+" : ""}${recent - all} in your last 5` : "Out of 100"} />
        <Kpi label="Compliance flags" value={String(finished.reduce((n, d) => n + d.complianceRules.length, 0))} sub="Across finished deals (breaches and cautions)" />
      </div>

      <section className="panel chart-card">
        <h2>Scores over time</h2>
        {finished.length < 2 ? <p className="muted small">Finish at least two deals to see a trend.</p> : <TrendChart deals={finished} />}
      </section>

      <section className="panel chart-card">
        <h2>Compliance flags by rule</h2>
        {byRule.size === 0 ? <p className="muted small">No compliance flags yet. Keep it that way.</p> : <RuleBars counts={byRule} />}
      </section>

      <section className="panel">
        <div className="table-head">
          <h2>All deals</h2>
          {progress.deals.length > 0 &&
            (confirmClear ? (
              <span className="confirm-walk">
                Delete every practice deal for good?
                <button className="danger" onClick={clearAll}>
                  Yes, delete all
                </button>
                <button className="ghost" onClick={() => setConfirmClear(false)}>
                  No
                </button>
              </span>
            ) : (
              <button className="ghost" onClick={() => setConfirmClear(true)}>
                Clear all practice deals
              </button>
            ))}
        </div>
        {deals.length === 0 ? (
          <p className="muted small">No deals yet. Start one with New scenario.</p>
        ) : (
          <div className="table-scroll">
            <table className="deals-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Deal</th>
                  <th>Role</th>
                  <th>Result</th>
                  <th className="num">Overall</th>
                  <th className="num">Outcome</th>
                  <th className="num">Process</th>
                  <th className="num">RECO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...deals].reverse().map((d) => (
                  <DealRow key={d.id} d={d} onOpen={onOpen} onDelete={remove} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function DealRow({ d, onOpen, onDelete }: { d: Deal; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <tr>
      <td>{new Date(d.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</td>
      <td>
        {d.region}
        <div className="muted small">
          {typeLabel(d.propertyType as PropertyType)} · {money(d.listPrice)}
          {d.difficulty ? ` · ${d.difficulty}` : ""}
        </div>
      </td>
      <td>{d.role === "buyer_agent" ? "Buyer's agent" : "Listing agent"}</td>
      <td>{d.outcome ?? (d.status === "in_progress" ? "In progress" : "Not started")}</td>
      <td className="num strong">{d.scores?.overall ?? "—"}</td>
      <td className="num">{d.scores?.outcome ?? "—"}</td>
      <td className="num">{d.scores?.process ?? "—"}</td>
      <td className="num">{d.scores?.compliance ?? "—"}</td>
      <td className="row row-end">
        <button className="secondary" onClick={() => onOpen(d.id)}>
          Open
        </button>
        {confirm ? (
          <>
            <button className="danger" onClick={() => onDelete(d.id)}>
              Delete
            </button>
            <button className="ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="ghost" aria-label={`Delete ${d.region} deal`} onClick={() => setConfirm(true)}>
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="muted small">{sub}</div>
    </div>
  );
}

const SERIES = [
  { key: "overall" as const, label: "Overall", color: "var(--series-1)" },
  { key: "compliance" as const, label: "RECO compliance", color: "var(--series-2)" },
];

/** Overall and compliance scores per finished deal, on one 0–100 axis, with a crosshair tooltip. */
function TrendChart({ deals }: { deals: Deal[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 240;
  const pad = { top: 16, right: 120, bottom: 28, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (deals.length === 1 ? plotW / 2 : (i / (deals.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / 100) * plotH;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.left) / plotW) * (deals.length - 1));
    setHover(Math.max(0, Math.min(deals.length - 1, i)));
  }

  const h = hover !== null ? deals[hover] : null;
  return (
    <div className="trend">
      <div className="legend" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="legend-item">
            <span className="legend-line" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="trend-plot">
        <svg ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Overall and RECO compliance scores per finished deal" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(v)} y2={y(v)} className="grid" />
              <text x={pad.left - 8} y={y(v) + 4} className="tick" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {deals.map((_, i) => (
            <text key={i} x={x(i)} y={height - 8} className="tick" textAnchor="middle">
              {deals.length <= 12 || i % Math.ceil(deals.length / 12) === 0 ? i + 1 : ""}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} className="crosshair" />}
          {SERIES.map((s) => {
            const points = deals.map((d, i) => `${x(i)},${y(d.scores![s.key])}`).join(" ");
            const last = deals[deals.length - 1].scores![s.key];
            return (
              <g key={s.key}>
                <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {deals.map((d, i) => (
                  <circle key={i} cx={x(i)} cy={y(d.scores![s.key])} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
                <text x={x(deals.length - 1) + 10} y={y(last) + (s.key === "overall" && Math.abs(last - deals[deals.length - 1].scores!.compliance) < 8 ? -6 : 4)} className="end-label">
                  {s.label} {last}
                </text>
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="chart-tooltip" style={{ left: `${(x(hover) / width) * 100}%` }}>
            <div className="muted small">
              Deal {hover + 1}: {h.region}
            </div>
            {SERIES.map((s) => (
              <div key={s.key} className="tooltip-row">
                <span className="legend-line" style={{ background: s.color }} />
                <strong>{h.scores![s.key]}</strong>
                <span className="muted small">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="small">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Deal</th>
              <th className="num">Overall</th>
              <th className="num">RECO compliance</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d, i) => (
              <tr key={d.id}>
                <td>{i + 1}</td>
                <td>{d.region}</td>
                <td className="num">{d.scores!.overall}</td>
                <td className="num">{d.scores!.compliance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** How often each compliance rule was flagged: one hue, values at the bar tips. */
function RuleBars({ counts }: { counts: Map<string, number> }) {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map(([, n]) => n));
  return (
    <div className="rule-bars">
      {rows.map(([rule, n]) => (
        <div key={rule} className="rule-row" title={`${RULE_LABELS[rule as keyof typeof RULE_LABELS]}: ${n}`}>
          <span className="rule-label">{RULE_LABELS[rule as keyof typeof RULE_LABELS] ?? rule}</span>
          <span className="rule-track">
            <span className="rule-bar" style={{ width: `${(n / max) * 100}%` }} />
            <span className="rule-value">{n}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
