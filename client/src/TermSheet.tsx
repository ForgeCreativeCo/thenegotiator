import type { NegotiationView, UserView } from "./api";
import { describeTerms } from "../../server/negotiation/terms";
import { latestOfferBy, mySide } from "./negotiationUtils";
import { money } from "../../server/narrative/format";

/** Side-by-side comparison of each side's latest position, highlighting open issues. */
export function TermSheet({ view, negotiation }: { view: UserView; negotiation: NegotiationView | null }) {
  const me = mySide(view);
  const them = me === "buyer" ? "seller" : "buyer";
  const mine = latestOfferBy(negotiation, me);
  const theirs = latestOfferBy(negotiation, them);
  const accepted = negotiation?.offers.find((o) => o.id === negotiation.acceptedOfferId) ?? null;
  const p = view.public.property;

  if (accepted) {
    return (
      <>
        <div className="status-chip status-deal">Under contract</div>
        <table className="term-table">
          <tbody>
            {describeTerms(accepted.terms, view.public).map((line) => (
              <tr key={line.key}>
                <th>{line.label}</th>
                <td>{line.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Inspections, appraisal, financing and closing arrive in build step 3.</p>
      </>
    );
  }

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
  const c = view.public.market.customs;
  return (
    <dl className="kv small facts">
      <dt>List price</dt>
      <dd>{money(p.listPrice)}</dd>
      <dt>Days on market</dt>
      <dd>{p.daysOnMarket}</dd>
      <dt>Typical earnest money</dt>
      <dd>{c.typicalEarnestMoneyPct}%</dd>
      <dt>Closing by</dt>
      <dd>{{ escrow: "Escrow company", attorney: "Closing attorney", title_company: "Title company" }[c.closing]}</dd>
    </dl>
  );
}
