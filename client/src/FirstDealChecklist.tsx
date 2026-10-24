import { useState } from "react";
import type { NegotiationView, UserView } from "./api";
import { mySide } from "./negotiationUtils";

const HIDDEN = "negotiator.checklistHidden";

function hiddenAtStart(): boolean {
  try {
    return localStorage.getItem(HIDDEN) === "1";
  } catch {
    return false;
  }
}

/** The flow of a deal, ticked off as you go. Shown on your first few deals until you hide it. */
export function FirstDealChecklist({ view, negotiation }: { view: UserView; negotiation: NegotiationView | null }) {
  const [hidden, setHidden] = useState(hiddenAtStart);
  if (hidden || !negotiation?.client) return null;
  const me = mySide(view);
  const clients = me === "buyer" ? "buyers" : "sellers";
  const c = negotiation.client;
  const tx = negotiation.transaction;
  const ended = negotiation.status === "dead" || negotiation.status === "lost" || negotiation.status === "sold_to_other" || (tx !== null && tx.status !== "active");
  const steps: { text: string; done: boolean }[] = [
    { text: `Ask your ${clients} what matters to them: timing, the deposit, what stays and what goes. They don't tell you everything at the first meeting.`, done: c.messages.some((m) => m.speaker === "user" && m.kind === "chat") },
    ...(me === "seller" && negotiation.offerNight ? [{ text: "Offer night: get your sellers' written direction on what to disclose to competing buyers.", done: c.direction !== null }] : []),
    { text: `When the other side sends an offer or sign-back, present it to your ${clients} before you answer.`, done: c.presented.length > 0 },
    { text: `Write your offer or sign-back, then review it with your ${clients}. They sign, sign reluctantly, or refuse with their reasons.`, done: c.messages.some((m) => m.kind === "review" && m.speaker === "client") },
    { text: "Once they've signed, send it. Keep going until both sides accept, or someone walks.", done: negotiation.offers.some((o) => o.by === me) || negotiation.status !== "negotiating" },
    { text: `After acceptance: move the calendar forward, review every waiver and amendment with your ${clients}, and answer them if they reach out.`, done: Boolean(tx && (tx.firm || tx.conditions.some((x) => x.status !== "pending"))) },
    { text: "When the deal ends, read the Debrief tab: both sides' limits, what your client never told you, and your scores.", done: ended },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <details className="checklist" open>
      <summary>
        <span className="eyebrow">How a deal flows</span>
        <span className="muted small">
          {steps.filter((s) => s.done).length} of {steps.length} done
        </span>
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={s.text} className={s.done ? "done" : i === next ? "next" : ""}>
            <span className="check" aria-hidden="true">
              {s.done ? "✓" : i + 1}
            </span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
      <button
        className="link-button small"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(HIDDEN, "1");
          } catch {
            // Hidden for this visit only.
          }
        }}
      >
        Hide this checklist
      </button>
    </details>
  );
}
