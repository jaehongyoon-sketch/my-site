import Panel from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="admin-main">
        <h1>Trading controls & audit log</h1>
        <p>
          Pause new practice buys, sell reservations and matching across all
          events. Existing orders stay recorded; viewing and cancellation remain
          available. Resume does not automatically match waiting orders.
        </p>
        <p>
          <a href="/admin/eligibility">Account-specific restrictions →</a>
        </p>
        <Panel />
      </main>
    </div>
  );
}
