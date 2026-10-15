# Kalshi API 검토 — 3일차

검토일: 2026-09-26. 공개 문서에 근거한 구현 범위 기록이며 상업적 사용 승인이나 법률 판단을 대신하지 않는다.

## 무료로 쓸 수 있는가?

공식 가이드는 일부 시장 데이터 GET 요청을 API 키 없이 제공한다. 이는 기술적 접근 가능성을 뜻한다. 우리 앱처럼 타 사용자에게 데이터를 표시하고 이후 거래를 지원하는 상업적 서비스까지 무상으로 허용된다는 근거는 확인하지 못했다. 별도 요금의 유무와 데이터 사용 권한은 Kalshi에 확인해야 한다.

공개 Developer Agreement는 회원 본인의 거래를 위한 사용을 중심으로 권한을 정하며, 제3자 데이터 공유와 다른 사람의 거래·계정 생성을 지원하는 용도를 제한한다. Data Terms도 상업적 사용 및 재배포에 별도 동의를 요구한다. 따라서 앱을 공개 API에 바로 연결하지 않았다. 비용이 무료여도 이용 허가는 별개다.

## 구현

`lib/providers/kalshi/read-client.ts`의 `createKalshiReadClient()`는 다음만 제공한다.

- `listMarkets({ limit, cursor })`: open 시장, 한 페이지 최대 100개, 다음 페이지 커서 반환.
- `getMarket(ticker)`: 단일 binary 시장의 제목·상태·마감·호가·규칙 조회.
- 고정 HTTPS 주소, GET만 사용, 인증정보·쿠키 없음, 리디렉션 금지.
- 기본 5초 제한. HTTP 오류/429와 Retry-After, 연결 실패, 잘못된 응답, 시간 초과 구분. 자동 재시도 없음.
- 달러 가격은 문자열로 최대 소수점 4자리 보존. 없으면 null이며 임의로 0이나 샘플 가격으로 대체하지 않음.
- 지원하지 않는 계약/형식은 명시적 오류. 거래 가능한 가격이나 체결 보장으로 취급하지 않음.

현재 registry와 `/api/markets`, `/api/quotes`는 기존 demo만 사용한다. 이 연결부는 운영 경로에 등록되지 않았다. API 키, 실거래, WebSocket, 주문장, 입출금, 사용자별 계정 연결은 구현하지 않았다. 실제 Kalshi 응답 검증도 아직 하지 않았으며 테스트는 합성 데이터다.

## 승인 후 연결 순서

1. 데이터 표시·재배포·저장·상업적 이용 범위, 가격, 호출 한도와 계약 증빙을 확인한다.
2. 서버에서 실제 응답을 확인하고 계약 테스트를 갱신한다. 거래 가능 상품·지역·고지 요구사항을 적용한다.
3. 실시간 데이터용 별도 UI 모델을 붙인다. 현재 샘플 모델의 정수 cents나 가짜 차트에 그대로 넣지 않는다. 수수료/호가 크기/시장 상태 없이 실행 가능한 견적을 만들지 않는다.
4. 서버 registry에 명시적으로 등록하고 페이지 이동, 캐시/지연 표시, 호출 제한, 장애 안내를 검증한다. 브라우저가 직접 외부 API를 호출하지 않게 한다.
5. 사용자 계정과 거래 지원은 별도 권한·인증·주문 연동 검토 후 진행한다. 조회 연결만으로 실거래를 활성화하지 않는다.

## 공식 근거

- [인증 없는 시장 데이터 조회 가이드](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [시장 목록 API](https://docs.kalshi.com/api-reference/market/get-markets)
- [시장 상세 API](https://docs.kalshi.com/api-reference/market/get-market)
- [Developer Agreement](https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf)
- [Data Terms of Service](https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf)

문서 내용과 API 규격은 변경될 수 있으므로 활성화 시 다시 확인한다.
