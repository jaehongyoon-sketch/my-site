import Panel from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Fees &amp; releases</h1>
        <p>
          New orders charge 0.25% of each filled contract’s execution price,
          retaining sub-cent amounts. A $0.60 contract has a $0.0015 practice
          fee; 100 such contracts have a $0.15 fee. Older orders retain their
          original fee policy.
        </p>
        <section className="account-card">
          <h2>What is charged or returned?</h2>
          <ul>
            <li>Unfilled orders: funds are reserved, not charged as fees.</li>
            <li>
              Partial fills: fees apply only to filled contracts. The remaining
              reservation stays held.
            </li>
            <li>
              Cancellation, expiry or hiding an event: unused reservations are
              released with no cancellation fee. Fees on existing fills remain
              charged.
            </li>
            <li>
              Better execution prices: unused reserved funds are released during
              the fill.
            </li>
            <li>Sell reservations: no execution and no fee charge yet.</li>
            <li>
              VOID outcomes: the settlement preview models a principal and fee
              return. No settlement refund has been applied.
            </li>
          </ul>
          <p>
            Released reservations are not refunds of previously charged fees.
            All amounts below are virtual; real revenue is $0.
          </p>
        </section>
        <Panel />
      </main>
    </div>
  );
}
