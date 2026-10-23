import { useEffect, useState } from "react";
import { api, type ScenarioSummary, type UserView } from "./api";
import { DealFile } from "./DealFile";
import { money, typeLabel } from "../../server/narrative/format";

export function App() {
  const [view, setView] = useState<UserView | null>(null);
  const [history, setHistory] = useState<ScenarioSummary[]>([]);
  const [storyWriter, setStoryWriter] = useState<"claude" | "offline" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    api.status().then((s) => setStoryWriter(s.storyWriter)).catch(() => setStoryWriter(null));
    api.listScenarios().then(setHistory).catch(() => {});
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await api.createScenario();
      setView(result.view);
      setWarnings(result.warnings);
      setHistory(await api.listScenarios());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function open(id: string) {
    setError(null);
    setWarnings([]);
    try {
      setView((await api.getScenario(id)).view);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌂</span> The Negotiator
        </div>
        <div className="topbar-actions">
          {storyWriter === "offline" && <span className="pill pill-muted" title="Add ANTHROPIC_API_KEY to .env for Claude-written stories">Offline story writer</span>}
          <button className="primary" onClick={generate} disabled={generating}>
            {generating ? "Building scenario…" : "New scenario"}
          </button>
        </div>
      </header>

      {error && <div className="banner banner-error">{error}</div>}
      {warnings.map((w) => (
        <div key={w} className="banner banner-warn">
          {w}
        </div>
      ))}

      <main className="layout">
        <aside className="history">
          <h2>Past deals</h2>
          {history.length === 0 && <p className="muted">None yet.</p>}
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <button className={`history-item ${view?.id === h.id ? "active" : ""}`} onClick={() => open(h.id)}>
                  <span className="history-title">
                    {h.city}, {h.stateCode}
                  </span>
                  <span className="muted small">
                    {typeLabel(h.propertyType)} · {money(h.listPrice)}
                  </span>
                  <span className="muted small">
                    {h.role === "buyer_agent" ? "Buyer's agent" : "Listing agent"}
                    {h.status !== "negotiating" && <span className={`history-status status-${h.status}`}>{h.status === "under_contract" ? "Under contract" : "Dead"}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="content">
          {generating && !view && <Loading />}
          {!view && !generating && <Empty onGenerate={generate} />}
          {view && <DealFile view={view} onNegotiationChange={() => api.listScenarios().then(setHistory).catch(() => {})} />}
        </section>
      </main>
    </div>
  );
}

function Empty({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="empty">
      <h1>Ready to negotiate?</h1>
      <p className="muted">
        Each scenario is a new residential deal in a random market. You'll be randomly assigned to represent the buyer or the seller,
        and you'll be up against a 30-year veteran agent. The difficulty is hidden until the debrief.
      </p>
      <button className="primary large" onClick={onGenerate}>
        Generate a scenario
      </button>
    </div>
  );
}

function Loading() {
  return (
    <div className="empty">
      <div className="spinner" />
      <p className="muted">Pulling comps, interviewing clients, and briefing the other agent. This can take a minute.</p>
    </div>
  );
}
