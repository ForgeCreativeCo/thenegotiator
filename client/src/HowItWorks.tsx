/** The reference guide: how a deal flows, what your client knows, and how you're scored. */
export function HowItWorks({ onStart }: { onStart: () => void }) {
  return (
    <article className="guide">
      <header>
        <div className="eyebrow">How it works</div>
        <h1>Practise Ontario deals, start to finish</h1>
        <p>
          Every scenario is a new residential deal somewhere in Ontario. You're randomly the buyer's agent or the listing agent, up against a broker with 30 years in the
          business. You work the deal from first offer to completion (or until it falls apart) under TRESA and the RECO Code of Ethics. How hard the deal is stays hidden
          until the debrief.
        </p>
      </header>

      <section>
        <h2>1. Read the deal file</h2>
        <p>Start with the tabs at the top of the deal:</p>
        <ul>
          <li>
            <strong>Your client</strong>: their limits, must-haves, soft spots and story. It's confidential: never share their limit or why they're moving.
          </li>
          <li>
            <strong>Listing</strong>, <strong>Comps</strong> and <strong>Disclosures</strong>: the property, recent sales to argue from, and what the seller has disclosed.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Two conversations</h2>
        <p>Above the chat there are two tabs:</p>
        <ul>
          <li>
            <strong>The other agent</strong>: messages, offers and sign-backs, and everything after acceptance.
          </li>
          <li>
            <strong>Your clients</strong>: questions, reviewing documents before they go out, and presenting what the other side sends.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Ask your clients before you draft</h2>
        <p>
          The brief is what your clients told you at the first meeting. Each client also has two to four things they haven't mentioned, and they only come out when you ask
          about that topic:
        </p>
        <ul>
          <li>
            <strong>More room</strong>, under a condition. For example, a buyer who'd pay more to close sooner, or a seller who'd take less for a later date.
          </li>
          <li>
            <strong>Something they won't sign without</strong>: a chattel included, a fixture excluded, a longer inspection, a bigger deposit, or when it's paid.
          </li>
          <li>
            <strong>Background</strong>: worries and history that matter later.
          </li>
        </ul>
        <p>
          Good topics: timing, the deposit, conditions and the inspection, what stays and what goes, financing, other offers. "Is there anything else I should know?"
          brings out background, never money. If you don't ask, you find out when they refuse to sign, or never.
        </p>
      </section>

      <section>
        <h2>4. Offers and sign-backs</h2>
        <ol>
          <li>Write the offer or sign-back on the form. It follows the OREA Agreement of Purchase and Sale.</li>
          <li>
            <strong>Review with your clients.</strong> They sign, sign reluctantly near their limit, or refuse with their reasons. Revise if you need to.
          </li>
          <li>Send it once they've signed. Nothing goes out unsigned, including an acceptance.</li>
          <li>
            When the other side sends something, <strong>present it to your clients</strong> before you answer. They'll react, and sometimes that's when you learn what they
            really need.
          </li>
        </ol>
      </section>

      <section>
        <h2>5. Offer nights</h2>
        <p>In hot markets, the listing may hold offers for a review night.</p>
        <ul>
          <li>
            <strong>Buyer's agent</strong>: register an offer, or try a pre-emptive (bully) offer if the listing considers them. You learn the true number of competing
            offers, and you might get one chance to improve.
          </li>
          <li>
            <strong>Listing agent</strong>: get your sellers' <strong>written direction</strong> before disclosing what's in the offers. Tell every registered agent the true
            number of offers. Present all of them to your sellers.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. After acceptance</h2>
        <ul>
          <li>Move the calendar forward. Reports, the appraisal and the mortgage arrive on their own schedule.</li>
          <li>
            Each condition must be waived (Form 123) or fulfilled (Form 124) by its deadline, or the agreement is null and void and the deposit goes back.
          </li>
          <li>Problems become amendments: repairs, credits, price, dates. Present the other side's requests to your clients, and review every amendment with them.</li>
          <li>
            Your clients can surprise you: cold feet before going firm, a partner who isn't on board, second thoughts once it's firm. When they reach out, answer them.
          </li>
          <li>Then title requisitions, pre-closing visits, and completion with land transfer tax and a statement of adjustments.</li>
        </ul>
      </section>

      <section>
        <h2>7. The mentor</h2>
        <p>"Ask mentor" gets advice from a veteran broker at any point. The mentor only knows what you know: never the other side's limits.</p>
      </section>

      <section>
        <h2>8. The debrief and your scores</h2>
        <p>When a deal ends, the debrief reveals both clients, everything that was hidden, and the other agent's reasoning. You're scored on:</p>
        <ul>
          <li>
            <strong>Outcome</strong>: where you landed between the seller's floor and the buyer's ceiling.
          </li>
          <li>
            <strong>Process</strong>: your opening, your concessions, trading terms, handling conditions, and what you found out from your clients.
          </li>
          <li>
            <strong>RECO compliance</strong>. Things that cost you:
            <ul>
              <li>Disclosing your client's limit, finances or motivation</li>
              <li>Claiming offers that don't exist, or misstating how many there are</li>
              <li>Sharing offer contents without the seller's written direction</li>
              <li>Answering an offer or request you never presented to your client</li>
              <li>Pressuring your client past their limits, or telling them to walk away from a firm deal</li>
              <li>Legal advice: refer them to their lawyer instead</li>
            </ul>
          </li>
        </ul>
        <p>Your Progress page tracks your scores across deals. Nobody else sees your deals.</p>
      </section>

      <section>
        <h2>Tips from the veteran</h2>
        <ul>
          <li>Ask before you draft. Most refusals are things you could have learned in one question.</li>
          <li>Anchor with the comps, and leave yourself room to move.</li>
          <li>Make each concession smaller than the last.</li>
          <li>Trade terms, not just price: completion date, deposit, condition lengths and rental items all have value to someone.</li>
          <li>Don't waive financing before the mortgage commitment is in writing.</li>
        </ul>
      </section>

      <button className="primary large" onClick={onStart}>
        Start a deal
      </button>
    </article>
  );
}
