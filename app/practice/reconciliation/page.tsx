import Panel from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Check your trading records</h1>
        <p>
          Compare cash, accounting entries, order progress, matched contracts
          and sell reservations. Checks use all your saved records and never
          adjust balances or repair trades automatically.
        </p>
        <Panel />
      </main>
    </div>
  );
}
