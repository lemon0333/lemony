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

## 웹사이트 만들기 (핵심 플로우)
비전공자가 한 문장으로 사이트를 만들고 즉시 미리본다. **별도 API 키 없이 로그인된 Claude(`claude` CLI)로 동작.**
```bash
# 1) CLI로 바로 생성 (자기완결 단일 index.html)
npm -w @lemony/agent run generate -- "동네 빵집 소개 페이지. 메뉴, 영업시간, 오시는 길, 인스타"
#    → lemony-sites/site_xxx/index.html (브라우저로 열면 끝)

# 2) UI로 생성 + 실시간 프리뷰 + 자연어 수정
npm -w @lemony/agent run serve     # 에이전트 서버 (POST /create, /edit-site, GET /preview/<id>/)
npm -w @lemony/builder run dev      # 빌더 UI(:3000) — "만들기" → iframe 프리뷰 → "수정하기"
```
- 작은 사이트는 단일 HTML 통째 생성/수정(빌드 불필요 → 즉시 프리뷰).
- 사이트가 커지면(멀티파일) `services/agent`의 Quarkify 그라운딩 편집 루프(`/edit`)로 정확히 수정.

## 시작
```bash
nvm use            # node 22
npm install        # (워크스페이스)
```

## 기존 프로젝트 가져오기 (import)
이미 만든 블로그/사이트를 lemony 로 가져와 이어서 작업할 수 있다. 스택 자동감지 → Quarkify 매핑 → "이해 요약" 생성:
```bash
# 깃 URL 또는 로컬 경로
npm -w @lemony/agent run import -- https://github.com/user/blog.git
npm -w @lemony/agent run import -- /path/to/existing-project
```
→ 스택(TS/React, Kotlin/Spring, Python, Go, Rust 등)을 감지하고 코드맵 + `IMPORT_SUMMARY.md`(역할/종류 분포, 진입점)를 만든다. 이후 에이전트가 이 맵 위에서 자연어 편집을 정확히 타겟팅한다. 구현: `services/agent/src/import.ts`.

## Quarkify 연동
`services/agent/src/quarkify.ts` 가 Quarkify CLI(`node quarkify.mjs ...`, `--collapse`/`--k6`/`--doc`/`--solve`)를 child_process로 호출해 코드맵을 얻는다. (현재 Quarkify: `../Quarkify/quarkify`)
- `generateConfig` / `quarkifyRun` — 대상 코드 인덱싱
- `loadSymbolMeta` — `quark_meta.json`(file:line) 그라운딩
- `solve` — 이슈 키워드 → 관련 심볼/영향범위 팩
