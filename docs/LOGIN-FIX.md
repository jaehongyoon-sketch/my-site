# Google 로그인 콜백 오류 수정

운영 로그에서 browser_state와 consume_state 이후 token_exchange 단계의 예외를 확인했다. 동일한 workerd 실행 환경에서 기존 요청을 재현하면 `redirect: "error"`가 지원되지 않는다는 TypeError가 발생했다. Google로 요청이 전달되기 전의 런타임 호환성 문제다.

`redirect: "manual"`로 변경하고 기존 비정상 HTTP 상태 거부를 유지한다. 따라서 3xx를 따라가며 client secret을 다른 주소로 전송하지 않는다. Kalshi 조회 연결부의 같은 옵션도 수정했다.

실제 요청 생성 함수를 workerd에서 실행하는 회귀 테스트를 추가했다. 테스트는 합성 인증 정보와 모의 302 응답으로 요청이 다른 주소를 따라가지 않는지 검증한다. 별도의 합성 요청으로 실제 Google endpoint가 HTTP 400 invalid_request를 반환하는 것을 확인하여 서버 요청 자체가 실행됨을 확인했다. 실제 사용자 인증 성공은 재로그인으로 최종 확인해야 한다.
