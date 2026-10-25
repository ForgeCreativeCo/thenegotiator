import { useState } from "react";
import { ApiError, api, type NegotiationView, type UserAction, type UserView } from "./api";
import type { Terms } from "../../server/negotiation/terms";
import type { CompetitorView } from "../../server/negotiation/listing";
import { CONDITION_LABELS, displayDate, money } from "../../server/narrative/format";
import type { ConditionKey } from "../../server/engine/types";
import { OfferForm } from "./OfferForm";
import { ClientReviewCard } from "./ClientReviewCard";

interface Props {
  view: UserView;
  negotiation: NegotiationView;
  onChange: (n: NegotiationView) => void;
}

const STATUS: Record<CompetitorView["status"], string> = {
  registered: "Open",
  accepted: "Accepted",
  released: "Released (told it sold)",
  declined: "Declined",
  expired: "Lapsed",
  withdrawn: "Withdrew",
  moved_on: "Moved on",
};

/** The listing side's competing offers: how offers are handled, each offer, the count rule, and buyers to invite back. */
export function ListingPanel({ view, negotiation, onChange }: Props) {
  const listing = negotiation.listing!;
  const client = negotiation.client;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [form, setForm] = useState<CompetitorView | null>(null);
  const [formTerms, setFormTerms] = useState<Terms | null>(null);
  const [reviewing, setReviewing] = useState<UserAction | null>(null);
  const live = listing.competitors.filter((c) => c.status === "registered");
  const anyTime = listing.mode === "any_time";
  const active = negotiation.status === "negotiating" && anyTime;
  const relisting = listing.canRelist;
  const presented = new Set(client?.presented ?? []);
  const names = view.yourClient.story.clientNames;

  async function act(action: UserAction): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      onChange((await api.act(view.id, action)).negotiation);
      setForm(null);
      return true;
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, details: err.details ?? [] });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sign(action: UserAction) {
    setReviewing(null);
    if (!client?.reviewRequired) return void (await act(action));
    if (await act({ type: "client_review", pending: action })) setReviewing(action);
  }

  if (!active && !relisting) return null;

  return (
    <section className="listing-panel">
      <div className="listing-head">
        <div>
          <div className="eyebrow">{relisting ? "Back on the market" : "Offers on your listing"}</div>
          <div className="small">
            {relisting
              ? "The deal fell through. You can invite back buyers who made offers, or take any offer still open."
              : `${listing.writtenOffers} written offer${listing.writtenOffers === 1 ? "" : "s"}. ${listing.decided ? "Your sellers take offers any time." : "Your sellers haven't decided yet how offers are handled."}`}
          </div>
        </div>
        {active && (
          <div className="row">
            {!listing.decided && (
              <button className="secondary" disabled={busy} onClick={() => act({ type: "client_hold", hold: false })}>
                Recommend: any time
              </button>
            )}
            <button className="secondary" disabled={busy || Boolean(listing.signBackOut)} onClick={() => act({ type: "client_hold", hold: true })}>
              Recommend: hold offers for a review
            </button>
          </div>
        )}
      </div>

      {active && listing.writtenOffers >= 2 && (
        <div className="guidance small listing-rules">
          <span>{listing.countDisclosed ? "✓ Every agent with an offer knows there are competing offers." : "With two or more offers, tell every agent with an offer how many there are before you respond to any."}</span>
          {!listing.countDisclosed && (
            <button className="secondary small-button" disabled={busy} onClick={() => act({ type: "tell_count" })}>
              Tell every agent the count
            </button>
          )}
          <label className="inline-form">
            <span>Share</span>
            <select value={listing.disclosure} disabled={busy} onChange={(e) => act({ type: "set_disclosure", disclosure: e.target.value as "count_only" | "details" })} aria-label="What to share with buyers' agents">
              <option value="count_only">the count only</option>
              <option value="details">offer contents (needs written direction)</option>
            </select>
          </label>
        </div>
      )}

      {listing.signBackOut && (
        <div className="banner-inline warn">
          Sign-back out to {listing.signBackOut.label} at {money(listing.signBackOut.price)}. They'll answer by {listing.signBackOut.answerAt}. No other sign-back or acceptance can go out until then.
        </div>
      )}

      {listing.competitors.length > 0 && (
        <table className="offers-table">
          <thead>
            <tr>
              <th>Offer</th>
              <th className="num">Price</th>
              <th className="num">Deposit</th>
              <th>Conditions</th>
              <th>Completion</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listing.competitors.map((c) => {
              const open = c.status === "registered";
              const shown = presented.has(`competitor:${c.id}`);
              return (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="num">{money(c.terms.price)}</td>
                  <td className="num">
                    {money(c.terms.deposit)} <span className="muted small">{c.terms.depositTiming === "herewith" ? "herewith" : "on acceptance"}</span>
                  </td>
                  <td>{c.terms.conditions.length ? c.terms.conditions.map((x) => CONDITION_LABELS[x.key as ConditionKey]).join(", ") : "None (firm)"}</td>
                  <td>{displayDate(c.terms.completionDate)}</td>
                  <td className="small">
                    {STATUS[c.status]}
                    {open && c.expiresAt && <div className="muted">until {c.expiresAt}</div>}
                    {open && <div className={shown ? "muted" : "warn-text"}>{shown ? "Presented" : "Not presented yet"}</div>}
                  </td>
                  <td className="row">
                    {open && !shown && (
                      <button className="secondary" disabled={busy} onClick={() => act({ type: "client_present", competitorId: c.id })}>
                        Present
                      </button>
                    )}
                    {open && (
                      <>
                        <button className="accept" disabled={busy || Boolean(listing.signBackOut)} onClick={() => sign({ type: "accept_competitor", competitorId: c.id })}>
                          Accept
                        </button>
                        <button className="secondary" disabled={busy || Boolean(listing.signBackOut)} onClick={() => { setFormTerms(null); setForm(c); }}>
                          Sign back
                        </button>
                        <button className="ghost" disabled={busy || listing.signBackOut?.competitorId === c.id} onClick={() => act({ type: "decline_competitor", competitorId: c.id })}>
                          Decline
                        </button>
                      </>
                    )}
                    {relisting && !open && !c.invited && c.status !== "accepted" && c.status !== "withdrawn" && (
                      <button className="primary" disabled={busy} onClick={() => act({ type: "invite_back", competitorId: c.id })}>
                        Invite back
                      </button>
                    )}
                    {c.invited && <span className="muted small">{c.invited === "returned" ? "Came back" : "Moved on"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(active || relisting) && (
        <div className="row">
          <button className="ghost" disabled={busy} onClick={() => act({ type: "wait" })}>
            {listing.signBackOut ? `Wait for ${listing.signBackOut.label}'s answer` : "Let a few hours pass"}
          </button>
        </div>
      )}

      {reviewing && (
        <ClientReviewCard
          negotiation={negotiation}
          clientNames={names}
          action={reviewing}
          agentFirstName="their agent"
          documentLabel={reviewing.type === "accept_competitor" ? "acceptance" : "sign-back"}
          sendLabel={reviewing.type === "accept_competitor" ? "Send acceptance" : "Send the sign-back"}
          busy={busy}
          onSend={async () => {
            if (await act(reviewing)) setReviewing(null);
          }}
          onRevise={
            reviewing.terms
              ? () => {
                  const c = listing.competitors.find((x) => x.id === reviewing.competitorId);
                  setFormTerms(structuredClone(reviewing.terms!));
                  setReviewing(null);
                  if (c) setForm(c);
                }
              : null
          }
          onDismiss={() => setReviewing(null)}
        />
      )}

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

      {form && (
        <OfferForm
          view={view}
          initial={formTerms ?? structuredClone(form.terms)}
          isCounter
          busy={busy}
          errors={error}
          submitLabel={client?.reviewRequired ? `Review with ${names.replace(/\s+\S+$/, "")}` : undefined}
          onCancel={() => setForm(null)}
          onSubmit={(terms, note) => sign({ type: "signback_competitor", competitorId: form.id, terms, text: note })}
        />
      )}
    </section>
  );
}
