# 자체 이벤트 시세 업데이트 — 2026-10-19

## 반영 내용
- 홈에서 Kalshi 호출·외부 이벤트·오류 문구 제거. 자체 이벤트 생성/관리 유지.
- 기존 YES/NO 매수 체결 기록을 최신 가격, 최근 120건 차트, 거래량에 연결.
- 이벤트 화면에서 5초마다 가격과 호가 갱신. 호가 클릭 시 지정가 입력.
- 보유 계약을 마지막 체결가로 평가하고 매수 수수료를 포함한 미실현 손익 표시.
- 포트폴리오는 화면이 보일 때 15초마다 갱신. 홈 카드는 페이지를 열거나 새로고침할 때 갱신.

## GitHub 적용
1. 이 ZIP을 압축 해제합니다.
2. my-site 저장소 최상위(package.json이 있는 위치)에 app, lib, tests 폴더를 같은 경로로 병합하여 업로드합니다.
3. 기존 동일 경로 파일은 교체하고 새 파일은 추가합니다. 압축을 푼 상위 폴더 자체를 추가하지 마세요.
4. main에 Commit changes 합니다.
5. Cloudflare every-event의 자동 배포가 완료되는지 확인합니다.
6. 운영사이트 홈과 이벤트 상세, Portfolio를 새로고침합니다.

기존 vite.config.ts, wrangler.production.json, Cloudflare 런타임 설정은 그대로 사용합니다.
이번 변경에는 새 마이그레이션·환경변수·외부 API 키가 없습니다.
비밀키, 사용자 데이터, 빌드 결과, 테스트용 데이터는 ZIP에 없습니다.

## 사용 확인
각기 다른 두 계정에서 연습 잔액을 활성화하고, 마감 전인 동일 이벤트를 엽니다.
첫 계정에서 YES 60센트 10계약 주문, 두 번째 계정에서 NO 40센트 10계약 주문을 제출하면
서로 체결되고 YES 60센트/NO 40센트가 기록됩니다. 다음 거래를 다른 가격으로 체결하면 차트와 평가액이 바뀝니다.
동일 계정끼리는 체결되지 않습니다. 호가가 없으면 지정가 주문은 대기합니다.
실제로 거래가 없을 때는 임의 가격을 생성하지 않으며, 가격은 실제 체결이 일어날 때만 바뀝니다.

## 범위와 제한
가상자금 매수 주문의 YES/NO 상호 체결 방식입니다. 기존 매도 기능은 계약 예약 단계이며 매도 체결은 아직 없습니다.
평가손익은 마지막 체결가 기준 추정치이고, 현금 잔액이나 확정 수익이 아닙니다.
최종 결과에 따른 정산금 지급·현금화·실제 화폐 거래는 이번 변경에 포함되지 않습니다.
최근 거래가 오래되면 마지막 거래 시각을 확인하세요. 거래 중단/마감 시 새 체결이 차단됩니다.

## 검증
자동 테스트 210개 통과. TypeScript 검사, 로컬 빌드, Cloudflare 설정을 사용하는 운영용 빌드 통과.
별도 가상 테스트 데이터로 가격/차트/호가 표시 및 호가 클릭 시 입력을 브라우저에서 확인했습니다.
로컬 검증용 Workers 런타임은 설치 버전에 맞춰 호환 날짜만 2026-05-22로 임시 실행했습니다.
운영 설정 파일은 변경하지 않았습니다. 이 ZIP 자체는 아직 GitHub나 운영사이트에 배포하지 않았습니다.

## 변경 파일
- app/page.tsx
- app/globals.css
- app/events/market-panel.tsx
- app/events/[id]/page.tsx
- app/events/order-preview.tsx
- app/events/practice-submit.tsx
- app/api/events/[id]/market/route.ts
- app/practice/positions.tsx
- app/practice/practice-panel.tsx
- lib/practice/market.ts
- lib/practice/positions.ts
- lib/practice/service.ts
- tests/market-prices.test.mjs
