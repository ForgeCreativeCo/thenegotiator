import { useEffect, useState } from "react";
import { api, type ScenarioSummary, type UserView } from "./api";
import { DealFile } from "./DealFile";
import { ProgressView } from "./ProgressView";
import { money, typeLabel } from "../../server/narrative/format";

type Page = "practice" | "progress";

const STATUS_LABELS: Record<ScenarioSummary["status"], string> = {
  negotiating: "",
  under_contract: "Under agreement",
  closed: "Completed",
  terminated: "Ended",
  dead: "Dead",
  lost: "Lost",
  sold_to_other: "Sold to another",
};

export function App() {
  const [page, setPage] = useState<Page>("practice");
  const [view, setView] = useState<UserView | null>(null);
  const [history, setHistory] = useState<ScenarioSummary[]>([]);
  const [storyWriter, setStoryWriter] = useState<"claude" | "offline" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const refreshHistory = () => api.listScenarios().then(setHistory).catch(() => {});

  useEffect(() => {
    api.status().then((s) => setStoryWriter(s.storyWriter)).catch(() => setStoryWriter(null));
    refreshHistory();
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    setWarnings([]);
    setPage("practice");
    try {
      const result = await api.createScenario();
      setView(result.view);
      setWarnings(result.warnings);
      await refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function open(id: string) {
    setError(null);
    setWarnings([]);
    setPage("practice");
    try {
      setView((await api.getScenario(id)).view);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function afterDelete() {
    const list = await api.listScenarios().catch(() => [] as ScenarioSummary[]);
    setHistory(list);
    if (view && !list.some((h) => h.id === view.id)) setView(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌂</span> The Negotiator
        </div>
        <nav className="topnav" aria-label="Main">
          <button className={page === "practice" ? "active" : ""} onClick={() => setPage("practice")}>
            Practice
          </button>
          <button className={page === "progress" ? "active" : ""} onClick={() => setPage("progress")}>
            Progress
          </button>
        </nav>
        <div className="topbar-actions">
          {storyWriter === "offline" && (
            <span className="pill pill-muted" title="Add ANTHROPIC_API_KEY to .env for Claude-written stories, agent and mentor">
              Offline mode
            </span>
          )}
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

      {page === "progress" ? (
        <main className="content progress-page">
          <ProgressView onOpen={open} onChanged={afterDelete} />
        </main>
      ) : (
        <main className="layout">
          <aside className="history">
            <h2>Past deals</h2>
            {history.length === 0 && <p className="muted small">None yet.</p>}
            <ul>
              {history.map((h) => (
                <li key={h.id}>
                  <button className={`history-item ${view?.id === h.id ? "active" : ""}`} onClick={() => open(h.id)}>
                    <span className="history-title">{h.region}</span>
                    <span className="muted small">
                      {typeLabel(h.propertyType)} · {money(h.listPrice)}
                    </span>
                    <span className="muted small">
                      {h.role === "buyer_agent" ? "Buyer's agent" : "Listing agent"}
                      {h.status !== "negotiating" && <span className={`history-status status-${h.status}`}>{STATUS_LABELS[h.status]}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="content">
            {generating && <Loading />}
            {!view && !generating && <Empty onGenerate={generate} />}
            {view && !generating && <DealFile key={view.id} view={view} onNegotiationChange={refreshHistory} />}
          </section>
        </main>
      )}
    </div>
  );
}

function Empty({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="empty">
      <h1>Ready to negotiate?</h1>
      <p className="muted">
        Each scenario is a new Ontario residential deal in a random region and market. You're randomly assigned to represent the buyer or the seller, against a
        30-year veteran broker. The difficulty stays hidden until the debrief.
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
      <p className="muted">Pulling comps, interviewing clients, and briefing the other agent. With Claude this can take a minute.</p>
    </div>
  );
}
