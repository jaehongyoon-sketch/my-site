# Event — Day 9

미국 사용자가 기존 거래소의 예측시장을 거래하는 앱의 5일차 기반 코드.
**현재는 fixture 기반 개발 버전이며, 실제 USD·주문·시세·제휴가 없다. Google 로그인과 앱 프로필 저장이 활성화되어 있다.**

## 실행

Node.js 22.13+와 npm 사용. 커밋된 package-lock.json을 유지한다.

```sh
npm ci
npm run dev
```

## 검증

```sh
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

프레임워크: 제공된 React/TypeScript Vinext starter(Next 호환 구조). API 경로는 서버에서 동작하며 Cloudflare Worker로 빌드 가능하다.

## 오늘 사용할 수 있는 기능

- 영어 모바일 대응 시장 목록, 카테고리/검색, 페이지 세션 안의 관심 시장
- 시장 상세, 판정 규칙/계약 정보
- YES/NO, 정수 수량 1~10,000, 서버 기반 견적 검토
- 앱 수수료 0.25% 계산, 거래소 수수료 미확정 표시, 실제 주문/거래소 계정 연결 차단
- 분리된 도메인 계산과 provider 계약

## 경계

- 제출 버튼이 disabled인 것만으로 보호하지 않는다. POST /api/orders도 항상 503.
- API 견적은 indicative이며 실행 가능한 가격 보장이 아니다. 실제 최대 손실/총액은 수수료 연결 전 완성되지 않는다.
- 브라우저 값은 신뢰하지 않는다. 서버가 fixture 가격과 수량 검증으로 다시 계산한다.
- Google 전용 로그인과 D1 프로필 저장 구현. 실제 로그인 활성화에는 Google OAuth 설정이 필요하다.
- 관심 시장은 활성 계정별로 DB에 저장되며 새로고침 후에도 유지된다.
- 이후 실거래 구현에는 인증·인가·CSRF·속도 제한·파트너 권한·서버 비밀키 관리·대조/감사가 필수다.

문서: [30일 실행 계획](docs/30-DAY-PLAN.md), [제휴사 추가 지침](docs/INTEGRATIONS.md).

## 2일차 추가

계정·주문·체결·자금 모델과 11개 테이블의 SQL 스키마를 추가했다. 상태 전이/계정 정책/DB 제약을 포함한 총 33개 테스트가 있다.
2일차 당시에는 로컬 검증만 완료했다. 4일차에는 운영 DB 바인딩과 앱 계정 저장을 추가했다.

- [데이터 모델](docs/DATA-MODEL.md)
- [상태 전이](docs/STATE-MACHINES.md)
- [2일차 인계](docs/DAY-02-STATUS.md)

## 3일차 추가

Kalshi 공식 공개 조회 API에 맞춘 서버용 연결부와 오류/정밀도 테스트를 추가했다. 현재 실행 경로에는 등록하지 않았으며 실제 시세를 호출하지 않는다. 상업적 데이터 표시/재배포와 제3자 거래 지원 권한 및 비용 확인이 먼저 필요하다.

- [Kalshi 사용 범위와 연결 방법](docs/KALSHI-API-REVIEW.md)
- [제휴 검토용 제품 설명](docs/PARTNER-BRIEF.md)
- [제휴 질문서](docs/PARTNER-QUESTIONS.md)
- [3일차 인계](docs/DAY-03-STATUS.md)

## 4일차 추가

Google 전용 인증, 서버 세션, 프로필 생성/수정/비활성화/재활성화와 로그아웃을 구현했다. ChatGPT 앱 로그인은 제거했다. Google 인증 정보 등록 전까지 실제 로그인은 비활성화된다.

앱 trading fee는 contract cost의 0.25%이며 주문당 센트 단위 반올림한다. $100 계약 금액 → $0.25 수수료. 거래소 수수료는 별도이며 실제 청구는 없다.

- [4일차 인계](docs/DAY-04-STATUS.md)
- [Google 로그인 활성화](docs/GOOGLE-LOGIN-SETUP.md)

## 5일차 추가

`/admin` 관리자 전용 등록 계정/세션 집계, 서버 환경 변수로 지정하는 관리자 계정, 사용자별 관심 시장 영구 저장을 추가했다. [5일차 인계](docs/DAY-05-STATUS.md). 이전 일차의 인증 정보 설정 대기 사항은 해소되었으며 실제 로그인·프로필 저장을 사용자 화면에서 확인했다.

## Day 6 — Provider approval management

Administrators can open `/admin/providers` from the Accounts page to record Kalshi sandbox/live reviews. Status changes require a reason, approved records require an approval reference, and live connections cannot enter sandbox testing. Every change is persisted with its actor and revision; stale writes return 409. Approval records do not enable adapters or trading. See `docs/DAY-06.md`.

## Day 7 — Own events and name-change cooldown

The active home page and `/api/markets` now serve Event-owned records from D1, not sample fixtures or Kalshi. Administrators create, edit drafts, publish and archive at `/admin/events`. Published terms are locked. Search, categories, closing-status filters, 12-item pages, detail rules and saved-event browsing are connected. No generated prices, quotes, settlement or real-money execution. Kalshi code remains inactive historical groundwork.

Ordinary accounts can change their display name once per 7 days. Initial profile creation does not consume a change; existing profiles get their first change after this release immediately. Same-name saves do not reset the timer. Administrators are exempt by server account ID. The cooldown survives deactivation; reactivation with the previous name retains its deadline. See `docs/DAY-07.md`.

## Day 8 — Market status and price contract

Event details now show checked market state, price/source availability, automatic closure and manual/15-second refresh. There is no live price feed; all current prices are null. Staleness and full-snapshot reconciliation rules are tested for a later internal order-book adapter. Quotes validate event visibility and expiry but never execute. See `docs/DAY-08.md`.

## Day 9 — Limit-buy review

Active signed-in profiles can review an own-event limit buy from the detail page. The server validates the account, event revision/deadline, whole-cent limit and whole-contract quantity; independently computes cost plus the 0.25% fee; and returns a short-lived, non-executable review. No order, reservation or payment is created. See `docs/DAY-09.md`.
