import { useState } from "react";
import { ApiError, api, type NegotiationView, type TxAction, type UserView } from "./api";
import type { ConditionState, Issue, Proposal } from "../../server/transaction/types";
import type { TransactionClientView } from "../../server/transaction/engine";
import { displayDate, money } from "../../server/narrative/format";
import { mySide } from "./negotiationUtils";
import { ClientReviewCard } from "./ClientReviewCard";

/** Documents the client signs before they go out. Declining or dropping a request is an instruction, not a signature. */
const SIGNED = ["condition", "release", "request_condition_extension", "request_date_change", "propose", "accept"];

function documentLabel(a: TxAction): string {
  if (a.type === "condition") return a.how === "waive" ? "waiver" : "notice of fulfilment";
  if (a.type === "release") return "mutual release";
  if (a.type === "propose") return "proposal";
  return "amendment";
}

interface Props {
  view: UserView;
  tx: TransactionClientView;
  negotiation: NegotiationView;
  onChange: (n: NegotiationView) => void;
}

/** After acceptance: the clock, conditions, open issues, and chat. */
export function TransactionPanel({ view, tx, negotiation, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [text, setText] = useState("");
  const [dateChange, setDateChange] = useState<string | null>(null);
  const me = mySide(view);
  const other = view.opposingAgent.name.split(" ")[0];
  const [reviewing, setReviewing] = useState<{ action: TxAction; label: string } | null>(null);
  const reviewRequired = Boolean(negotiation.client?.reviewRequired);

  async function send(action: TxAction, label: string): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      const result = await api.actTx(view.id, action);
      onChange(result.negotiation);
      setText("");
      setDateChange(null);
      return true;
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, details: err.details ?? [] });
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Signed documents go past your client first, when the deal requires it. */
  async function act(action: TxAction, label: string) {
    if (!reviewRequired || !SIGNED.includes(action.type)) {
      await send(action, label);
      return;
    }
    setReviewing(null);
    if (await send({ type: "client_review", pending: action }, "review")) setReviewing({ action, label });
  }

  if (tx.status !== "active") return <Outcome view={view} tx={tx} />;

  const open = tx.issues.filter((i) => i.status === "open");
  const dueToday = [
    ...tx.conditions.filter((c) => c.status === "pending" && c.deadlineDay === tx.day).map((c) => `the ${c.label.toLowerCase()} condition`),
    ...open.filter((i) => i.deadlineDay === tx.day && !i.conditionKey).map((i) => i.title.toLowerCase()),
  ];
  const pending = tx.conditions.filter((c) => c.status === "pending");
  const unpresented = open.filter((i) => {
    const last = i.proposals[i.proposals.length - 1];
    return last && last.by !== me && !(negotiation.client?.presented ?? []).includes(`issue:${i.id}:${last.id}`);
  });

  return (
    <div className="tx-panel">
      <div className="tx-clock">
        <div>
          <div className="eyebrow">Today · {tx.firm ? "Firm" : "Conditional"}</div>
          <div className="tx-today">{displayDate(tx.today)}</div>
          <div className="muted small">
            Day {tx.day} of {tx.closingDay} · completion {tx.closingDateDisplay}
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
      {dueToday.length > 0 && (
        <div className="banner-inline warn">
          Due today: {dueToday.join(", ")}.{me === "buyer" && pending.some((c) => c.deadlineDay === tx.day) ? " If it isn't waived or fulfilled today, the agreement becomes null and void tomorrow." : ""}
        </div>
      )}

      {pending.length > 0 && (
        <section className="conditions-panel">
          <h3>Conditions</h3>
          {pending.map((c) => (
            <ConditionCard key={c.key} condition={c} tx={tx} me={me} busy={Boolean(busy)} onAct={act} />
          ))}
        </section>
      )}

      {open.length === 0 && pending.length === 0 && <p className="muted small">Nothing needs your attention right now. Move the calendar forward to keep the deal moving.</p>}
      {reviewRequired && unpresented.length > 0 && (
        <div className="guidance small">
          Present {unpresented.map((i) => i.title.toLowerCase()).join(" and ")} to your {me === "buyer" ? "buyers" : "sellers"} before you answer. Use the conversation tab with them.
        </div>
      )}
      {open.map((issue) => (
        <IssueCard key={`${issue.id}-${issue.proposals.length}`} issue={issue} view={view} tx={tx} busy={Boolean(busy)} other={other} onAct={act} />
      ))}

      {busy === "review" && <div className="typing">Your {me === "buyer" ? "buyers are" : "sellers are"} reading it over…</div>}
      {reviewing && (
        <ClientReviewCard
          negotiation={negotiation}
          clientNames={view.yourClient.story.clientNames}
          action={reviewing.action}
          agentFirstName={other}
          documentLabel={documentLabel(reviewing.action)}
          sendLabel={reviewing.action.type === "release" ? "Deliver the release" : reviewing.action.type === "condition" ? "Deliver it" : `Send to ${other}`}
          busy={Boolean(busy)}
          onSend={async () => {
            if (await send(reviewing.action, reviewing.label)) setReviewing(null);
          }}
          onRevise={null}
          onDismiss={() => setReviewing(null)}
        />
      )}

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
            <button className="ghost" disabled={Boolean(busy)} onClick={() => setDateChange(tx.terms.completionDate)}>
              Ask to change completion date
            </button>
          ) : (
            <span className="inline-form">
              <input type="date" value={dateChange} onChange={(e) => setDateChange(e.target.value)} aria-label="New completion date" />
              <button className="secondary" disabled={Boolean(busy)} onClick={() => act({ type: "request_date_change", closingDate: dateChange, text }, "date")}>
                Request amendment
              </button>
              <button className="ghost" onClick={() => setDateChange(null)}>
                Cancel
              </button>
            </span>
          )}
        </div>
        {me === "buyer" && (
          <div className="muted small">
            {tx.releaseOptions.length
              ? `Your buyers can end the deal and get the deposit back by not waiving: ${tx.releaseOptions.map((r) => `${r.label} (until ${displayDate(addDays(tx.effectiveDate, r.untilDay))})`).join("; ")}.`
              : "Your buyers are firm. If they can't complete, they lose the deposit and can be sued for damages."}
          </div>
        )}
      </div>
    </div>
  );
}

