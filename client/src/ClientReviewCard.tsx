import type { NegotiationView } from "./api";
import { money } from "../../server/narrative/format";

interface Props {
  negotiation: NegotiationView;
  clientNames: string;
  /** The document under review: an offer-stage UserAction or a transaction action. */
  action: { type: string; terms?: { price: number } };
  agentFirstName: string;
  busy: boolean;
  onSend: () => void;
  onRevise: (() => void) | null;
  onDismiss: () => void;
  /** What the document is called, e.g. "sign-back" or "waiver". */
  documentLabel: string;
  /** Overrides the send button's label. */
  sendLabel?: string;
}

/** The client's answer to "will you sign this?", with the next step: send it, or revise. */
export function ClientReviewCard({ negotiation, clientNames, action, agentFirstName, busy, onSend, onRevise, onDismiss, documentLabel, sendLabel }: Props) {
  const reply = [...(negotiation.client?.messages ?? [])].reverse().find((m) => m.speaker === "client" && m.kind === "review");
  if (!reply) return null;
  const signed = reply.verdict !== "refused";
  const what = action.terms ? `${money(action.terms.price)} ${documentLabel}` : documentLabel;
  const send = sendLabel ?? (action.type === "accept" || action.type === "accept_competitor" ? "Send acceptance" : `Send to ${action.type.includes("competitor") ? "that buyer's agent" : agentFirstName}`);
  return (
    <div className={`client-review verdict-${reply.verdict}`} role="status">
      <div className="client-review-head">
        <span className="eyebrow">{clientNames} reviewed the {what}</span>
        <span className={`pill verdict-pill-${reply.verdict}`}>{reply.verdict === "signed" ? "Signed" : reply.verdict === "reluctant" ? "Signed, reluctantly" : "Won't sign"}</span>
      </div>
      <p className="client-review-quote">“{reply.text}”</p>
      {!signed && reply.details && reply.details.length > 0 && (
        <ul className="small">
          {reply.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div className="composer-actions">
        {signed && (
          <button className="primary" disabled={busy} onClick={onSend}>
            {send}
          </button>
        )}
        {onRevise && (
          <button className="secondary" disabled={busy} onClick={onRevise}>
            Revise
          </button>
        )}
        <button className="ghost" disabled={busy} onClick={onDismiss}>
          {signed ? "Not now" : "Close"}
        </button>
      </div>
    </div>
  );
}
