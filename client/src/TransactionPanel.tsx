import { useState } from "react";
import { ApiError, api, type NegotiationView, type TxAction, type UserView } from "./api";
import type { Issue, Proposal } from "../../server/transaction/types";
import type { TransactionClientView } from "../../server/transaction/engine";
import { displayDate, money } from "../../server/narrative/format";
import { mySide } from "./negotiationUtils";

interface Props {
  view: UserView;
  tx: TransactionClientView;
  onChange: (n: NegotiationView) => void;
}

/** Post-contract controls: the clock, open issues, termination rights, and chat. */
export function TransactionPanel({ view, tx, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [text, setText] = useState("");
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [dateChange, setDateChange] = useState<string | null>(null);
  const me = mySide(view);
  const other = view.opposingAgent.name.split(" ")[0];

  async function act(action: TxAction, label: string) {
    setBusy(label);
    setError(null);
    try {
      const result = await api.actTx(view.id, action);
      onChange(result.negotiation);
      setText("");
      setConfirmTerminate(false);
      setDateChange(null);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, details: err.details ?? [] });
    } finally {
      setBusy(null);
    }
  }

  if (tx.status !== "active") return <Outcome view={view} tx={tx} />;

  const open = tx.issues.filter((i) => i.status === "open");
  const deadlinesToday = tx.deadlines.filter((d) => d.status === "upcoming" && d.day === tx.day && d.id !== "closing");

  return (
    <div className="tx-panel">
      <div className="tx-clock">
        <div>
          <div className="eyebrow">Today</div>
          <div className="tx-today">{displayDate(tx.today)}</div>
          <div className="muted small">
            Day {tx.day} of {tx.closingDay} · closing {tx.closingDateDisplay}
          </div>
        </div>
        <div className="row">
          <button className="secondary" disabled={Boolean(busy)} onClick={() => act({ type: "advance", mode: "day" }, "advance")}>
            Next day
          </button>
          <button className="primary" disabled={Boolean(busy)} onClick={() => act({ type: "advance", mode: "next" }, "advance")}>
            {busy === "advance" ? "Working…" : tx.nextStop ? `Skip to ${displayDate(tx.nextStop.date)}` : "Continue"}
          </button>
        </div>
      </div>
      {deadlinesToday.length > 0 && (
        <div className="banner-inline warn">
          Due today: {deadlinesToday.map((d) => d.label.toLowerCase()).join(", ")}. Moving to the next day lets it pass.
        </div>
      )}

      {open.length === 0 && <p className="muted small">Nothing needs your attention right now. Move the calendar forward to keep the deal moving.</p>}
      {open.map((issue) => (
        <IssueCard key={`${issue.id}-${issue.proposals.length}`} issue={issue} view={view} tx={tx} busy={Boolean(busy)} other={other} onAct={act} />
      ))}

      {error && (
        <div className="form-error">
          <strong>{error.message}</strong>
          {error.details.length > 0 && (
            <ul>
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="composer">
        <textarea
          rows={2}
          value={text}
          placeholder={`Message ${other}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && text.trim() && !busy) {
              e.preventDefault();
              act({ type: "message", text }, "message");
            }
          }}
          disabled={Boolean(busy)}
        />
        <div className="composer-actions">
          <button className="secondary" disabled={!text.trim() || Boolean(busy)} onClick={() => act({ type: "message", text }, "message")}>
            Send
          </button>
          {dateChange === null ? (
            <button className="ghost" disabled={Boolean(busy)} onClick={() => setDateChange(tx.terms.closingDate)}>
              Ask to change closing date
            </button>
          ) : (
            <span className="inline-form">
              <input type="date" value={dateChange} onChange={(e) => setDateChange(e.target.value)} />
              <button className="secondary" disabled={Boolean(busy)} onClick={() => act({ type: "request_date_change", closingDate: dateChange, text }, "date")}>
                Request
              </button>
              <button className="ghost" onClick={() => setDateChange(null)}>
                Cancel
              </button>
            </span>
          )}
          {me === "buyer" &&
            (confirmTerminate ? (
              <span className="confirm-walk">
                Terminate the contract?
                <button className="danger" onClick={() => act({ type: "terminate", text }, "terminate")}>
                  Yes, terminate
                </button>
                <button className="ghost" onClick={() => setConfirmTerminate(false)}>
                  No
                </button>
              </span>
            ) : (
              <button className="ghost" disabled={Boolean(busy)} onClick={() => setConfirmTerminate(true)}>
                Terminate…
              </button>
            ))}
        </div>
        {me === "buyer" && (
          <div className="muted small">
            {tx.rights.length
              ? `Your buyers can cancel and keep their earnest money under: ${tx.rights.map((r) => `${r.label} (until ${displayDate(addDays(tx.effectiveDate, r.untilDay))})`).join("; ")}.`
              : "Your buyers have no contingency that lets them cancel right now without losing their earnest money."}
          </div>
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue, view, tx, busy, other, onAct }: { issue: Issue; view: UserView; tx: TransactionClientView; busy: boolean; other: string; onAct: (a: TxAction, label: string) => void }) {
  const me = mySide(view);
  const last = issue.proposals[issue.proposals.length - 1] as Proposal | undefined;
  const isDate = issue.kind === "extension" || issue.kind === "date_change";
  const isMoney = ["repairs", "appraisal", "title", "walkthrough"].includes(issue.kind);
  const [amount, setAmount] = useState<number>(last?.amount || issue.reference || (issue.kind === "possession" ? 5 : 0));
  const [date, setDate] = useState<string>(last?.closingDate ?? issue.neededDate ?? tx.terms.closingDate);
  const [form, setForm] = useState<NonNullable<Proposal["form"]>>(last?.form ?? (issue.kind === "appraisal" ? "price_reduction" : "credit"));

  const myTurnToRequest = issue.proposals.length === 0 && issue.requester === me;
  const theirMove = last && last.by !== me;
  const waiting = (issue.proposals.length === 0 && issue.requester !== me) || (last && last.by === me);
  const deadline = issue.deadlineDay !== null ? displayDate(addDays(tx.effectiveDate, issue.deadlineDay)) : null;

  const proposeAction = (): TxAction => ({ type: "propose", issueId: issue.id, amount, closingDate: isDate ? date : undefined, form: isMoney ? form : undefined });

  const amountInput = isDate ? (
    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
  ) : issue.kind === "possession" ? (
    <span className="money-input">
      <input type="number" min={0} max={60} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      <span>days</span>
    </span>
  ) : isMoney ? (
    <>
      <span className="money-input">
        <span>$</span>
        <input type="number" min={0} step={250} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </span>
      {issue.kind !== "appraisal" && (
        <select value={form} onChange={(e) => setForm(e.target.value as NonNullable<Proposal["form"]>)}>
          <option value="credit">as a credit</option>
          <option value="price_reduction">as a price reduction</option>
          <option value="repairs">as seller repairs</option>
        </select>
      )}
    </>
  ) : null;

  return (
    <div className={`issue-card kind-${issue.kind}`}>
      <div className="issue-head">
        <strong>{issue.title}</strong>
        {deadline && <span className="pill pill-warn">Deadline {deadline}</span>}
      </div>
      <p className="small">{issue.detail}</p>
      {tx.guidance[issue.id] && <div className="guidance small">{tx.guidance[issue.id]}</div>}
      {issue.proposals.length > 0 && (
        <ul className="proposal-list small">
          {issue.proposals.map((p) => (
            <li key={p.id}>
              <span className="muted">{p.by === me ? "You" : other}:</span> {describeProposal(issue, p)}
            </li>
          ))}
        </ul>
      )}

      {issue.kind === "loan" ? (
        <p className="muted small">{me === "buyer" ? "Decide whether to terminate before the financing contingency runs out." : `Waiting to hear whether the buyers will terminate.`}</p>
      ) : issue.kind === "kickout" && me === "buyer" && theirMove ? (
        <div className="issue-actions">
          <button className="accept" disabled={busy} onClick={() => onAct({ type: "accept", issueId: issue.id }, "accept")}>
            Remove the contingency
          </button>
          <span className="muted small">Or terminate to release the contract and get the earnest money back.</span>
        </div>
      ) : myTurnToRequest ? (
        <div className="issue-actions">
          {issue.kind === "kickout" ? (
            <button className="primary" disabled={busy} onClick={() => onAct({ type: "propose", issueId: issue.id, amount: 0 }, "propose")}>
              Send kick-out notice
            </button>
          ) : (
            <>
              {amountInput}
              <button className="primary" disabled={busy} onClick={() => onAct(proposeAction(), "propose")}>
                Send request
              </button>
            </>
          )}
          <button className="ghost" disabled={busy} onClick={() => onAct({ type: "withdraw", issueId: issue.id }, "withdraw")}>
            {issue.kind === "repairs" ? "Accept as-is" : "Drop it"}
          </button>
        </div>
      ) : theirMove ? (
        <div className="issue-actions">
          {last!.kind !== "reject" && (
            <button className="accept" disabled={busy} onClick={() => onAct({ type: "accept", issueId: issue.id }, "accept")}>
              Accept
            </button>
          )}
          {amountInput}
          <button className="secondary" disabled={busy} onClick={() => onAct(proposeAction(), "propose")}>
            Counter
          </button>
          {last!.kind !== "reject" && (
            <button className="ghost" disabled={busy} onClick={() => onAct({ type: "reject", issueId: issue.id }, "reject")}>
              Decline
            </button>
          )}
          {issue.requester === me && last!.kind === "reject" && (
            <button className="ghost" disabled={busy} onClick={() => onAct({ type: "withdraw", issueId: issue.id }, "withdraw")}>
              {issue.kind === "repairs" ? "Accept as-is" : "Drop it"}
            </button>
          )}
        </div>
      ) : waiting ? (
        <p className="muted small">Waiting on {other}.</p>
      ) : null}
    </div>
  );
}

function describeProposal(issue: Issue, p: Proposal): string {
  if (p.kind === "reject") return "declined";
  const verb = p.kind === "accept" ? "agreed to" : p.kind === "request" ? "asked for" : "countered with";
  if (issue.kind === "kickout") return p.kind === "accept" ? "removed the contingency" : "sent the kick-out notice";
  if (issue.kind === "extension" || issue.kind === "date_change") return `${verb} closing on ${p.closingDate ? displayDate(p.closingDate) : "?"}`;
  if (issue.kind === "possession") return `${verb} ${p.amount} days`;
  const form = p.form === "price_reduction" ? "price reduction" : p.form === "repairs" ? "in repairs" : "credit";
  return `${verb} ${money(p.amount)} ${form}`;
}

function Outcome({ view, tx }: { view: UserView; tx: TransactionClientView }) {
  const o = tx.outcome!;
  const st = tx.settlement;
  const me = mySide(view);
  const brief = view.yourClient.brief;
  const em = { applied_at_closing: "Applied to the buyer's funds at closing", returned_to_buyer: "Returned to the buyer", released_to_seller: "Released to the seller" }[o.earnestMoney];
  return (
    <div className="tx-outcome">
      <div className={`ended ${o.kind === "closed" ? "ended-deal" : "ended-dead"}`}>
        {o.kind === "closed" ? `Closed on ${displayDate(addDays(tx.effectiveDate, o.day))}` : o.kind === "terminated" ? "Contract terminated" : o.kind === "buyer_default" ? "Buyer default" : "Seller default"}
      </div>
      <p className="small">{o.reason}</p>
      <dl className="kv small">
        <dt>Earnest money</dt>
        <dd>
          {money(tx.terms.earnestMoney)}: {em}
        </dd>
      </dl>
      {st && (
        <>
          <h4>Settlement summary</h4>
          <dl className="kv small">
            <dt>Final price</dt>
            <dd>{money(st.price)}</dd>
            <dt>Seller credits</dt>
            <dd>{money(st.sellerCredits)}</dd>
            {st.repairsAgreed > 0 && (
              <>
                <dt>Seller repairs</dt>
                <dd>{money(st.repairsAgreed)}</dd>
              </>
            )}
            {st.homeWarranty > 0 && (
              <>
                <dt>Home warranty</dt>
                <dd>{money(st.homeWarranty)}</dd>
              </>
            )}
            <dt>Seller net before commissions and costs</dt>
            <dd className="strong">{money(st.sellerNetBeforeCosts)}</dd>
            <dt>Seller's estimated proceeds after payoff</dt>
            <dd>{money(st.sellerProceedsEstimate)}</dd>
            <dt>Loan amount</dt>
            <dd>{money(st.loanAmount)}</dd>
            <dt>Buyer's cash to close (est.)</dt>
            <dd>{money(st.buyerCashToClose)}</dd>
          </dl>
          <div className="guidance small">
            {me === "seller"
              ? `Your sellers' floor was ${money(brief.reservationPrice)} net. They netted ${money(st.sellerNetBeforeCosts)}.`
              : `Your buyers' ceiling was ${money(brief.reservationPrice)}. They paid ${money(st.price - st.sellerCredits)} net of credits.`}{" "}
            A full debrief of both sides arrives in build step 6.
          </div>
        </>
      )}
    </div>
  );
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
