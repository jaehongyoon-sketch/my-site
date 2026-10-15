import EligibilityAdmin from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Trading restrictions</h1>
        <p>
          Restrict new practice buys, sell reservations and matching. Viewing
          records and cancelling remain available for active profiles. Removing
          a restriction may allow existing open orders to match again. These
          controls do not approve identity checks or enable real money.
        </p>
        <EligibilityAdmin />
      </main>
    </div>
  );
}
