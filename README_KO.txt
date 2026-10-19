친구야, 짐을 나누자 — AI 연결 준비 버전

포함된 기능
- 기존 상담 UI, 음악 검색, 커뮤니티, 감사일기, 감정 기록, 목표, 마이페이지, 사람 상담 요청/운영자 답변 유지
- 서버의 /api/chat 경로에서 Gemini API를 호출 (API 키를 브라우저에 노출하지 않음)
- Supabase 이메일 회원가입/로그인과 사용자별 앱 상태 저장 코드 포함

먼저 해야 할 설정
1. Supabase Dashboard > SQL Editor에서 supabase_setup.sql 내용을 붙여넣고 Run을 누릅니다.
2. index.html에서 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY 값을 본인의 프로젝트 URL 및 Publishable key로 바꿉니다. sb_publishable_... 키만 사용하세요. Secret/service_role 키는 절대 넣지 마세요.
3. 호스팅 서버 환경변수에 GEMINI_API_KEY를 설정합니다. API 키를 index.html에 넣지 마세요. GEMINI_MODEL은 기본값 gemini-2.5-flash입니다.
4. 운영자 비밀번호도 ADMIN_PASSWORD 환경변수로 강력하게 설정합니다. 기본 demo-admin은 개발용이며 공개 서비스에서 사용하면 안 됩니다.
5. Node.js 18 이상에서 npm start로 로컬 테스트할 수 있습니다. AI는 서버에서 GEMINI_API_KEY가 설정되어 있어야 동작합니다.

중요한 현재 한계
- Supabase 사용자별 상태 저장은 앱 상태 JSON을 사용자 계정 행 하나에 저장합니다. 커뮤니티 게시글의 전체 사용자 공유, 운영자 답변의 인증/권한 구조, 관리자 역할은 별도 보강이 필요합니다.
- 사람 상담 요청 API는 기존 로컬 JSON 파일 기반입니다. 클라우드 배포에서는 파일 시스템이 영구 저장되지 않을 수 있으므로 실제 공개 전 Supabase 테이블로 옮겨야 합니다.
- 이 앱은 상담 전문가를 대체하지 않습니다. 실제 학생들에게 공개하기 전 담당 교사와 개인정보 보호·보관 기간·위기 대응 절차를 정하세요.
- API 무료 한도는 변할 수 있습니다. Google AI Studio에서 사용량과 결제 설정을 확인하고, 예상치 못한 과금이 없도록 결제 연결 여부를 확인하세요.
