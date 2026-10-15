# Google 로그인 활성화

현재 구현은 Google 전용이다. 비밀번호를 앱에 입력하거나 저장하지 않는다. 운영 인증 정보가 없어서 버튼은 설정 대기 상태다.

## 1. Google Cloud 설정

[Google Auth Platform](https://console.cloud.google.com/auth/overview)에서 사용할 프로젝트를 선택하고 앱 이름, 지원 이메일, 대상 사용자, 필요한 동의 화면 정보를 설정한다. OAuth 클라이언트 종류는 Web application으로 생성한다.

Authorized redirect URI를 정확히 등록한다:

```
https://event-market-day-one-jy.jaehong-yoon.chatgpt.site/api/auth/google/callback
```

요청 범위는 openid, email, profile이다. 테스트 모드에서는 허용된 테스트 사용자를 등록한다. 외부 고객 공개 전 Google의 앱 게시/검증 요구사항과 정책을 확인한다. 도메인이나 사이트 주소가 바뀌면 redirect URI와 APP_ORIGIN을 함께 갱신한다.

## 2. 서버 환경 변수

| 이름                 | 값                                                        | 취급               |
| -------------------- | --------------------------------------------------------- | ------------------ |
| GOOGLE_CLIENT_ID     | Google 발급 Web application Client ID                     | 서버 환경 변수     |
| GOOGLE_CLIENT_SECRET | 해당 클라이언트의 Secret                                  | 비밀 값으로 저장   |
| APP_ORIGIN           | https://event-market-day-one-jy.jaehong-yoon.chatgpt.site | 마지막 슬래시 없음 |

Sites 런타임 환경 변수에 등록한 후 새 버전을 배포한다. Client Secret을 소스 코드, 채팅, 공개 프런트엔드 변수에 넣지 않는다. Google에서 받은 클라이언트 JSON 파일이 있다면 프로젝트 밖의 안전한 로컬 위치에 두고, 그 파일의 경로만 전달해 서버 비밀 설정으로 가져올 수 있다.

localhost 테스트에는 별도의 Google 테스트 클라이언트와 `http://localhost:5173/api/auth/google/callback`, `APP_ORIGIN=http://localhost:5173`이 필요하다. 로컬 비밀 파일은 버전 관리에서 제외한다.

## 3. 검증

- Google 동의 후 Event 프로필 생성, 이름 변경, 새로고침과 재로그인 후 유지.
- 동의 취소, 잘못된 콜백, 만료된 로그인, 이미 사용된 state의 거부.
- 로그아웃 후 계정 API 401, 비활성화 후 기존 세션 폐기, 새 로그인 후 명시적 재활성화.
- 계정 두 개 사이의 데이터 분리. 같은 이메일에 의존한 자동 병합 없음.

현재 사이트는 소유자 전용 비공개 상태다. Google 앱 로그인을 설정해도 일반 고객에게 사이트 접근 권한이 자동으로 생기지 않는다. 공개 출시 시 별도로 사이트 공개 범위를 변경해야 하며, 그 변경은 이번 작업에 포함하지 않았다.

## 구현 위치

- `lib/auth/google-core.ts`: 서명·클레임 검증, 세션/쿠키, 일회성 state
- `lib/auth/google.ts`: 서버 설정 및 인증 사용자 읽기
- `app/api/auth/google`: Google 이동/콜백
- `app/api/auth/logout`: 세션 폐기
- `app/api/account`: 인증된 사용자 프로필 관리

Google ID/이메일/이름은 인증 목적에 필요한 세션 레코드에 저장되고, 만료 레코드는 이후 로그인 처리 때 정리한다. 즉시 법적 삭제 요청 처리나 사용자 감사/거래 기록 보존 정책은 출시 준비 시 별도 확정한다.

공식 자료: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google OIDC reference](https://developers.google.com/identity/openid-connect/reference), [jose](https://github.com/panva/jose).
