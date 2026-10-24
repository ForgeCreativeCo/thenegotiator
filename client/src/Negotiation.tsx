import { useEffect, useRef, useState } from "react";
import { ApiError, api, type NegotiationView, type UserAction, type UserView } from "./api";
import type { Offer } from "../../server/negotiation/types";
import type { Terms } from "../../server/negotiation/terms";
import { describeTerms } from "../../server/negotiation/terms";
import { CONDITION_LABELS, money } from "../../server/narrative/format";
import { OfferForm } from "./OfferForm";
import { TransactionPanel } from "./TransactionPanel";
import { OfferNightPanel } from "./OfferNightPanel";
import { ClientPanel } from "./ClientPanel";
import { ClientReviewCard } from "./ClientReviewCard";
import { mySide, openOfferFrom, simClock, startingTerms } from "./negotiationUtils";

interface Props {
  view: UserView;
  negotiation: NegotiationView | null;
  onChange: (n: NegotiationView) => void;
}

type Pending = "message" | "offer" | "accept" | "walk" | "start" | "review" | "present" | null;

export function Negotiation({ view, negotiation, onChange }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmWalk, setConfirmWalk] = useState(false);
  const [tab, setTab] = useState<"agent" | "client">("agent");
  const [reviewing, setReviewing] = useState<UserAction | null>(null);
  const [formTerms, setFormTerms] = useState<Terms | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef<string | null>(null);
  const agent = view.opposingAgent;
  const firstName = agent.name.split(" ")[0];
  const me = mySide(view);
  const them = me === "buyer" ? "seller" : "buyer";
  const theirOpen = openOfferFrom(negotiation, them);
  const active = negotiation?.status === "negotiating";
  const offers = new Map((negotiation?.offers ?? []).map((o) => [o.id, o]));
  const client = negotiation?.client ?? null;
  const clientNames = view.yourClient.story.clientNames;
  const clientFirst = clientNames.replace(/\s+\S+$/, "");

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

  async function act(action: UserAction, kind: Exclude<Pending, null>): Promise<boolean> {
    setPending(kind);
    setError(null);
    try {
      const result = await api.act(view.id, action);
      onChange(result.negotiation);
      setText("");
      setFormOpen(false);
      setConfirmWalk(false);
      return true;
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, details: err.details ?? [] });
      return false;
    } finally {
      setPending(null);
    }
  }

  /** Anything with legal effect goes past your client first, when the deal requires it. */
  async function sign(action: UserAction, kind: Exclude<Pending, null>) {
    if (!client?.reviewRequired) return act(action, kind);
    setReviewing(null);
    if (await act({ type: "client_review", pending: action }, "review")) setReviewing(action);
  }

  async function present(offerId: string) {
    if (await act({ type: "client_present", offerId }, "present")) setTab("client");
  }

  const tabs = client && (
    <nav className="tabs convo-tabs" aria-label="Conversations">
      <button className={tab === "agent" ? "active" : ""} onClick={() => setTab("agent")}>
        {agent.name}
      </button>
      <button className={tab === "client" ? "active" : ""} onClick={() => setTab("client")}>
        Your {me === "buyer" ? "buyers" : "sellers"}: {clientFirst}
        {client.messages.length > 0 && <span className="tab-count">{client.messages.filter((m) => m.speaker === "client").length}</span>}
      </button>
    </nav>
  );

  if (tab === "client" && negotiation && client) {
    return (
      <div className="negotiation-panel">
        {tabs}
        <ClientPanel view={view} negotiation={negotiation} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="negotiation-panel">
      {tabs}
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
                {offer && m.action !== "accept" && (
                  <OfferCard
                    offer={offer}
                    view={view}
                    onPresent={client?.reviewRequired && active && offer.by === them && offer.status === "open" && !client.presented.includes(offer.id) && !pending ? () => present(offer.id) : null}
                    presented={Boolean(client?.presented.includes(offer.id))}
                  />
                )}
              </div>
            </div>
          );
        })}

        {(pending === "review" || pending === "present") && <div className="typing">{clientFirst} {/ and /.test(clientFirst) ? "are" : "is"} reading it over…</div>}
        {pending && pending !== "start" && pending !== "walk" && pending !== "review" && pending !== "present" && (
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

      {reviewing && negotiation && (
        <ClientReviewCard
          negotiation={negotiation}
          clientNames={clientNames}
          action={reviewing}
          documentLabel={reviewing.type === "accept" ? "acceptance" : negotiation.offers.some((o) => o.by === them) ? "sign-back" : "offer"}
          agentFirstName={firstName}
          busy={Boolean(pending)}
          onSend={async () => {
            if (await act(reviewing, reviewing.type === "accept" ? "accept" : "offer")) setReviewing(null);
          }}
          onRevise={
            reviewing.terms
              ? () => {
                  setFormTerms(structuredClone(reviewing.terms!));
                  setReviewing(null);
                  setFormOpen(true);
                }
              : null
          }
          onDismiss={() => setReviewing(null)}
        />
      )}

      {negotiation?.transaction ? (
        <TransactionPanel view={view} tx={negotiation.transaction} negotiation={negotiation} onChange={onChange} />
      ) : negotiation?.offerNight && negotiation.offerNight.phase !== "done" && active ? (
        <OfferNightPanel view={view} negotiation={negotiation} onChange={onChange} />
      ) : active ? (
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
            <button className="primary" disabled={Boolean(pending)} onClick={() => { setError(null); setFormTerms(null); setReviewing(null); setFormOpen(true); }}>
              {negotiation?.offers.length ? "Sign back" : "Write offer"}
            </button>
            {theirOpen && (
              <button className="accept" disabled={Boolean(pending)} onClick={() => sign({ type: "accept", text }, "accept")}>
                {client?.reviewRequired ? `Review acceptance of ${money(theirOpen.terms.price)}` : `Accept ${money(theirOpen.terms.price)}`}
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
          <div className={`ended ${negotiation.status === "under_contract" || negotiation.status === "sold_to_other" ? "ended-deal" : "ended-dead"}`}>
            {{ under_contract: "Accepted.", sold_to_other: "Sold to another buyer on offer night.", lost: "Another buyer won on offer night.", dead: "This deal is dead. Generate a new scenario to try again.", negotiating: "" }[negotiation.status]}
          </div>
        )
      )}

      {formOpen && (
        <OfferForm
          view={view}
          initial={formTerms ?? startingTerms(view, negotiation)}
          isCounter={Boolean(negotiation?.offers.length)}
          busy={pending === "offer" || pending === "review"}
          errors={error}
          submitLabel={client?.reviewRequired ? `Review with ${clientFirst}` : undefined}
          onCancel={() => setFormOpen(false)}
          onSubmit={(terms: Terms, note: string) => sign({ type: "offer", terms, text: note }, "offer")}
        />
      )}
    </div>
  );
}

function OfferCard({ offer, view, onPresent, presented }: { offer: Offer; view: UserView; onPresent: (() => void) | null; presented: boolean }) {
  const lines = describeTerms(offer.terms, view.public);
  const headline = lines.filter((l) => ["deposit", "completionDate", "irrevocable"].includes(l.key));
  const conditions = offer.terms.conditions.length ? offer.terms.conditions.map((c) => `${CONDITION_LABELS[c.key].toLowerCase()} (${c.days})`).join(", ") : "none (firm)";
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
        <span>
          Conditions: <strong>{conditions}</strong>
        </span>
      </div>
      {onPresent && (
        <button className="secondary small-button" onClick={onPresent}>
          Present to your clients
        </button>
      )}
      {presented && <div className="muted small">Presented to your clients</div>}
    </div>
  );
}

function statusLabel(status: Offer["status"]): string {
  return { open: "On the table", registered: "Registered (sealed)", countered: "Countered", accepted: "Accepted", rejected: "Not accepted", expired: "Replaced" }[status];
}

function actionLabel(action: string, isCounter: boolean): string {
  switch (action) {
    case "offer":
    case "counter":
      return isCounter ? "Sign-back" : "Offer";
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
