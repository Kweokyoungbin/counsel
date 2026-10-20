# 친구야, 짐을 나누자 — Render 배포용 프로젝트

## 파일 구성
- `index.html`: 웹앱 화면 및 기능
- `server.js`: Node.js 서버, Gemini 상담/노래 추천, Supabase 설정 전달, 사람 상담 요청 API
- `package.json`: Render가 `npm start`를 실행하는 데 필요한 파일
- `supabase_setup.sql`: Supabase 데이터 저장 테이블 설정 SQL
- `.env.example`: 필요한 환경변수 이름 예시(실제 비밀키 없음)
- `.gitignore`: `.env` 및 로컬 데이터가 GitHub에 올라가지 않도록 제외

## Render 설정
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: 비워 둠 (이 파일들이 저장소 최상위에 있을 때)

Render의 Environment에는 실제 값으로 다음을 설정하세요.
- `GEMINI_API_KEY`: Google AI Studio에서 발급한 키
- `GEMINI_MODEL`: `gemini-3.8-flash` (현재 사용 설정 유지)
- `SUPABASE_URL`: Supabase 프로젝트 URL (`https://...supabase.co` 형태)
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key
- `ADMIN_PASSWORD`: 운영자 메뉴 확인용 비밀번호

비밀키는 이 ZIP의 `.env.example`이나 GitHub 파일에 넣지 마세요. Supabase `service_role` 키도 프런트엔드나 GitHub에 넣지 마세요.

## GitHub에 올릴 때
압축을 푼 다음 **ZIP 자체가 아니라 ZIP 안의 파일 7개를 저장소 최상위에** 올립니다. 특히 `package.json`, `server.js`, `index.html`은 같은 폴더에 있어야 합니다. 이미 존재하는 파일은 새 버전을 업로드해 교체할 수 있지만, 기존 파일을 먼저 백업해 두세요.

## 배포 확인
배포 후 `https://서비스주소.onrender.com/api/health` 를 열었을 때 JSON 응답에 `"ok":true`가 표시되면 서버 프로세스가 실행 중입니다. 그다음 서비스 주소(`/`)에서 웹앱을 확인하세요.

참고: 이 ZIP은 파일 구조, JavaScript 문법, 로컬 서버의 기본 경로를 점검한 패키지입니다. 실제 Gemini 키·Supabase 프로젝트와 연결된 온라인 계정으로는 여기서 직접 인증 테스트를 할 수 없으므로, Render 환경변수와 Supabase 설정도 확인해야 합니다.
