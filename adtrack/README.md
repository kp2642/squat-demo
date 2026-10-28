# 광고 성과 추적 (adtrack)

상담형 업종 사장님이 광고 채널별로 광고비 대비 문의·계약·매출을 한 화면에서 보는 웹 서비스.
요구사항 문서: 「범용적 광고성과추적 · 1차 개발 요구사항」

- 웹 앱: Next.js 16 (App Router, TypeScript)
- DB·로그인: Supabase (PostgreSQL + Auth + 행 단위 보안)
- 배포: Vercel

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 기반: 가입·로그인, 사업장 생성, 업종 프리셋, 직원 초대, 사업장 데이터 분리 | 완료 |
| 2 | 추적 코드 + 수집 API | |
| 3 | 문의함 | |
| 4 | 광고비 | |
| 5 | 성과 화면 | |
| 6 | 설치 탭과 처음 설정 흐름 | |
| 7 | 실제 업체 테스트 | |

## 1단계에서 만든 것

- **가입** (`/signup`): 이메일·비밀번호·사업장 이름·업종·홈페이지 주소(여러 개). 메일 확인을 켜 둔 경우 확인 링크를 누르면 `/onboarding` 에 입력값이 다시 채워진 채로 돌아와 사업장을 만든다.
- **업종 프리셋** (`industry_presets`): 법률·병원·세무·학원·인테리어·기타. 고르면 계약 용어, 평균 계약 금액, 상담 유형이 채워지고 설치 탭에서 모두 고칠 수 있다.
- **기본 채널**: 네이버 검색광고, 구글·메타·카카오 광고, 블로그·체험단, 네이버 예약·톡톡, 자연 검색, 지인 소개, 직접 방문. 출처 판별 규칙(2단계)이 `code` 로 찾으므로 지울 수 없고 숨길 수만 있다.
- **직원 초대**: 설치 탭에서 이메일과 역할로 초대 링크(7일)를 만들어 복사해 보낸다. 초대받은 이메일로 로그인해야 수락된다. 한 계정은 한 사업장에만 속한다.
- **역할**: 관리자는 4개 탭 전부, 직원은 문의함만. 직원은 자기 이름 외에는 설정을 바꿀 수 없다.
- **데이터 분리**: 모든 사업장 테이블에 `workspace_id` 와 RLS 정책. 사업장·사용자 생성과 초대 수락은 `security definer` 함수(`create_workspace`, `accept_invitation`)로만 가능하고, 수정 가능한 열도 grant 로 제한한다(역할·추적 키·`workspace_id` 는 바꿀 수 없음).

## 테스트

```bash
npm install
npm test           # 단위 테스트
npm run test:db    # 데이터 분리 테스트 (아래 참고)
npm run typecheck
```

`test:db` 는 PostgreSQL 에 Supabase 의 역할·`auth.uid()` 를 흉내 내는 `tests/db/supabase-shim.sql` 과 마이그레이션을 적용한 뒤,
두 사업장을 만들어 모든 테이블에서 읽기·수정·삭제·추가가 서로 막히는지 확인한다.
shim 은 Supabase 처럼 기본 권한을 모두 열어 두므로, 테스트가 통과하는 건 마이그레이션의 정책 덕분이다.
`workspace_id` 열이 있는 테이블은 새로 생겨도 자동으로 검사 대상이 된다.

- `DATABASE_URL` 이 없으면 로컬 PostgreSQL 바이너리로 임시 DB 를 띄웠다가 지운다.
- GitHub Actions(`.github/workflows/adtrack.yml`)에서 push 마다 실행된다.

## Supabase 연결

1. Supabase 프로젝트를 만들고 `supabase/migrations/` 의 SQL 을 순서대로 실행한다 (SQL Editor 또는 `supabase db push`).
2. `.env.example` 을 `.env.local` 로 복사해 프로젝트 URL 과 anon 키를 넣는다.
3. Authentication → URL Configuration
   - Site URL: 서비스 주소 (로컬은 `http://localhost:3000`)
   - Redirect URLs: `<서비스 주소>/auth/confirm`
4. Authentication → Providers → Email: **Confirm email 을 켜 둔다.** 초대 수락은 로그인한 이메일과 초대 이메일이 같은지로 확인하기 때문.
5. `npm run dev`

Vercel 에 배포할 때는 루트 디렉터리를 `adtrack` 으로 두고 같은 환경 변수 두 개를 넣는다.

## 다음 단계로 넘긴 것

- 초대 메일 자동 발송 (지금은 링크 복사)
- 문의 변경 기록(`lead_events`)은 문의 테이블과 함께 3단계에서
- 탈퇴한 사업장 데이터 30일 후 삭제
