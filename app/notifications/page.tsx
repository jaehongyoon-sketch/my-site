import Panel from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Notifications</h1>
        <p>Practice order updates</p>
        <details className="compact-help"><summary>Sync settings</summary><p>Sync loads up to 100 trade records. Records synced while notifications are off are skipped permanently. Existing notifications and orders are kept.</p></details>
        <Panel />
      </main>
    </div>
  );
}
