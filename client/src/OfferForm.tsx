import { useState } from "react";
import type { UserView } from "./api";
import type { Terms } from "../../server/negotiation/terms";
import { LOAN_LABELS, money } from "../../server/narrative/format";

interface Props {
  view: UserView;
  initial: Terms;
  isCounter: boolean;
  busy: boolean;
  errors: { message: string; details: string[] } | null;
  onSubmit: (terms: Terms, note: string) => void;
  onCancel: () => void;
}

export function OfferForm({ view, initial, isCounter, busy, errors, onSubmit, onCancel }: Props) {
  const [t, setT] = useState<Terms>(initial);
  const [note, setNote] = useState("");
  const set = <K extends keyof Terms>(key: K, value: Terms[K]) => setT((prev) => ({ ...prev, [key]: value }));
  const isCash = t.loanType === "cash";
  const inspectionLabel = view.public.market.customs.optionPeriod ? "Option period" : "Inspection period";
  const userIsBuyerAgent = view.role === "buyer_agent";

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={isCounter ? "Counteroffer" : "Offer"}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(t, note);
        }}
      >
        <header className="modal-header">
          <h2>{isCounter ? "Write a counteroffer" : "Write an offer"}</h2>
          <button type="button" className="ghost" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="form-grid">
          <Field label="Price">
            <MoneyInput value={t.price} onChange={(v) => set("price", v)} />
          </Field>
          <Field label="Earnest money" hint={`${((t.earnestMoney / Math.max(1, t.price)) * 100).toFixed(1)}% of price`}>
            <MoneyInput value={t.earnestMoney} onChange={(v) => set("earnestMoney", v)} />
          </Field>
          <Field label="Seller credit to buyer">
            <MoneyInput value={t.sellerCredit} onChange={(v) => set("sellerCredit", v)} />
          </Field>
          <Field label="Closing date">
            <input type="date" value={t.closingDate} onChange={(e) => set("closingDate", e.target.value)} required />
          </Field>

          <Field label="Financing" hint={userIsBuyerAgent ? "Set by your buyer's situation" : "The buyer's financing"}>
            <select value={t.loanType} disabled={userIsBuyerAgent} onChange={(e) => set("loanType", e.target.value as Terms["loanType"])}>
              {(Object.keys(LOAN_LABELS) as Terms["loanType"][]).map((l) => (
                <option key={l} value={l}>
                  {LOAN_LABELS[l]}
                </option>
              ))}
            </select>
          </Field>
          {!isCash && (
            <Field label="Down payment">
              <input type="number" value={t.downPaymentPct} disabled={userIsBuyerAgent} min={0} max={100} step={0.5} onChange={(e) => set("downPaymentPct", Number(e.target.value))} />
            </Field>
          )}

          <Field label={inspectionLabel}>
            <DaysOrWaived value={t.inspectionDays} onChange={(v) => set("inspectionDays", v)} />
          </Field>
          {!isCash && (
            <Field label="Financing contingency">
              <DaysOrWaived value={t.financingDays} onChange={(v) => set("financingDays", v)} />
            </Field>
          )}
          <Field label="Appraisal">
            <select value={t.appraisal} onChange={(e) => set("appraisal", e.target.value as Terms["appraisal"])}>
              <option value="full">Contingent on appraisal</option>
              <option value="gap_coverage">Buyer covers a gap up to…</option>
              <option value="waived">Waived</option>
            </select>
          </Field>
          {t.appraisal === "gap_coverage" && (
            <Field label="Gap coverage up to">
              <MoneyInput value={t.appraisalGapCoverage} onChange={(v) => set("appraisalGapCoverage", v)} />
            </Field>
          )}

          <Field label="Seller rent-back" hint="Days the seller stays after closing">
            <input type="number" min={0} max={90} value={t.rentBackDays} onChange={(e) => set("rentBackDays", Number(e.target.value))} />
          </Field>
          <Field label="Home warranty (seller paid)">
            <MoneyInput value={t.homeWarranty} onChange={(v) => set("homeWarranty", v)} />
          </Field>
          <Field label="Home sale contingency">
            <label className="check">
              <input type="checkbox" checked={t.homeSaleContingency} onChange={(e) => set("homeSaleContingency", e.target.checked)} /> Buyer must sell a home first
            </label>
          </Field>
          <Field label="Inclusions" wide>
            <input type="text" value={t.inclusions} onChange={(e) => set("inclusions", e.target.value)} />
          </Field>

          {view.public.typeSpecificTerms.map((term) => (
            <Field key={term.key} label={term.label} hint={term.description} wide>
              <input
                type="text"
                value={t.specialTerms.find((x) => x.key === term.key)?.value ?? ""}
                onChange={(e) =>
                  set(
                    "specialTerms",
                    view.public.typeSpecificTerms.map((tt) => ({
                      key: tt.key,
                      value: tt.key === term.key ? e.target.value : (t.specialTerms.find((x) => x.key === tt.key)?.value ?? ""),
                    })),
                  )
                }
              />
            </Field>
          ))}

          <Field label={`Note to ${view.opposingAgent.name.split(" ")[0]}`} wide>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you'd say when you send this over" />
          </Field>
        </div>

        {errors && (
          <div className="form-error">
            <strong>{errors.message}</strong>
            {errors.details.length > 0 && (
              <ul>
                {errors.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <footer className="modal-footer">
          <span className="muted small">Net to seller: {money(t.price - t.sellerCredit - t.homeWarranty)}</span>
          <div className="row">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Sending…" : isCounter ? "Send counteroffer" : "Send offer"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="money-input">
      <span>$</span>
      <input type="number" min={0} step={500} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  );
}

function DaysOrWaived({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const waived = value === null;
  return (
    <span className="days-or-waived">
      <input type="number" min={0} max={60} value={waived ? "" : value} disabled={waived} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="muted small">days</span>
      <label className="check">
        <input type="checkbox" checked={waived} onChange={(e) => onChange(e.target.checked ? null : 10)} /> Waive
      </label>
    </span>
  );
}
