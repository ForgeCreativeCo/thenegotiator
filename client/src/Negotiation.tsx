import { useEffect, useRef, useState } from "react";
import { ApiError, api, type NegotiationView, type UserAction, type UserView } from "./api";
import type { Offer } from "../../server/negotiation/types";
import type { Terms } from "../../server/negotiation/terms";
import { describeTerms } from "../../server/negotiation/terms";
import { money } from "../../server/narrative/format";
import { OfferForm } from "./OfferForm";
import { mySide, openOfferFrom, simClock, startingTerms } from "./negotiationUtils";

interface Props {
  view: UserView;
  negotiation: NegotiationView | null;
  onChange: (n: NegotiationView) => void;
}

type Pending = "message" | "offer" | "accept" | "walk" | "start" | null;

export function Negotiation({ view, negotiation, onChange }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmWalk, setConfirmWalk] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef<string | null>(null);
  const agent = view.opposingAgent;
  const firstName = agent.name.split(" ")[0];
  const me = mySide(view);
  const them = me === "buyer" ? "seller" : "buyer";
  const theirOpen = openOfferFrom(negotiation, them);
  const active = negotiation?.status === "negotiating";
  const offers = new Map((negotiation?.offers ?? []).map((o) => [o.id, o]));

  // Kick off the negotiation the first time this scenario is opened.
  useEffect(() => {
    if (negotiation || started.current === view.id) return;
    started.current = view.id;
    setPending("start");
    api
      .startNegotiation(view.id)
      .then((r) => onChange(r.negotiation))
      .catch((e: Error) => setError({ message: e.message, details: [] }))
      .finally(() => setPending(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id, negotiation]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [negotiation?.messages.length, pending]);

  async function act(action: UserAction, kind: Exclude<Pending, null>) {
    setPending(kind);
    setError(null);
    try {
      const result = await api.act(view.id, action);
      onChange(result.negotiation);
      setText("");
      setFormOpen(false);
      setConfirmWalk(false);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, details: err.details ?? [] });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="negotiation-panel">
      <div className="transcript" aria-live="polite">
        <div className="situation">
          <div className="eyebrow">Where things stand</div>
          <p>{view.openingSituation}</p>
        </div>
        <div className="agent-card">
          <div className="avatar">{initials(agent.name)}</div>
          <div>
            <div className="agent-name">{agent.name}</div>
            <div className="muted small">
              {me === "buyer" ? "Listing agent" : "Buyer's agent"} · {agent.brokerage}
            </div>
            <p className="small">{agent.publicBio}</p>
          </div>
        </div>

        {negotiation?.messages.map((m) => {
          const offer = m.offerId ? offers.get(m.offerId) : undefined;
          if (m.speaker === "system") {
            return (
              <div key={m.id} className={`system-note ${m.event ? `event-${m.event}` : ""}`}>
                <span className="muted small">{simClock(view.public.startDate, m.at)}</span>
                <span>{m.text}</span>
              </div>
            );
          }
          const mine = m.speaker === "user";
          return (
            <div key={m.id} className={`bubble-row ${mine ? "mine" : "theirs"}`}>
              {!mine && <div className="avatar small">{initials(agent.name)}</div>}
              <div className="bubble-wrap">
                <div className="bubble-meta muted small">
                  {mine ? "You" : firstName} · {simClock(view.public.startDate, m.at)}
                  {m.action && m.action !== "message" && m.action !== "hold" && <span className={`action-tag tag-${m.action}`}>{actionLabel(m.action, Boolean(offer && offer.id !== negotiation.offers[0]?.id))}</span>}
                </div>
                {m.text && <div className="bubble">{m.text}</div>}
                {offer && m.action !== "accept" && <OfferCard offer={offer} view={view} />}
              </div>
            </div>
          );
        })}

        {pending && pending !== "start" && pending !== "walk" && (
          <div className="bubble-row theirs">
            <div className="avatar small">{initials(agent.name)}</div>
            <div className="typing">
              {pending === "offer" ? `${firstName} is reviewing your offer with ${me === "buyer" ? "the sellers" : "the buyers"}…` : `${firstName} is typing…`}
            </div>
          </div>
        )}
        {pending === "start" && <div className="typing">{me === "seller" ? `${firstName} is writing up an offer…` : "Setting up the deal…"}</div>}
        <div ref={bottom} />
      </div>

      {error && !formOpen && (
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

      {active ? (
        <div className="composer">
          <textarea
            rows={2}
            value={text}
            placeholder={`Message ${firstName}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && text.trim() && !pending) {
                e.preventDefault();
                act({ type: "message", text }, "message");
              }
            }}
            disabled={Boolean(pending)}
          />
          <div className="composer-actions">
            <button className="secondary" disabled={!text.trim() || Boolean(pending)} onClick={() => act({ type: "message", text }, "message")}>
              Send
            </button>
            <button className="primary" disabled={Boolean(pending)} onClick={() => { setError(null); setFormOpen(true); }}>
              {negotiation?.offers.length ? "Counter" : "Make offer"}
            </button>
            {theirOpen && (
              <button className="accept" disabled={Boolean(pending)} onClick={() => act({ type: "accept", text }, "accept")}>
                Accept {money(theirOpen.terms.price)}
              </button>
            )}
            {confirmWalk ? (
              <span className="confirm-walk">
                Walk away for good?
                <button className="danger" onClick={() => act({ type: "walk", text }, "walk")}>Yes, walk</button>
                <button className="ghost" onClick={() => setConfirmWalk(false)}>No</button>
              </span>
            ) : (
              <button className="ghost" disabled={Boolean(pending)} onClick={() => setConfirmWalk(true)}>
                Walk away
              </button>
            )}
          </div>
        </div>
      ) : (
        negotiation && (
          <div className={`ended ${negotiation.status === "under_contract" ? "ended-deal" : "ended-dead"}`}>
            {negotiation.status === "under_contract" ? "You're under contract. The deal moves to due diligence in build step 3." : "This deal is dead. Generate a new scenario to try again."}
          </div>
        )
      )}

      {formOpen && (
        <OfferForm
          view={view}
          initial={startingTerms(view, negotiation)}
          isCounter={Boolean(negotiation?.offers.length)}
          busy={pending === "offer"}
          errors={error}
          onCancel={() => setFormOpen(false)}
          onSubmit={(terms: Terms, note: string) => act({ type: "offer", terms, text: note }, "offer")}
        />
      )}
    </div>
  );
}

function OfferCard({ offer, view }: { offer: Offer; view: UserView }) {
  const lines = describeTerms(offer.terms, view.public);
  const headline = lines.filter((l) => ["closingDate", "sellerCredit", "inspectionDays", "appraisal"].includes(l.key));
  return (
    <div className={`offer-card status-${offer.status}`}>
      <div className="offer-card-head">
        <span className="offer-price">{money(offer.terms.price)}</span>
        <span className="offer-status">{statusLabel(offer.status)}</span>
      </div>
      <div className="offer-card-lines small">
        {headline.map((l) => (
          <span key={l.key}>
            {l.label}: <strong>{l.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function statusLabel(status: Offer["status"]): string {
  return { open: "On the table", countered: "Countered", accepted: "Accepted", rejected: "Rejected", expired: "Expired" }[status];
}

function actionLabel(action: string, isCounter: boolean): string {
  switch (action) {
    case "offer":
    case "counter":
      return isCounter ? "Counteroffer" : "Offer";
    case "accept":
      return "Accepted";
    case "reject":
      return "Rejected";
    case "walk":
      return "Walked away";
    default:
      return action;
  }
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
}
