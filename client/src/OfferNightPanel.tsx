import { useState } from "react";
import { ApiError, api, type NegotiationView, type UserAction, type UserView } from "./api";
import type { Terms } from "../../server/negotiation/terms";
import { CONDITION_LABELS, displayDate, money } from "../../server/narrative/format";
import type { ConditionKey } from "../../server/engine/types";
import { OfferForm } from "./OfferForm";
import { startingTerms } from "./negotiationUtils";
import { ClientReviewCard } from "./ClientReviewCard";

interface Props {
  view: UserView;
  negotiation: NegotiationView;
  onChange: (n: NegotiationView) => void;
}

type FormMode = { kind: "register" } | { kind: "preemptive" } | { kind: "signback_bot" } | { kind: "signback_competitor"; competitorId: string; initial: Terms };

/** Offer night controls: registration, pre-emptive offers, review, and the improvement round. */
export function OfferNightPanel({ view, negotiation, onChange }: Props) {
  const night = negotiation.offerNight!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [text, setText] = useState("");
  const [form, setForm] = useState<FormMode | null>(null);
  const [confirmWalk, setConfirmWalk] = useState(false);
  const [reviewing, setReviewing] = useState<UserAction | null>(null);
  const [formTerms, setFormTerms] = useState<Terms | null>(null);
  const reviewRequired = Boolean(negotiation.client?.reviewRequired);
  const clientNames = view.yourClient.story.clientNames;
  const clientFirst = clientNames.replace(/\s+\S+$/, "");
  const buyerSide = view.role === "buyer_agent";
  const agent = view.opposingAgent.name.split(" ")[0];
  const botOffer = [...negotiation.offers].reverse().find((o) => o.by === "buyer" && (o.status === "registered" || o.status === "open"));
  const myRegistered = [...negotiation.offers].reverse().find((o) => o.by === "buyer" && o.status === "registered");
  const inReview = night.phase === "review" || night.phase === "final_review";

  async function act(action: UserAction): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.act(view.id, action);
      onChange(result.negotiation);
      setText("");
      setForm(null);
      setConfirmWalk(false);
      return true;
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, details: err.details ?? [] });
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Registrations, sign-backs and acceptances go past your client first, when the deal requires it. */
  async function sign(action: UserAction) {
    if (!reviewRequired) return act(action);
    setReviewing(null);
    if (await act({ type: "client_review", pending: action })) setReviewing(action);
  }

  const submitForm = (terms: Terms, note: string) => {
    if (!form) return;
    if (form.kind === "register") return sign({ type: "offer", terms, text: note });
    if (form.kind === "preemptive") return sign({ type: "offer", terms, text: note, preemptive: true });
    if (form.kind === "signback_bot") return sign({ type: "offer", terms, text: note });
    return sign({ type: "signback_competitor", competitorId: form.competitorId, terms, text: note });
  };

  /** Reopens the form a reviewed document came from, with its terms. */
  const revise = (action: UserAction) => {
    setFormTerms(structuredClone(action.terms!));
    setReviewing(null);
    if (action.type === "signback_competitor") setForm({ kind: "signback_competitor", competitorId: action.competitorId!, initial: action.terms! });
    else if (action.preemptive) setForm({ kind: "preemptive" });
    else setForm({ kind: buyerSide ? "register" : "signback_bot" });
  };

  const openForm = (mode: FormMode) => {
    setFormTerms(null);
    setReviewing(null);
    setForm(mode);
  };

  const formInitial = (): Terms => {
    if (formTerms) return structuredClone(formTerms);
    if (form?.kind === "signback_competitor") return structuredClone(form.initial);
    if (form?.kind === "signback_bot" && botOffer) return structuredClone(botOffer.terms);
    if (myRegistered) return structuredClone(myRegistered.terms);
    const t = startingTerms(view, null);
    return form?.kind === "preemptive" ? { ...t, irrevocableHours: 4, depositTiming: "herewith" } : t;
  };

  return (
    <div className="offer-night">
      <div className="offer-night-banner">
        <div className="eyebrow">Offer night</div>
        <div className="strong">
          {night.phase === "registration"
            ? `Offers reviewed ${night.reviewAt}`
            : night.phase === "improvement"
              ? `Improved offers due by ${night.improvementDeadline}`
              : night.phase === "final_review"
                ? "Final review: improved offers are in"
                : "Reviewing offers"}
        </div>
        <div className="muted small">
          Pre-emptive offers {night.preemptives === "considered" ? "considered" : "not accepted"}.{" "}
          {night.competingCount === null
            ? "Register an offer to learn how many are competing."
            : buyerSide
              ? `${night.competingCount} other registered offer${night.competingCount === 1 ? "" : "s"}.`
              : `${night.competingCount + (botOffer ? 1 : 0)} registered offer${night.competingCount + (botOffer ? 1 : 0) === 1 ? "" : "s"}.`}
        </div>
        {!buyerSide && (
          <div className="disclosure-row small">
            <span>
              Your sellers' direction: {night.sellerDirection === null ? "not given yet. Ask them in the conversation with your sellers" : night.sellerDirection === "details" ? "disclose offer contents" : "disclose the number of offers only"}.
            </span>
            <select value={night.disclosure} disabled={busy} onChange={(e) => act({ type: "set_disclosure", disclosure: e.target.value as "count_only" | "details" })} aria-label="Disclosure to competing buyers">
              <option value="count_only">Tell buyers the count only</option>
              <option value="details">Disclose offer contents (TRESA)</option>
            </select>
          </div>
        )}
      </div>

      {buyerSide && night.competitors.length > 0 && (
        <div className="guidance small">
          Disclosed on the sellers' direction:{" "}
          {night.competitors.map((c) => `${c.label} ${money(c.price)} (${c.conditions.length ? `conditional: ${c.conditions.map((k) => CONDITION_LABELS[k as ConditionKey].toLowerCase()).join(", ")}` : "firm"})`).join("; ")}
        </div>
      )}

      {!buyerSide && inReview && (
        <table className="offers-table">
          <thead>
            <tr>
              <th>Offer</th>
              <th className="num">Price</th>
              <th className="num">Deposit</th>
              <th>Conditions</th>
              <th>Completion</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {botOffer && (
              <tr>
                <td>
                  {agent}'s buyers <span className="muted small">(the agent you're dealing with)</span>
                </td>
                <td className="num">{money(botOffer.terms.price)}</td>
                <td className="num">{money(botOffer.terms.deposit)}</td>
                <td>{conditionsText(botOffer.terms.conditions.map((c) => c.key))}</td>
                <td>{displayDate(botOffer.terms.completionDate)}</td>
                <td className="row">
                  <button className="accept" disabled={busy} onClick={() => sign({ type: "accept" })}>
                    Accept
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => openForm({ kind: "signback_bot" })}>
                    Sign back
                  </button>
                </td>
              </tr>
            )}
            {night.competitors
              .filter((c) => c.status === "registered")
              .map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="num">{money(c.price)}</td>
                  <td className="num">{money(c.deposit)}</td>
                  <td>{conditionsText(c.conditions)}</td>
                  <td>{displayDate(c.completionDate)}</td>
                  <td className="row">
                    <button className="accept" disabled={busy} onClick={() => sign({ type: "accept_competitor", competitorId: c.id })}>
                      Accept
                    </button>
                    <button className="secondary" disabled={busy || !c.terms} onClick={() => c.terms && openForm({ kind: "signback_competitor", competitorId: c.id, initial: c.terms })}>
                      Sign back
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {reviewing && (
        <ClientReviewCard
          negotiation={negotiation}
          clientNames={clientNames}
          action={reviewing}
          documentLabel={reviewing.type === "accept" || reviewing.type === "accept_competitor" ? "acceptance" : reviewing.preemptive ? "pre-emptive offer" : reviewing.type === "signback_competitor" || !buyerSide ? "sign-back" : "offer"}
          agentFirstName={agent}
          busy={busy}
          onSend={async () => {
            if (await act(reviewing)) setReviewing(null);
          }}
          onRevise={reviewing.terms ? () => revise(reviewing) : null}
          onDismiss={() => setReviewing(null)}
        />
      )}

      {busy && reviewRequired && !reviewing && <div className="typing">Working…</div>}

      {error && !form && (
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
          placeholder={`Message ${agent}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && text.trim() && !busy) {
              e.preventDefault();
              act({ type: "message", text });
            }
          }}
          disabled={busy}
        />
        <div className="composer-actions">
          <button className="secondary" disabled={!text.trim() || busy} onClick={() => act({ type: "message", text })}>
            Send
          </button>
          {buyerSide ? (
            <>
              {(night.phase === "registration" || night.phase === "improvement") && (
                <button className="primary" disabled={busy} onClick={() => openForm({ kind: "register" })}>
                  {night.phase === "improvement" ? "Improve offer" : myRegistered ? "Replace registered offer" : "Register offer"}
                </button>
              )}
              {night.phase === "registration" && night.preemptives === "considered" && (
                <button className="secondary" disabled={busy} onClick={() => openForm({ kind: "preemptive" })}>
                  Pre-emptive offer
                </button>
              )}
              <button className="secondary" disabled={busy} onClick={() => act({ type: "review" })}>
                {night.phase === "improvement" ? "Go to final review" : "Go to offer review"}
              </button>
            </>
          ) : (
            <>
              {night.phase === "registration" && botOffer?.preemptive && botOffer.status === "open" && (
                <>
                  <button className="accept" disabled={busy} onClick={() => sign({ type: "accept" })}>
                    {reviewRequired ? "Review acceptance of" : "Accept"} pre-emptive {money(botOffer.terms.price)}
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => openForm({ kind: "signback_bot" })}>
                    Sign back
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => act({ type: "decline" })}>
                    Wait for offer night
                  </button>
                </>
              )}
              {night.phase === "registration" && (
                <button className="primary" disabled={busy} onClick={() => act({ type: "review" })}>
                  Go to offer review
                </button>
              )}
              {night.phase === "review" && (
                <button className="primary" disabled={busy} onClick={() => act({ type: "improve" })}>
                  Send all back to improve
                </button>
              )}
            </>
          )}
          {confirmWalk ? (
            <span className="confirm-walk">
              {buyerSide ? "Withdraw for good?" : "Reject every offer?"}
              <button className="danger" onClick={() => act({ type: "walk", text })}>
                Yes
              </button>
              <button className="ghost" onClick={() => setConfirmWalk(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="ghost" disabled={busy} onClick={() => setConfirmWalk(true)}>
              {buyerSide ? "Withdraw" : "Reject all"}
            </button>
          )}
        </div>
      </div>

      {form && (
        <OfferForm
          view={view}
          initial={formInitial()}
          isCounter={form.kind === "signback_bot" || form.kind === "signback_competitor"}
          busy={busy}
          errors={error}
          submitLabel={reviewRequired ? `Review with ${clientFirst}` : undefined}
          onCancel={() => setForm(null)}
          onSubmit={submitForm}
        />
      )}
    </div>
  );
}

function conditionsText(keys: string[]): string {
  return keys.length ? keys.map((k) => CONDITION_LABELS[k as ConditionKey]).join(", ") : "None (firm)";
}
