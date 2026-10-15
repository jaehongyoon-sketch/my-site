import OperationsBanner from "./operations-banner";
import PracticePanel from "./practice-panel";
export default function PracticePage() {
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Practice portfolio</h1>
        <p>Virtual funds · YES + NO = $1 per pair, before fees.</p>
        <OperationsBanner />
        <PracticePanel />
      </main>
    </div>
  );
}
