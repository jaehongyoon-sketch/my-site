import Panel from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Review event outcomes</h1>
        <p>
          For closed events only. Save an evidence-backed proposal, review its
          exact version, then confirm it. Final results cannot be edited here.
          The same administrator may propose and confirm; this is not
          independent two-person approval. Confirmation records the outcome but
          does not pay or redeem contracts.
        </p>
        <p>
          <a className="account-link" href="/admin/events">
            Create, edit & publish events →
          </a>
        </p>
        <Panel />
      </main>
    </div>
  );
}
