# lemony 🍋

> **비전공자도 진짜로 만드는 AI 웹사이트 빌더.** Lovable 같은 류지만, Lovable조차 어느 정도 기술 감각이 있어야 쓸 수 있던 그 *간극*을 없애는 것이 목표.

## 핵심 차별점 — 신뢰성(Reliability)
Lovable류의 진짜 한계는 "생성"이 아니라, 프로젝트가 커질수록 AI가 코드베이스를 헷갈려(할루시네이션) 엉뚱한 곳을 고치고 **비전공자는 디버깅 못 해 이탈**하는 것. lemony는 이 벽을 없앤다.

그 엔진이 **Quarkify** — 소스코드를 물리 폴더 트리로 분해해 AI가 파일을 안 열고도 구조를 정확히 짚게 하는 코드맵. lemony 에이전트는:
1. 폴더 토폴로지로 **수정 지점을 정확히 타겟**
2. 콜그래프 + `quark_meta.json`(file:line)로 **"이거 바꾸면 뭐 깨지나" 안전 판단**
3. 문장-폴더/그라운딩으로 **한국어 자연어 요청을 정확히 해석**

## 구조 (monorepo)
- `apps/builder` — 빌더 UI (React + Vite + TS). 프롬프트 입력 → 실시간 프리뷰.
- `services/agent` — 에이전트 오케스트레이션 (Node + TS). 자연어 → Quarkify 맵 → 수정 계획 → 적용.
- `packages/templates` — 생성될 사이트 베이스 템플릿.
- `docs/` — `PRODUCT.md`(비전/타겟), `ARCHITECTURE.md`(시스템 설계).

## 시작
```bash
nvm use            # node 22
npm install        # (워크스페이스)
npm run dev        # TODO: builder + agent 동시 실행
```

## Quarkify 연동
`services/agent/src/quarkify.ts` 가 Quarkify CLI(`node quarkify.mjs ...`, `--collapse`/`--k6`/`--doc`)를 child_process로 호출해 코드맵을 얻는다. (현재 Quarkify: `../Quarkify/quarkify`)
