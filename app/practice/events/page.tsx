import EventsPanel from "./panel";
export default function Page() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Your trade activity</h1>
        <p>
          Order acceptance, fills and released reservations in one place.
          Processing this history does not place trades or change your funds.
        </p>
        <EventsPanel />
      </main>
    </div>
  );
}
