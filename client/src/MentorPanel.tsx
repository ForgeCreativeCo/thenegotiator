import { useEffect, useRef, useState } from "react";
import { api, type MentorEntry, type UserView } from "./api";

const STARTERS = ["What's my next move?", "Is their last offer reasonable?", "Should my buyers waive this condition?", "How do I handle offer night?"];

/** A side drawer for asking the mentor. The mentor sees only what you see. */
export function MentorPanel({ view, onClose }: { view: UserView; onClose: () => void }) {
  const [log, setLog] = useState<MentorEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.mentorLog(view.id).then((r) => setLog(r.log)).catch(() => {});
  }, [view.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [log.length, busy]);

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setLog((await api.askMentor(view.id, q.trim())).log);
      setQuestion("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="mentor-drawer" role="dialog" aria-label="Mentor">
      <header className="modal-header">
        <div>
          <h2>Mentor</h2>
          <div className="muted small">A 30-year Ontario broker. Sees only what you see; the other agent never sees this.</div>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close mentor">
          ✕
        </button>
      </header>
      <div className="mentor-log">
        {log.length === 0 && <p className="muted small">Ask anything about this deal: strategy, Ontario practice, or what RECO expects of you.</p>}
        {log.map((e, i) => (
          <div key={i} className="mentor-entry">
            <div className="mentor-q">{e.question}</div>
            <div className="mentor-a">{e.answer}</div>
          </div>
        ))}
        {busy && <div className="typing">Thinking it over…</div>}
        <div ref={bottom} />
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="chips">
        {STARTERS.map((q) => (
          <button key={q} className="chip chip-button" disabled={busy} onClick={() => ask(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="mentor-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask your mentor…" disabled={busy} />
        <button className="primary" type="submit" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </aside>
  );
}
