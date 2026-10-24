import { useEffect, useState } from "react";
import { api, type Debrief, type UserView } from "./api";
import type { BuyerBrief, SellerBrief } from "../../server/engine/types";
import { CONDITION_LABELS, FINANCING_LABELS, MOTIVATION_LABELS, displayDate, money } from "../../server/narrative/format";
import { simClock } from "./negotiationUtils";

/** The full debrief: scores, both sides revealed, hidden facts, the agent's reasoning, and RECO compliance. */
export function DebriefView({ view, onClose }: { view: UserView; onClose: () => void }) {
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.debrief(view.id).then((r) => setDebrief(r.debrief)).catch((e: Error) => setError(e.message));
  }, [view.id]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Debrief">
      <div className="modal debrief">
        <header className="modal-header">
          <div>
            <h2>Debrief</h2>
            <div className="muted small">
              {view.public.property.address.street}, {view.public.property.address.municipality}
            </div>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close debrief">
            ✕
          </button>
        </header>
        {error && <div className="form-error">{error}</div>}
        {!debrief && !error && <div className="typing">Pulling the file together…</div>}
        {debrief && <DebriefBody view={view} d={debrief} />}
      </div>
    </div>
  );
}

function DebriefBody({ view, d }: { view: UserView; d: Debrief }) {
  const ds = d.dealSpace;
  const lo = Math.min(ds.sellerFloor, ds.buyerCeiling, ds.listPrice, ds.finalNet ?? Infinity) * 0.98;
  const hi = Math.max(ds.sellerFloor, ds.buyerCeiling, ds.listPrice, ds.finalNet ?? 0) * 1.02;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="debrief-body">
      <section className="debrief-scores">
        <div className="outcome-line">
          <strong>{d.outcome.label}.</strong> <span className="muted">{d.outcome.summary}</span>
        </div>
        <div className="score-grid">
          <Score label="Overall" value={d.scores.overall} big />
          <Score label="Outcome" value={d.scores.outcome} hint="Your client's result against what was possible" />
          <Score label="Process" value={d.scores.process} hint="How you negotiated and handled deadlines" />
          <Score label="RECO compliance" value={d.scores.compliance} hint="Confidentiality, honesty, and the offer rules" />
        </div>
      </section>

      <section>
        <h3>The deal space</h3>
        <div className="deal-bar" aria-label="Deal space">
          {ds.possible && <div className="deal-zone" style={{ left: pos(ds.sellerFloor), width: `calc(${pos(ds.buyerCeiling)} - ${pos(ds.sellerFloor)})` }} />}
          <Marker at={pos(ds.sellerFloor)} label={`Seller's floor ${money(ds.sellerFloor)}`} kind="floor" />
          <Marker at={pos(ds.buyerCeiling)} label={`Buyer's ceiling ${money(ds.buyerCeiling)}`} kind="ceiling" />
          <Marker at={pos(ds.listPrice)} label={`List ${money(ds.listPrice)}`} kind="list" />
          {ds.finalNet !== null && <Marker at={pos(ds.finalNet)} label={`Final ${money(ds.finalNet)}`} kind="final" />}
        </div>
        <p className="small">
          {ds.possible
            ? `Any price between ${money(ds.sellerFloor)} and ${money(ds.buyerCeiling)} would have worked for both clients.`
            : `There was no price both clients could sign: the seller needed ${money(ds.sellerFloor)}, the buyer could pay ${money(ds.buyerCeiling)}.`}{" "}
          {ds.yourShare !== null && `You captured ${Math.round(ds.yourShare * 100)}% of that room for your ${d.yourSide === "buyer" ? "buyers" : "sellers"}. `}
          Market value was about {money(ds.marketValue)}; the lender's appraiser would support {money(d.hidden.appraisedValue)}.
        </p>
      </section>

      <section>
        <h3>The veteran's critique</h3>
        <div className="grid-2">
          <div>
            <h4>What went well</h4>
            <ul>{d.critique.wentWell.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div>
            <h4>What to fix</h4>
            <ul>{d.critique.toImprove.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
        <div className="guidance small"><strong>Key moment:</strong> {d.critique.keyMoment}</div>
      </section>

      <section>
        <h3>RECO compliance</h3>
        {d.compliance.length === 0 ? (
          <p className="small">No concerns found. You protected your client's information and didn't misrepresent anything.</p>
        ) : (
          <ul className="flag-list">
            {d.compliance.map((f, i) => (
              <li key={i} className={`flag flag-${f.severity}`}>
                <div className="flag-head">
                  <span className={`sev sev-${f.severity === "breach" ? "major" : f.severity === "caution" ? "moderate" : "minor"}`}>{f.severity}</span>
                  <strong>{f.title}</strong>
                  {f.at !== null && <span className="muted small">{simClock(view.public.startDate, f.at)}</span>}
                </div>
                {f.quote && <blockquote className="small">“{f.quote}”</blockquote>}
                <div className="small">{f.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>How you negotiated</h3>
        <ul className="notes">
          {d.processNotes.map((n, i) => (
            <li key={i} className={n.good ? "good" : "bad"}>
              {n.text}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Both clients</h3>
        <div className="grid-2">
          <ClientReveal title="Sellers" names={d.clients.seller.story.clientNames} told={d.clients.seller.story.whatTheyveToldYou} brief={d.clients.seller.brief} yours={d.yourSide === "seller"} />
          <ClientReveal title="Buyers" names={d.clients.buyer.story.clientNames} told={d.clients.buyer.story.whatTheyveToldYou} brief={d.clients.buyer.brief} yours={d.yourSide === "buyer"} />
        </div>
      </section>

      {d.clientFacts?.length > 0 && (
        <section>
          <h3>What your client didn't tell you up front</h3>
          <ul className="notes">
            {d.clientFacts.map((f) => (
              <li key={f.summary} className={f.how === "asked" ? "good" : "bad"}>
                {f.summary}{" "}
                <span className="muted small">
                  {{ asked: "You found out by asking.", presented: "It came up when you presented an offer.", refusal: "You only found out when they refused to sign.", never: "You never found out." }[f.how]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>What was hidden</h3>
        {d.hidden.findings.length > 0 && (
          <table>
            <thead>
              <tr><th>Finding</th><th>Severity</th><th className="num">Estimate</th><th>Found?</th></tr>
            </thead>
            <tbody>
              {d.hidden.findings.map((f) => (
                <tr key={f.id}>
                  <td>{f.title}<div className="muted small">{f.sellerKnew ? "The seller knew" : "The seller didn't know"}{f.disclosed ? " · disclosed" : ""}</div></td>
                  <td>{f.severity}</td>
                  <td className="num">{f.repairCostHigh ? `${money(f.repairCostLow)}–${money(f.repairCostHigh)}` : "—"}</td>
                  <td>{f.revealed ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl className="kv small">
          {d.hidden.titleIssues.length > 0 && (<><dt>Title</dt><dd>{d.hidden.titleIssues.join(" ")}</dd></>)}
          {d.hidden.loanEvents.length > 0 && (<><dt>Mortgage</dt><dd>{d.hidden.loanEvents.join(" ")}</dd></>)}
          {d.hidden.visitSurprises.length > 0 && (<><dt>Pre-closing</dt><dd>{d.hidden.visitSurprises.join(" ")}</dd></>)}
          {d.hidden.competingOffers.length > 0 && (
            <>
              <dt>Competing buyers</dt>
              <dd>{d.hidden.competingOffers.map((c) => `${c.label}: ${money(c.price)} (${c.strength}, ${c.conditions}, ${c.status})`).join("; ")}</dd>
            </>
          )}
        </dl>
      </section>

      <section>
        <h3>Difficulty (was hidden)</h3>
        <div className="chips">
          <span className="chip">Rating: {d.difficulty.rating}</span>
          <span className="chip">Agent: {d.difficulty.temperament}</span>
          <span className="chip">Held back: {d.difficulty.withholding}</span>
          <span className="chip">Concession pace: {Math.round(d.difficulty.concessionPace * 100)}%</span>
          <span className="chip">Leverage: {d.difficulty.leverage > 0.2 ? "their client" : d.difficulty.leverage < -0.2 ? "your client" : "even"}</span>
          <span className="chip">Deal space: {d.difficulty.dealSpace}</span>
          <span className="chip">Surprises: {d.difficulty.eventVolatility}</span>
          <span className="chip">Their client: {d.difficulty.clientVolatility}</span>
        </div>
      </section>

      <section>
        <h3>What {view.opposingAgent.name.split(" ")[0]} was thinking</h3>
        <ol className="reasoning">
          {d.agentReasoning.map((r, i) => (
            <li key={i}>
              <div className="muted small">{simClock(view.public.startDate, r.at)}</div>
              <div className="small">“{r.message}”</div>
              <div className="small reasoning-note">{r.note}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Score({ label, value, hint, big }: { label: string; value: number; hint?: string; big?: boolean }) {
  const tone = value >= 75 ? "good" : value >= 50 ? "ok" : "low";
  return (
    <div className={`score score-${tone} ${big ? "score-big" : ""}`} title={hint}>
      <div className="score-value">{value}</div>
      <div className="score-label">{label}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

function Marker({ at, label, kind }: { at: string; label: string; kind: string }) {
  return (
    <div className={`marker marker-${kind}`} style={{ left: at }}>
      <span>{label}</span>
    </div>
  );
}

function ClientReveal({ title, names, told, brief, yours }: { title: string; names: string; told: string; brief: SellerBrief | BuyerBrief; yours: boolean }) {
  return (
    <div className={`client-reveal ${yours ? "yours" : ""}`}>
      <h4>
        {title}
        {yours ? " (your client)" : " (their client)"}
      </h4>
      <div className="strong">{names}</div>
      <div className="small muted">{MOTIVATION_LABELS[brief.motivation] ?? brief.motivation}; urgency {brief.urgency} of 5</div>
      <blockquote className="small">{told}</blockquote>
      <dl className="kv small">
        <dt>{brief.side === "seller" ? "Floor" : "Ceiling"}</dt>
        <dd className="strong">{money(brief.reservationPrice)}</dd>
        <dt>Completion</dt>
        <dd>{displayDate(brief.earliestClose)} to {displayDate(brief.latestClose)}</dd>
        {brief.side === "seller" ? (
          <>
            <dt>Min. deposit / longest condition</dt>
            <dd>{brief.minDepositPct}% / {brief.maxConditionDays} banking days</dd>
          </>
        ) : (
          <>
            <dt>Financing</dt>
            <dd>{brief.financing === "cash" ? "Cash" : `${FINANCING_LABELS[brief.financing]}, ${brief.downPaymentPct}% down`}</dd>
            <dt>Would go without</dt>
            <dd>{brief.willingToWaive.length ? brief.willingToWaive.map((k) => CONDITION_LABELS[k].toLowerCase()).join(", ") : "nothing"}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
