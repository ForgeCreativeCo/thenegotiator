import { useEffect, useRef, useState } from "react";
import { ApiError, api, type NegotiationView, type TxAction, type UserAction, type UserView } from "./api";
import { money } from "../../server/narrative/format";
import { mySide, simClock } from "./negotiationUtils";

interface Props {
  view: UserView;
  negotiation: NegotiationView;
  onChange: (n: NegotiationView) => void;
}

const HOW: Record<string, string> = { asked: "you asked", refusal: "when they refused to sign", presented: "when you presented an offer" };

/** The conversation with your own client: questions, presenting offers, and written direction. */
export function ClientPanel({ view, negotiation, onChange }: Props) {
  const client = negotiation.client!;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const names = view.yourClient.story.clientNames;
  const firstNames = names.replace(/\s+\S+$/, "");
  const me = mySide(view);
  const tx = negotiation.transaction;
  const inTransaction = Boolean(tx && tx.status === "active");
  const active = negotiation.status === "negotiating" || inTransaction;
  // After acceptance: the other side's latest requests and counters, not yet shown to the client.
  const toPresent = inTransaction
    ? tx!.issues.filter((i) => {
        const last = i.proposals[i.proposals.length - 1];
        return i.status === "open" && last && last.by !== me && !client.presented.includes(`issue:${i.id}:${last.id}`);
      })
    : [];
  const night = negotiation.offerNight && negotiation.offerNight.phase !== "done" ? negotiation.offerNight : null;
  const theirs = [...negotiation.offers].reverse().find((o) => o.by !== me && (o.status === "open" || o.status === "registered"));
  const canPresentOne = !inTransaction && active && theirs && !client.presented.includes(theirs.id) && !(night && me === "seller" && theirs.status === "registered");
  const canPresentAll = !inTransaction && active && night && me === "seller" && (night.phase === "review" || night.phase === "final_review") && !client.presented.includes(`offer-night:${night.phase}`);
  const canAskDirection = !inTransaction && active && night && me === "seller" && !client.direction;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [client.messages.length, busy]);

  async function act(action: UserAction | TxAction) {
    setBusy(true);
    setError(null);
    try {
      onChange((inTransaction ? await api.actTx(view.id, action as TxAction) : await api.act(view.id, action as UserAction)).negotiation);
      setText("");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="client-panel">
      <div className="transcript" aria-live="polite">
        <div className="situation">
          <div className="eyebrow">Your {me === "buyer" ? "buyers" : "sellers"}</div>
          <p>
            {names}. They sign everything before it goes to the other side. Ask them questions: clients rarely tell you everything at the first meeting.
          </p>
        </div>
        {client.learned.length > 0 && (
          <div className="learned">
            <div className="eyebrow">What they've told you since intake</div>
            <ul>
              {client.learned.map((l) => (
                <li key={l.factId}>
                  “{l.says}” <span className="muted small">({HOW[l.how]})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {client.messages.map((m) =>
          m.speaker === "system" ? (
            <div key={m.id} className="system-note">
              <span className="muted small">{simClock(view.public.startDate, m.at)}</span>
              <span>{m.text}</span>
            </div>
          ) : (
            <div key={m.id} className={`bubble-row ${m.speaker === "user" ? "mine" : "theirs"}`}>
              {m.speaker === "client" && <div className="avatar small client-avatar">{initials(names)}</div>}
              <div className="bubble-wrap">
                <div className="bubble-meta muted small">
                  {m.speaker === "user" ? "You" : firstNames} · {simClock(view.public.startDate, m.at)}
                  {m.kind !== "chat" && <span className={`action-tag ${m.verdict ? `verdict-pill-${m.verdict}` : ""}`}>{m.verdict ? { signed: "Signed", reluctant: "Signed, reluctantly", refused: "Won't sign" }[m.verdict] : { review: "Review", present: "Offer presented", direction: "Direction", chat: "" }[m.kind]}</span>}
                </div>
                <div className="bubble">{m.text}</div>
              </div>
            </div>
          ),
        )}
        {busy && <div className="typing">{firstNames} {/ and /.test(firstNames) ? "are" : "is"} thinking…</div>}
        <div ref={bottom} />
      </div>

      {error && <div className="form-error">{error}</div>}

      {active ? (
        <div className="composer">
          <textarea
            rows={2}
            value={text}
            placeholder={`Ask ${firstNames} something…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && text.trim() && !busy) {
                e.preventDefault();
                act({ type: "client_message", text });
              }
            }}
            disabled={busy}
          />
          <div className="composer-actions">
            <button className="secondary" disabled={!text.trim() || busy} onClick={() => act({ type: "client_message", text })}>
              Send
            </button>
            {canPresentOne && theirs && (
              <button className="primary" disabled={busy} onClick={() => act({ type: "client_present", offerId: theirs.id })}>
                Present their {money(theirs.terms.price)} {theirs.preemptive ? "pre-emptive offer" : "offer"}
              </button>
            )}
            {canPresentAll && (
              <button className="primary" disabled={busy} onClick={() => act({ type: "client_present" })}>
                Present all the offers
              </button>
            )}
            {toPresent.map((issue) => (
              <button key={issue.id} className="primary" disabled={busy} onClick={() => act({ type: "client_present", issueId: issue.id })}>
                Present: {issue.title}
              </button>
            ))}
            {canAskDirection && (
              <button className="secondary" disabled={busy} onClick={() => act({ type: "client_direction" })}>
                Ask for written direction on disclosure
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="muted small">This deal is finished.</p>
      )}
    </div>
  );
}

function initials(names: string): string {
  return names
    .replace(/\band\b|&/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}
