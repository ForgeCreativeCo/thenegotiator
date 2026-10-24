import { useState } from "react";
import type { UserView } from "./api";
import type { ConditionKey } from "../../server/engine/types";
import { applicableConditions, rentalBuyoutTotal, type Terms } from "../../server/negotiation/terms";
import { FINANCING_LABELS, conditionLabel, money } from "../../server/narrative/format";

interface Props {
  view: UserView;
  initial: Terms;
  isCounter: boolean;
  busy: boolean;
  errors: { message: string; details: string[] } | null;
  onSubmit: (terms: Terms, note: string) => void;
  onCancel: () => void;
  /** Replaces "Send offer" when the client must review it first. */
  submitLabel?: string;
}

/** An offer or sign-back, laid out like the Agreement of Purchase and Sale. */
export function OfferForm({ view, initial, isCounter, busy, errors, onSubmit, onCancel, submitLabel }: Props) {
  const [t, setT] = useState<Terms>(initial);
  const [note, setNote] = useState("");
  const set = <K extends keyof Terms>(key: K, value: Terms[K]) => setT((prev) => ({ ...prev, [key]: value }));
  const userIsBuyerAgent = view.role === "buyer_agent";
  const isCash = t.financing === "cash";
  const conditionKeys = applicableConditions(view.public).filter((k) => !(k === "financing" && isCash));
  const rentalItems = view.public.property.rentalItems;

  const days = (key: ConditionKey) => t.conditions.find((c) => c.key === key)?.days ?? null;
  const setCondition = (key: ConditionKey, value: number | null) =>
    set("conditions", value === null ? t.conditions.filter((c) => c.key !== key) : t.conditions.some((c) => c.key === key) ? t.conditions.map((c) => (c.key === key ? { ...c, days: value } : c)) : [...t.conditions, { key, days: value }]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={isCounter ? "Sign-back" : "Offer"}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(t, note);
        }}
      >
        <header className="modal-header">
          <div>
            <h2>{isCounter ? "Sign back" : "Write an offer"}</h2>
            <div className="muted small">Agreement of Purchase and Sale ({view.public.property.condo ? "OREA Form 101" : "OREA Form 100"})</div>
          </div>
          <button type="button" className="ghost" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="form-grid">
          <Field label="Purchase price">
            <MoneyInput value={t.price} onChange={(v) => set("price", v)} />
          </Field>
          <Field label="Deposit" hint={`${((t.deposit / Math.max(1, t.price)) * 100).toFixed(1)}% of price, held in the listing brokerage's trust account`}>
            <span className="row">
              <MoneyInput value={t.deposit} onChange={(v) => set("deposit", v)} />
              <select value={t.depositTiming} onChange={(e) => set("depositTiming", e.target.value as Terms["depositTiming"])} aria-label="Deposit timing">
                <option value="upon_acceptance">upon acceptance</option>
                <option value="herewith">herewith</option>
              </select>
            </span>
          </Field>
          <Field label="Irrevocable" hint="How long the offer stays open">
            <span className="money-input">
              <input type="number" min={1} max={168} value={t.irrevocableHours} onChange={(e) => set("irrevocableHours", Number(e.target.value))} />
              <span>hours</span>
            </span>
          </Field>
          <Field label="Completion date">
            <input type="date" value={t.completionDate} onChange={(e) => set("completionDate", e.target.value)} required />
          </Field>
          <Field label="Buyer's financing" hint={userIsBuyerAgent ? "Set by your buyers' mortgage" : "From the buyer's offer"}>
            <input type="text" readOnly value={isCash ? "Cash" : `${FINANCING_LABELS[t.financing]}, ${t.downPaymentPct}% down`} />
          </Field>
          <Field label="Pre-closing visits">
            <input type="number" min={0} max={5} value={t.preClosingVisits} onChange={(e) => set("preClosingVisits", Number(e.target.value))} />
          </Field>

          <fieldset className="field wide conditions-fieldset">
            <legend className="field-label">Schedule A conditions (banking days after acceptance)</legend>
            <div className="conditions-grid">
              {conditionKeys.map((key) => {
                const d = days(key);
                return (
                  <label key={key} className="condition-row">
                    <input type="checkbox" checked={d !== null} aria-label={`Include ${conditionLabel(key, view.public.property.type).toLowerCase()} condition`} onChange={(e) => setCondition(key, e.target.checked ? (key === "sale_of_property" ? 30 : 5) : null)} />
                    <span>{conditionLabel(key, view.public.property.type)}</span>
                    <input type="number" min={1} max={60} value={d ?? ""} disabled={d === null} onChange={(e) => setCondition(key, Number(e.target.value))} aria-label={`${conditionLabel(key, view.public.property.type)} days`} />
                  </label>
                );
              })}
            </div>
            <span className="field-hint">{t.conditions.length ? "Each condition is for the buyer's benefit. If it isn't waived or fulfilled by its deadline, the agreement is null and void." : "No conditions: this is a firm offer."}</span>
          </fieldset>

          <Field label="Chattels included" wide>
            <input type="text" value={t.chattels} onChange={(e) => set("chattels", e.target.value)} />
          </Field>
          <Field label="Fixtures excluded" wide>
            <input type="text" value={t.fixturesExcluded} onChange={(e) => set("fixturesExcluded", e.target.value)} />
          </Field>
          {rentalItems.length > 0 && (
            <Field label="Rental items" hint={rentalItems.map((r) => `${r.item} (${money(r.monthly)}/month)`).join(", ")} wide>
              <select value={t.rentalItemsBuyout ? "buyout" : "assume"} onChange={(e) => set("rentalItemsBuyout", e.target.value === "buyout")}>
                <option value="assume">Buyer assumes the rental contracts</option>
                <option value="buyout">Seller pays out the contracts before completion ({money(rentalBuyoutTotal(view.public))})</option>
              </select>
            </Field>
          )}

          {view.public.typeSpecificTerms.map((term) => (
            <Field key={term.key} label={term.label} hint={term.description} wide>
              <input
                type="text"
                value={t.specialTerms.find((x) => x.key === term.key)?.value ?? ""}
                onChange={(e) =>
                  set(
                    "specialTerms",
                    view.public.typeSpecificTerms.map((tt) => ({ key: tt.key, value: tt.key === term.key ? e.target.value : (t.specialTerms.find((x) => x.key === tt.key)?.value ?? "") })),
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
          <span className="muted small">{t.rentalItemsBuyout ? `Net of rental buyout: ${money(t.price - rentalBuyoutTotal(view.public))}` : t.conditions.length ? `${t.conditions.length} condition${t.conditions.length > 1 ? "s" : ""}` : "Firm offer"}</span>
          <div className="row">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? (submitLabel ? "Reviewing…" : "Sending…") : (submitLabel ?? (isCounter ? "Send sign-back" : "Send offer"))}
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
      <input type="number" min={0} step="any" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  );
}
