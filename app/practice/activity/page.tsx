import ActivityPanel from "./activity-panel";
export default function ActivityPage() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Funds &amp; activity</h1>
        <p>
          <a href="/practice/fees">Fee details &amp; cancellation rules →</a>
        </p>
        <ActivityPanel />
      </main>
    </div>
  );
}
