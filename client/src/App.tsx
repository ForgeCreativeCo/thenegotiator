import { useEffect, useState } from "react";
import { api, getPlayer, setPlayer, type ScenarioSummary, type UserView } from "./api";
import { DealFile } from "./DealFile";
import { ProgressView } from "./ProgressView";
import { HowItWorks } from "./HowItWorks";
import { money, typeLabel } from "../../server/narrative/format";

type Page = "practice" | "progress" | "guide";

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
  const [player, setPlayerState] = useState<string | null>(getPlayer());
  const [page, setPage] = useState<Page>("practice");
  const [view, setView] = useState<UserView | null>(null);
  const [history, setHistory] = useState<ScenarioSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const refreshHistory = () => api.listScenarios().then(setHistory).catch(() => {});

  useEffect(() => {
    if (player) refreshHistory();
  }, [player]);

  if (!player) {
    return (
      <NameScreen
        onDone={async (name) => {
          setPlayer(name);
          // Someone new starts with the guide; a returning player goes straight to their deals.
          const list = await api.listScenarios().catch(() => [] as ScenarioSummary[]);
          setHistory(list);
          setPage(list.length ? "practice" : "guide");
          setPlayerState(name);
        }}
      />
    );
  }

  function switchPlayer() {
    setPlayer(null);
    setPlayerState(null);
    setView(null);
    setHistory([]);
    setError(null);
  }

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
          <button className={page === "guide" ? "active" : ""} onClick={() => setPage("guide")}>
            How it works
          </button>
        </nav>
        <div className="topbar-actions">
          <span className="player-name small">
            {player}{" "}
            <button className="link-button" onClick={switchPlayer}>
              Not you?
            </button>
          </span>
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

      {page === "guide" ? (
        <main className="content guide-page">
          <HowItWorks onStart={generate} />
        </main>
      ) : page === "progress" ? (
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
            {!view && !generating && <Empty onGenerate={generate} onGuide={() => setPage("guide")} />}
            {view && !generating && <DealFile key={view.id} view={view} onNegotiationChange={refreshHistory} finishedDeals={history.filter((h) => h.status !== "negotiating" && h.status !== "under_contract").length} />}
          </section>
        </main>
      )}
    </div>
  );
}

function NameScreen({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="name-screen">
      <form
        className="name-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onDone(name.trim());
        }}
      >
        <div className="brand">
          <span className="brand-mark">⌂</span> The Negotiator
        </div>
        <h1>What's your name?</h1>
        <p className="muted">Your deals and progress are kept under your name, so use the same one each time. Nobody else sees your deals.</p>
        <label className="field">
          <span>Your name</span>
          <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="First and last name" />
        </label>
        <button type="submit" className="primary large" disabled={!name.trim()}>
          Start practising
        </button>
      </form>
    </div>
  );
}

function Empty({ onGenerate, onGuide }: { onGenerate: () => void; onGuide: () => void }) {
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
      <p className="small">
        New here?{" "}
        <button className="link-button" onClick={onGuide}>
          Read how it works
        </button>{" "}
        first.
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div className="empty">
      <div className="spinner" />
      <p className="muted">Pulling comps, interviewing clients, and briefing the other agent…</p>
    </div>
  );
}
