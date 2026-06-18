# lemony web (React/Vite) — flowstock-front 구조 참조
src 레이아웃을 flowstock-front 와 동일하게:
- `src/pages` — 라우트 페이지(빌더/대시보드)
- `src/components` — UI 컴포넌트
- `src/services` — 백엔드 API 클라이언트(/api/create, /api/edit, /api/sites, /auth)
- `src/stores` — 상태(예: zustand)
- `src/hooks`, `src/lib`
이전 인터림 UI: `services/agent/src/ui.html` (Lovable 스타일) → 이 구조의 React 컴포넌트로 포팅.