function ConditionCard({ condition, tx, me, busy, onAct }: { condition: ConditionState; tx: TransactionClientView; me: "buyer" | "seller"; busy: boolean; onAct: (a: TxAction, label: string) => void }) {
  const [confirmFail, setConfirmFail] = useState(false);
  const [extraDays, setExtraDays] = useState(3);
  const deadline = displayDate(addDays(tx.effectiveDate, condition.deadlineDay));
  const extending = tx.issues.some((i) => i.status === "open" && i.kind === "condition_extension" && i.conditionKey === condition.key);
  return (
    <div className={`condition-card ${condition.deadlineDay === tx.day ? "due" : ""}`}>
      <div className="issue-head">
        <strong>{condition.label}</strong>
        <span className="pill pill-warn">Waive or fulfil by {deadline}</span>
      </div>
      {me === "buyer" ? (
        <>
          {tx.conditionGuidance[condition.key] && <div className="muted small">{tx.conditionGuidance[condition.key]}</div>}
          <div className="issue-actions">
            <button className="accept" disabled={busy} onClick={() => onAct({ type: "condition", key: condition.key, how: "fulfil" }, "condition")}>
              Fulfil (Form 124)
            </button>
            <button className="secondary" disabled={busy} onClick={() => onAct({ type: "condition", key: condition.key, how: "waive" }, "condition")}>
              Waive (Form 123)
            </button>
            {!extending && (
              <span className="inline-form">
                <input type="number" min={1} max={10} value={extraDays} onChange={(e) => setExtraDays(Number(e.target.value))} aria-label="Extra banking days" />
                <button className="ghost" disabled={busy} onClick={() => onAct({ type: "request_condition_extension", key: condition.key, days: extraDays }, "extend")}>
                  Ask for more days
                </button>
              </span>
            )}
            {confirmFail ? (
              <span className="confirm-walk">
                End the deal?
                <button className="danger" onClick={() => onAct({ type: "release", key: condition.key }, "release")}>
                  Yes, don't waive
                </button>
                <button className="ghost" onClick={() => setConfirmFail(false)}>
                  No
                </button>
              </span>
            ) : (
              <button className="ghost" disabled={busy} onClick={() => setConfirmFail(true)}>
                Let it fail…
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="muted small">Waiting on the buyer's side. If it isn't waived or fulfilled by the deadline, the agreement is null and void.</div>
      )}
    </div>
  );
}

function IssueCard({ issue, view, tx, busy, other, onAct }: { issue: Issue; view: UserView; tx: TransactionClientView; busy: boolean; other: string; onAct: (a: TxAction, label: string) => void }) {
  const me = mySide(view);
  const last = issue.proposals[issue.proposals.length - 1] as Proposal | undefined;
  const isDate = issue.kind === "extension" || issue.kind === "date_change";
  const isMoney = ["repairs", "appraisal", "title", "visit"].includes(issue.kind);
  const isDays = issue.kind === "condition_extension";
  const [amount, setAmount] = useState<number>(last?.amount || issue.reference || 0);
  const [date, setDate] = useState<string>(last?.closingDate ?? issue.neededDate ?? tx.terms.completionDate);
  const [form, setForm] = useState<NonNullable<Proposal["form"]>>(last?.form ?? "price_reduction");

  const myTurnToRequest = issue.proposals.length === 0 && issue.requester === me;
  const theirMove = last && last.by !== me;
  const waiting = (issue.proposals.length === 0 && issue.requester !== me) || (last && last.by === me);
  const deadline = issue.deadlineDay !== null ? displayDate(addDays(tx.effectiveDate, issue.deadlineDay)) : null;
  const proposeAction = (): TxAction => ({ type: "propose", issueId: issue.id, amount, closingDate: isDate ? date : undefined, form: isMoney ? form : undefined });

  const input = isDate ? (
    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Completion date" />
  ) : isDays ? (
    <span className="money-input">
      <input type="number" min={1} max={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Banking days" />
      <span>banking days</span>
    </span>
  ) : isMoney ? (
    <>
      <span className="money-input">
        <span>$</span>
        <input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Amount" />
      </span>
      {issue.kind !== "appraisal" && (
        <select value={form} onChange={(e) => setForm(e.target.value as NonNullable<Proposal["form"]>)} aria-label="Form">
          <option value="price_reduction">as a price reduction</option>
          <option value="repairs">as seller repairs before completion</option>
          <option value="credit">as a credit on closing</option>
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
        <p className="muted small">{me === "buyer" ? "Use \"Let it fail\" on the financing condition to end the deal with the deposit returned, or wait and hope the lender comes around." : "Waiting to hear whether the buyers will let the financing condition fail."}</p>
      ) : issue.kind === "escape_clause" && me === "buyer" && theirMove ? (
        <div className="issue-actions">
          <button className="accept" disabled={busy} onClick={() => onAct({ type: "accept", issueId: issue.id }, "accept")}>
            Waive the sale condition
          </button>
          <span className="muted small">Or do nothing: after 72 hours the agreement ends and the deposit comes back.</span>
        </div>
      ) : myTurnToRequest ? (
        <div className="issue-actions">
          {issue.kind === "escape_clause" ? (
            <button className="primary" disabled={busy} onClick={() => onAct({ type: "propose", issueId: issue.id, amount: 0 }, "propose")}>
              Send escape clause notice
            </button>
          ) : (
            <>
              {input}
              <button className="primary" disabled={busy} onClick={() => onAct(proposeAction(), "propose")}>
                Send request
              </button>
            </>
          )}
          <button className="ghost" disabled={busy} onClick={() => onAct({ type: "withdraw", issueId: issue.id }, "withdraw")}>
            {issue.kind === "repairs" ? "Proceed as is" : "Drop it"}
          </button>
          {issue.kind === "title" && me === "buyer" && (
            <button className="ghost" disabled={busy} onClick={() => onAct({ type: "release", key: issue.id }, "release")}>
              End the deal on this objection
            </button>
          )}
        </div>
      ) : theirMove ? (
        <div className="issue-actions">
          {last!.kind !== "reject" && (
            <button className="accept" disabled={busy} onClick={() => onAct({ type: "accept", issueId: issue.id }, "accept")}>
              Accept
            </button>
          )}
          {issue.kind !== "escape_clause" && (
            <>
              {input}
              <button className="secondary" disabled={busy} onClick={() => onAct(proposeAction(), "propose")}>
                Counter
              </button>
            </>
          )}
          {last!.kind !== "reject" && issue.kind !== "escape_clause" && (
            <button className="ghost" disabled={busy} onClick={() => onAct({ type: "reject", issueId: issue.id }, "reject")}>
              Decline
            </button>
          )}
          {issue.requester === me && last!.kind === "reject" && (
            <button className="ghost" disabled={busy} onClick={() => onAct({ type: "withdraw", issueId: issue.id }, "withdraw")}>
              {issue.kind === "repairs" ? "Proceed as is" : "Drop it"}
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
  if (issue.kind === "escape_clause") return p.kind === "accept" ? "waived the sale condition" : "gave escape clause notice";
  if (issue.kind === "extension" || issue.kind === "date_change") return `${verb} completion on ${p.closingDate ? displayDate(p.closingDate) : "?"}`;
  if (issue.kind === "condition_extension") return `${verb} ${p.amount} more banking days`;
  const form = p.form === "repairs" ? "in seller repairs" : p.form === "credit" ? "credit on closing" : "price reduction";
  return `${verb} ${money(p.amount)} ${form}`;
}

function Outcome({ view, tx }: { view: UserView; tx: TransactionClientView }) {
  const o = tx.outcome!;
  const st = tx.settlement;
  const me = mySide(view);
  const brief = view.yourClient.brief;
  const title = { completed: `Completed on ${displayDate(addDays(tx.effectiveDate, o.day))}`, void: "Agreement null and void", terminated: "Agreement terminated", buyer_default: "Buyer default", seller_default: "Seller default" }[o.kind];
  const deposit = { applied_on_completion: "Credited to the buyer on completion", returned_to_buyer: "Returned to the buyer in full", forfeited_to_seller: "Forfeited to the seller" }[o.deposit];
  return (
    <div className="tx-outcome">
      <div className={`ended ${o.kind === "completed" ? "ended-deal" : "ended-dead"}`}>{title}</div>
      <p className="small">{o.reason}</p>
      <dl className="kv small">
        <dt>Deposit</dt>
        <dd>
          {money(tx.terms.deposit)}: {deposit}
        </dd>
        {o.damagesExposure !== null && (
          <>
            <dt>Seller's possible damages claim</dt>
            <dd className="strong">{money(o.damagesExposure)}</dd>
          </>
        )}
      </dl>
      {st && (
        <>
          <h4>Statement of adjustments (summary)</h4>
          <dl className="kv small">
            <dt>Sale price</dt>
            <dd>{money(st.price)}</dd>
            {st.priceAdjustments > 0 && (
              <>
                <dt>Price reductions by amendment</dt>
                <dd>{money(st.priceAdjustments)}</dd>
              </>
            )}
            {st.creditsOnClosing > 0 && (
              <>
                <dt>Credits to buyer on closing</dt>
                <dd>{money(st.creditsOnClosing)}</dd>
              </>
            )}
            {st.repairsBySeller > 0 && (
              <>
                <dt>Repairs by seller</dt>
                <dd>{money(st.repairsBySeller)}</dd>
              </>
            )}
            {st.rentalBuyout > 0 && (
              <>
                <dt>Rental contracts paid out by seller</dt>
                <dd>{money(st.rentalBuyout)}</dd>
              </>
            )}
            <dt>Property tax adjustment (to seller)</dt>
            <dd>{money(st.propertyTaxAdjustment)}</dd>
            <dt>Deposit credited</dt>
            <dd>{money(st.depositApplied)}</dd>
          </dl>
          <h4>Buyer's side</h4>
          <dl className="kv small">
            <dt>Ontario land transfer tax</dt>
            <dd>{money(st.landTransferTax.provincial)}</dd>
            {st.landTransferTax.municipal > 0 && (
              <>
                <dt>Toronto land transfer tax</dt>
                <dd>{money(st.landTransferTax.municipal)}</dd>
              </>
            )}
            {st.landTransferTax.firstTimeRebate > 0 && (
              <>
                <dt>First-time buyer refunds</dt>
                <dd>−{money(st.landTransferTax.firstTimeRebate)}</dd>
              </>
            )}
            <dt>Mortgage{st.cmhcPremium ? " (incl. CMHC premium)" : ""}</dt>
            <dd>{money(st.mortgageAmount)}</dd>
            <dt>Legal fees and disbursements (est.)</dt>
            <dd>{money(st.buyerLegalAndOtherCosts)}</dd>
            <dt>Balance due on closing (est.)</dt>
            <dd className="strong">{money(st.buyerBalanceDueOnClosing)}</dd>
          </dl>
          <h4>Seller's side</h4>
          <dl className="kv small">
            <dt>Mortgage discharged</dt>
            <dd>{money(st.sellerMortgageDischarge)}</dd>
            <dt>Proceeds before commission (est.)</dt>
            <dd className="strong">{money(st.sellerProceedsBeforeCommission)}</dd>
          </dl>
          <div className="guidance small">
            {me === "seller"
              ? `Your sellers' floor was ${money(brief.reservationPrice)}. The final price was ${money(st.price - st.rentalBuyout)}${st.rentalBuyout ? " net of the rental buyout" : ""}${st.creditsOnClosing + st.repairsBySeller ? `, before ${money(st.creditsOnClosing + st.repairsBySeller)} in credits and repairs` : ""}.`
              : `Your buyers' ceiling was ${money(brief.reservationPrice)}. They paid ${money(st.price - st.rentalBuyout - st.creditsOnClosing)} net of credits and the rental buyout.`}{" "}
            Open the debrief to see both sides and your scores.
          </div>
        </>
      )}
    </div>
  );
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
