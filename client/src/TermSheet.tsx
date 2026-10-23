import { Fragment } from "react";
import type { NegotiationView, UserView } from "./api";
import type { TransactionClientView } from "../../server/transaction/engine";
import { describeTerms } from "../../server/negotiation/terms";
import { latestOfferBy, mySide } from "./negotiationUtils";
import { displayDate, money } from "../../server/narrative/format";

/** Side-by-side comparison of each side's latest position, highlighting open issues. */
export function TermSheet({ view, negotiation }: { view: UserView; negotiation: NegotiationView | null }) {
  const me = mySide(view);
  const them = me === "buyer" ? "seller" : "buyer";
  const mine = latestOfferBy(negotiation, me);
  const theirs = latestOfferBy(negotiation, them);
  const accepted = negotiation?.offers.find((o) => o.id === negotiation.acceptedOfferId) ?? null;
  const p = view.public.property;

  const tx = negotiation?.transaction;
  if (tx) {
    const original = describeTerms(tx.originalTerms, view.public);
    const current = describeTerms(tx.terms, view.public);
    const chip = tx.status === "closed" ? ["status-deal", "Completed"] : tx.status === "terminated" ? ["status-dead", { void: "Null and void", terminated: "Terminated", buyer_default: "Buyer default", seller_default: "Seller default", completed: "Completed" }[tx.outcome?.kind ?? "terminated"]] : ["status-deal", tx.firm ? "Firm" : "Conditional"];
    return (
      <>
        <div className={`status-chip ${chip[0]}`}>{chip[1]}</div>
        <table className="term-table">
          <tbody>
            {current.map((line, i) => {
              const changed = line.value !== original[i]?.value;
              return (
                <tr key={line.key} className={changed ? "amended" : ""}>
                  <th>{line.label}</th>
                  <td>
                    {line.value}
                    {changed && <div className="muted small was">was {original[i]?.value}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>Conditions</h3>
        {tx.conditions.length === 0 ? (
          <p className="muted small">None. This was a firm deal.</p>
        ) : (
          <dl className="kv small">
            {tx.conditions.map((c) => (
              <Fragment key={c.key}>
                <dt>{c.label}</dt>
                <dd className={`contingency c-${c.status}`}>
                  {c.status === "pending" ? `pending until ${displayDate(tx.deadlineDates[`condition:${c.key}`])}` : c.status}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
        <dl className="kv small">
          <dt>Status</dt>
          <dd className="strong">{tx.status !== "active" ? (tx.outcome?.kind === "completed" ? "Completed" : "Ended") : tx.firm ? "Firm" : "Conditional"}</dd>
          {tx.appraisedValue !== null && (
            <>
              <dt>Lender's appraisal</dt>
              <dd>{money(tx.appraisedValue)}</dd>
            </>
          )}
          {tx.buyerGapCash > 0 && (
            <>
              <dt>Buyer's extra cash for the appraisal shortfall</dt>
              <dd>{money(tx.buyerGapCash)}</dd>
            </>
          )}
        </dl>
        <h3>Calendar</h3>
        <ol className="calendar">
          {calendarRows(tx).map((row) => (
            <li key={row.key} className={`cal-${row.state}`}>
              <span className="cal-date">{displayDate(row.date)}</span>
              <span className="cal-label">
                {row.label}
                {row.deadline && <span className="cal-deadline">deadline</span>}
              </span>
            </li>
          ))}
        </ol>
      </>
    );
  }

  if (accepted) return null;

  if (!mine && !theirs) {
    return (
      <>
        <p className="muted small">No offers yet. Listed at {money(p.listPrice)}.</p>
        <MarketFacts view={view} />
      </>
    );
  }

  const myLines = mine ? describeTerms(mine.terms, view.public) : null;
  const theirLines = theirs ? describeTerms(theirs.terms, view.public) : null;
  const rows = (theirLines ?? myLines)!;
  const otherName = view.opposingAgent.name.split(" ")[0];

  return (
    <>
      {negotiation?.status === "dead" && <div className="status-chip status-dead">Deal fell apart</div>}
      <table className="term-table compare">
        <thead>
          <tr>
            <th />
            <th>You</th>
            <th>{otherName}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((line, i) => {
            const a = myLines?.[i]?.value ?? "—";
            const b = theirLines?.[i]?.value ?? "—";
            const open = myLines && theirLines && a !== b;
            return (
              <tr key={line.key} className={open ? "open-issue" : ""}>
                <th>{line.label}</th>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {myLines && theirLines && <p className="muted small">Highlighted rows are still open.</p>}
      <MarketFacts view={view} />
    </>
  );
}

function MarketFacts({ view }: { view: UserView }) {
  const p = view.public.property;
  const m = view.public.market;
  return (
    <dl className="kv small facts">
      <dt>List price</dt>
      <dd>{money(p.listPrice)}</dd>
      <dt>Days on market</dt>
      <dd>{p.daysOnMarket}</dd>
      <dt>Typical deposit</dt>
      <dd>{m.typicalDepositPct}%</dd>
      <dt>Land transfer tax</dt>
      <dd>{m.torontoMltt ? "Ontario plus Toronto" : "Ontario"}</dd>
    </dl>
  );
}

interface CalendarRow {
  key: string;
  date: string;
  label: string;
  deadline: boolean;
  state: "past" | "today" | "upcoming" | "missed";
}

/** Deadlines and milestones in date order, marked past, today or upcoming. */
function calendarRows(tx: TransactionClientView): CalendarRow[] {
  const rows: CalendarRow[] = [];
  const dayState = (day: number): CalendarRow["state"] => (day < tx.day ? "past" : day === tx.day ? "today" : "upcoming");
  for (const e of tx.eventLabels) {
    rows.push({ key: `e-${e.label}-${e.day}`, date: e.date, label: e.label, deadline: false, state: dayState(e.day) });
  }
  for (const d of tx.deadlines) {
    const passedUnmet = d.status === "passed";
    rows.push({ key: `d-${d.id}`, date: tx.deadlineDates[d.id], label: d.label, deadline: d.id !== "completion", state: passedUnmet && d.id !== "completion" ? "missed" : dayState(d.day) });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
