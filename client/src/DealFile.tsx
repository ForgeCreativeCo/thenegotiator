import { useEffect, useState } from "react";
import { api, type NegotiationView, type UserView } from "./api";
import { Negotiation } from "./Negotiation";
import { TermSheet } from "./TermSheet";
import type { TransactionClientView } from "../../server/transaction/engine";
import type { BuyerBrief, SellerBrief } from "../../server/engine/types";
import { LOAN_LABELS, MOTIVATION_LABELS, money, typeLabel } from "../../server/narrative/format";

type Tab = "listing" | "comps" | "disclosures" | "client" | "reports";

export function DealFile({ view, onNegotiationChange }: { view: UserView; onNegotiationChange?: (n: NegotiationView) => void }) {
  const [tab, setTab] = useState<Tab>("client");
  const [negotiation, setNegotiation] = useState<NegotiationView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const p = view.public.property;
  const isBuyerAgent = view.role === "buyer_agent";
  const reports = negotiation?.transaction?.reports ?? [];

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setNegotiation(null);
    api
      .getNegotiation(view.id)
      .then((r) => {
        if (cancelled) return;
        setNegotiation(r.negotiation);
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [view.id]);

  function update(n: NegotiationView) {
    setNegotiation(n);
    onNegotiationChange?.(n);
  }

  return (
    <div className="deal">
      <div className="deal-header">
        <div>
          <div className="eyebrow">
            {typeLabel(p.type)} · {p.address.city}, {p.address.stateCode} {p.address.zip}
          </div>
          <h1>{p.address.street}</h1>
          <div className="muted">{view.public.listingHeadline}</div>
        </div>
        <div className="role-card">
          <div className="eyebrow">Your role</div>
          <div className="role-name">{isBuyerAgent ? "Buyer's agent" : "Listing agent"}</div>
          <div className="muted small">Representing {view.yourClient.story.clientNames}</div>
        </div>
      </div>

      <div className="columns">
        <section className="panel file">
          <nav className="tabs">
            {(
              [
                ["client", "Your client"],
                ["listing", "Listing"],
                ["comps", "Comps"],
                ["disclosures", "Disclosures"],
                ...(reports.length ? ([["reports", `Reports (${reports.length})`]] as const) : []),
              ] as const
            ).map(([key, label]) => (
              <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === "client" && <ClientTab view={view} />}
          {tab === "listing" && <ListingTab view={view} />}
          {tab === "comps" && <CompsTab view={view} />}
          {tab === "disclosures" && <DisclosuresTab view={view} />}
          {tab === "reports" && negotiation?.transaction && <ReportsTab tx={negotiation.transaction} />}
        </section>

        <section className="panel negotiation">
          <h2>Negotiation</h2>
          {loaded ? <Negotiation key={view.id} view={view} negotiation={negotiation} onChange={update} /> : <p className="muted">Loading…</p>}
        </section>

        <aside className="panel terms">
          <h2>Term sheet</h2>
          <TermSheet view={view} negotiation={negotiation} />
          {view.public.typeSpecificTerms.length > 0 && (
            <>
              <h3>Terms specific to this property</h3>
              <ul className="terms-list">
                {view.public.typeSpecificTerms.map((t) => (
                  <li key={t.key}>
                    <strong>{t.label}.</strong> <span className="muted">{t.description}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ClientTab({ view }: { view: UserView }) {
  const { brief, story } = view.yourClient;
  return (
    <div className="tab-body">
      <div className="confidential">Confidential. The other agent can't see this.</div>
      <h3>{story.clientNames}</h3>
      <p>{story.backstory}</p>
      <p>{story.motivationStory}</p>
      <blockquote>{story.whatTheyveToldYou}</blockquote>

      <h4>Their numbers</h4>
      {brief.side === "seller" ? <SellerNumbers brief={brief} /> : <BuyerNumbers brief={brief} />}

      <div className="grid-2">
        <div>
          <h4>Non-negotiables</h4>
          <ul>{story.nonNegotiables.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h4>Soft spots</h4>
          <ul>{story.softSpots.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      <h4>Personality</h4>
      <ul>{story.quirks.map((x) => <li key={x}>{x}</li>)}</ul>
      <h4>What matters most to them</h4>
      <PreferenceBars prefs={brief.preferences} />
    </div>
  );
}

function SellerNumbers({ brief }: { brief: SellerBrief }) {
  return (
    <dl className="kv">
      <dt>Situation</dt>
      <dd>{MOTIVATION_LABELS[brief.motivation] ?? brief.motivation}</dd>
      <dt>Urgency</dt>
      <dd><Urgency level={brief.urgency} /></dd>
      <dt>Lowest acceptable price</dt>
      <dd className="strong">{money(brief.reservationPrice)}</dd>
      <dt>Mortgage payoff</dt>
      <dd>{money(brief.mortgagePayoff)}</dd>
      <dt>Max credits and repairs</dt>
      <dd>{money(brief.maxConcessions)}</dd>
      <dt>Closing window</dt>
      <dd>{formatDate(brief.earliestClose)} to {formatDate(brief.latestClose)} (ideal {formatDate(brief.idealClose)})</dd>
      <dt>Rent-back needed</dt>
      <dd>{brief.needsRentBackDays ? `${brief.needsRentBackDays} days` : "No"}</dd>
      <dt>Home-sale contingency</dt>
      <dd>{brief.acceptsHomeSaleContingency ? "Would consider" : "Won't accept"}</dd>
      <dt>Acceptable financing</dt>
      <dd>{brief.acceptableLoanTypes.map((l) => LOAN_LABELS[l]).join(", ")}</dd>
    </dl>
  );
}

function BuyerNumbers({ brief }: { brief: BuyerBrief }) {
  return (
    <dl className="kv">
      <dt>Situation</dt>
      <dd>{MOTIVATION_LABELS[brief.motivation] ?? brief.motivation}</dd>
      <dt>Urgency</dt>
      <dd><Urgency level={brief.urgency} /></dd>
      <dt>Highest acceptable price</dt>
      <dd className="strong">{money(brief.reservationPrice)}</dd>
      <dt>Financing</dt>
      <dd>
        {brief.loanType === "cash" ? "Cash" : `${LOAN_LABELS[brief.loanType]}, ${brief.downPaymentPct}% down, pre-approved to ${money(brief.preapprovalAmount ?? 0)}`}
      </dd>
      <dt>Cash reserves</dt>
      <dd>{money(brief.cashReserves)}</dd>
      <dt>Could cover an appraisal gap of</dt>
      <dd>{money(brief.maxAppraisalGapCoverage)}</dd>
      <dt>Closing window</dt>
      <dd>{formatDate(brief.earliestClose)} to {formatDate(brief.latestClose)} (ideal {formatDate(brief.idealClose)})</dd>
      {brief.leaseEndsOn && (
        <>
          <dt>Lease ends</dt>
          <dd>{formatDate(brief.leaseEndsOn)}</dd>
        </>
      )}
      <dt>Home to sell</dt>
      <dd>{brief.homeToSell ? `${brief.homeToSell.status.replace(/_/g, " ")}, about ${money(brief.homeToSell.equity)} equity` : "None"}</dd>
      <dt>Willing to waive</dt>
      <dd>{brief.willingToWaive.length ? brief.willingToWaive.join(", ") : "Nothing"}</dd>
      <dt>Must-haves</dt>
      <dd>{brief.mustHaves.join(", ")}</dd>
    </dl>
  );
}

function ListingTab({ view }: { view: UserView }) {
  const { property: p, market } = view.public;
  const isLand = p.type === "land";
  return (
    <div className="tab-body">
      <p>{view.public.listingRemarks}</p>
      <dl className="kv">
        {!isLand && (
          <>
            <dt>Beds / baths</dt>
            <dd>{p.beds} / {p.baths}</dd>
            <dt>Square feet</dt>
            <dd>{p.sqft.toLocaleString()}</dd>
            <dt>Year built</dt>
            <dd>{p.yearBuilt}</dd>
            <dt>Stories</dt>
            <dd>{p.stories}</dd>
            <dt>Parking</dt>
            <dd>{p.garage}</dd>
            <dt>Heating / cooling</dt>
            <dd>{p.heating} / {p.cooling}</dd>
          </>
        )}
        {p.lotAcres > 0 && (
          <>
            <dt>Lot</dt>
            <dd>{p.lotAcres} acres</dd>
          </>
        )}
        <dt>Water / sewer</dt>
        <dd>{p.water} / {p.sewer}</dd>
        <dt>Annual taxes</dt>
        <dd>{money(p.annualTaxes)}</dd>
        {p.hoa && (
          <>
            <dt>HOA</dt>
            <dd>
              {money(p.hoa.monthlyDues)}/month, includes {p.hoa.includes.join(", ")}
              {p.hoa.rentalCap ? "; rental cap" : ""}
            </dd>
          </>
        )}
        {Object.entries(p.extras).map(([k, v]) => (
          <FragmentRow key={k} label={humanize(k)} value={formatExtra(k, v)} />
        ))}
      </dl>
      {p.features.length > 0 && (
        <>
          <h4>Features</h4>
          <div className="chips">{p.features.map((f) => <span key={f} className="chip">{f}</span>)}</div>
        </>
      )}
      {p.units && (
        <>
          <h4>Units</h4>
          <table>
            <thead><tr><th>Unit</th><th>Beds</th><th>Rent</th><th>Lease</th></tr></thead>
            <tbody>
              {p.units.map((u) => (
                <tr key={u.label}><td>{u.label}</td><td>{u.beds}</td><td>{u.monthlyRent ? money(u.monthlyRent) : "Vacant"}</td><td>{u.leaseEnds ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h4>Price history</h4>
      <table>
        <tbody>
          {p.priceHistory.map((h) => (
            <tr key={h.date + h.event}><td>{formatDate(h.date)}</td><td>{h.event}</td><td className="num">{money(h.price)}</td></tr>
          ))}
        </tbody>
      </table>
      <h4>Neighborhood</h4>
      <p>{view.public.neighborhood}</p>
      <h4>Market</h4>
      <p>{view.public.marketSnapshot}</p>
      <div className="stats">
        <Stat label="Market" value={market.temperature.charAt(0).toUpperCase() + market.temperature.slice(1)} />
        <Stat label="Avg days on market" value={String(market.avgDaysOnMarket)} />
        <Stat label="Sale-to-list" value={`${Math.round(market.listToSaleRatio * 1000) / 10}%`} />
        <Stat label="Inventory" value={`${market.monthsOfInventory} mo`} />
        <Stat label="30-yr rate" value={`${market.mortgageRate}%`} />
      </div>
    </div>
  );
}

function CompsTab({ view }: { view: UserView }) {
  const isLand = view.public.property.type === "land";
  return (
    <div className="tab-body">
      <table>
        <thead>
          <tr><th>Address</th><th>Sold</th><th className="num">Price</th>{!isLand && <th>Bd/Ba</th>}{!isLand && <th className="num">Sq ft</th>}{!isLand && <th className="num">$/sq ft</th>}<th className="num">DOM</th><th className="num">Mi</th></tr>
        </thead>
        <tbody>
          {view.public.comps.map((c) => (
            <tr key={c.address}>
              <td>{c.address}<div className="muted small">{c.notes}</div></td>
              <td>{formatDate(c.soldDate)}</td>
              <td className="num">{money(c.soldPrice)}</td>
              {!isLand && <td>{c.beds}/{c.baths}</td>}
              {!isLand && <td className="num">{c.sqft.toLocaleString()}</td>}
              {!isLand && <td className="num">{c.sqft ? money(c.soldPrice / c.sqft) : "—"}</td>}
              <td className="num">{c.daysOnMarket}</td>
              <td className="num">{c.distanceMiles}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isLand && view.public.property.sqft > 0 && (
        <p className="muted small">Subject: {view.public.property.sqft.toLocaleString()} sq ft listed at {money(view.public.property.listPrice / view.public.property.sqft)}/sq ft.</p>
      )}
    </div>
  );
}

function ReportsTab({ tx }: { tx: TransactionClientView }) {
  const severityLabel = { minor: "Minor", moderate: "Moderate", major: "Major", safety: "Safety" } as const;
  return (
    <div className="tab-body">
      {[...tx.reports].reverse().map((r) => (
        <section key={r.id} className="report">
          <div className="report-head">
            <h3>{r.title}</h3>
            <span className="muted small">{formatDate(addDaysIso(tx.effectiveDate, r.day))}</span>
          </div>
          <p>{r.summary}</p>
          {r.findings.length > 0 && (
            <table>
              <thead>
                <tr><th>Item</th><th>Severity</th><th className="num">Estimate</th></tr>
              </thead>
              <tbody>
                {r.findings.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.title}
                      <div className="muted small">{f.system}{f.disclosed ? " · disclosed by seller" : ""}{f.detectableBy === "specialist" ? " · found by a specialist" : ""}</div>
                    </td>
                    <td><span className={`sev sev-${f.severity}`}>{severityLabel[f.severity]}</span></td>
                    <td className="num">{f.repairCostHigh ? `${money(f.repairCostLow)}–${money(f.repairCostHigh)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function DisclosuresTab({ view }: { view: UserView }) {
  return (
    <div className="tab-body">
      <ul className="disclosures">
        {view.public.disclosures.map((d, i) => (
          <li key={i}><strong>{d.item}.</strong> {d.detail}</li>
        ))}
      </ul>
    </div>
  );
}

function PreferenceBars({ prefs }: { prefs: BuyerBrief["preferences"] }) {
  const labels: Record<keyof typeof prefs, string> = { price: "Price", timing: "Timing", certainty: "Certainty of closing", repairs: "Avoiding repairs", possession: "Possession terms" };
  const entries = (Object.keys(prefs) as (keyof typeof prefs)[]).sort((a, b) => prefs[b] - prefs[a]);
  return (
    <div className="bars">
      {entries.map((k) => (
        <div key={k} className="bar-row">
          <span className="bar-label">{labels[k]}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.round(prefs[k] * 100 / prefs[entries[0]])}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

function Urgency({ level }: { level: number }) {
  return (
    <span className="urgency" title={`${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= level ? "on" : ""} />)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatExtra(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (/pct/i.test(key)) return `${value}%`;
    if (/upgrades|incentive|rent/i.test(key)) return money(value);
    if (/ft$/i.test(key)) return `${value.toLocaleString()} ft`;
    return value.toLocaleString();
  }
  return value;
}

function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
