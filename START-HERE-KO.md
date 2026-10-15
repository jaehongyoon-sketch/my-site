# Event 로컬 소스 — 2026-10-16

현재까지 작성된 소스 코드, UI, Kalshi 조회 연동, 자체 이벤트 관리, Google 로그인, 모의 투자 및 마이그레이션·테스트가 포함되어 있습니다.

## 새 컴퓨터에서 실행
Node.js 24 LTS와 npm이 필요합니다. 압축을 풀고 event-market 폴더의 터미널에서 실행하세요.

```sh
npm ci
npx wrangler d1 migrations apply DB --local --config wrangler.local.json --persist-to .wrangler/state
cp .env.example .env
```

.env에서 다음 값을 설정하세요. Google 비밀키는 서버 설정에만 넣으세요.

```dotenv
APP_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=본인의_Google_클라이언트_ID
GOOGLE_CLIENT_SECRET=본인의_Google_클라이언트_비밀키
ADMIN_ACCOUNT_ID=
```

Google 콘솔의 승인된 리디렉션 URI: http://localhost:5173/api/auth/google/callback

```sh
npm run dev
```

http://localhost:5173/ 에 접속하세요. 종료는 서버를 실행한 터미널에서 Control+C입니다.
로그인하고 프로필을 만든 뒤 계정 화면의 Account ID를 .env의 ADMIN_ACCOUNT_ID에 넣으면 해당 계정을 관리자로 지정할 수 있습니다.

## 포함하지 않은 파일
.env 비밀키, 로컬 데이터베이스·로그인 세션·사용자 기록, node_modules, 빌드 결과, Git 이력은 제외했습니다. 새로 설치하면 기존 계정과 이벤트 데이터는 자동 복원되지 않습니다. 원래 작업 폴더의 데이터와 설정은 그대로 남아 있습니다.

기존 프로젝트 위치:
/Users/jaehongyoon/Documents/Codex/2026-09-25/new-chat/outputs/event-market

현재 모의 투자용입니다. Kalshi 데이터는 조회용이며 자체 이벤트는 관리자 화면에서 생성·게시합니다. 이 ZIP의 새 환경 설치는 별도로 실행 검증하지 않았습니다.
