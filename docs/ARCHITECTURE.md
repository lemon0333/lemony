# lemony — 아키텍처 (ARCHITECTURE)

## 컴포넌트
```
[ Builder UI (React/Vite/TS) ]
        │  자연어 요청 / 프리뷰
        ▼
[ Agent Orchestrator (Node/TS) ]
   │        │            │
   │        │            └─▶ [ Quarkify CLI ]  ← 코드맵(폴더 토폴로지 + quark_meta.json + 콜그래프)
   │        └─▶ [ LLM (Claude) ]  자연어→수정계획
   └─▶ [ 생성 사이트 워크스페이스 (React/Vite) ]
        ▼
[ Preview / Publish (정적 호스팅) ]
```

## 데이터 흐름 (편집 루프)
1. 사용자: "문의 폼 추가" (한국어)
2. Agent: Quarkify 맵 조회 → 어느 컴포넌트/파일을 건드릴지 **정확히 타겟** (추측 X)
3. Agent: 영향 범위 확인(콜그래프/quark_meta) → 수정 계획 생성
4. LLM: 계획에 따라 코드 패치 생성
5. 적용 → 재인덱싱(증분) → 프리뷰 갱신 → 성공/실패 피드백

## 기술 스택
- 빌더 UI: React 18 + Vite 5 + TS (flowstock-front 스택과 통일)
- 에이전트: Node 22 + TS, child_process로 Quarkify 호출
- 생성 타겟: React/Vite 정적 사이트
- 신뢰성: **Quarkify** (`../Quarkify/quarkify/quarkify.mjs`)

## Quarkify 활용 포인트
- 생성/임포트된 사이트를 `node quarkify.mjs <config>` 로 인덱싱
- `quark_meta.json`(file:line) → 패치를 정확한 위치에 적용 + 인용
- 콜그래프(`resolves_to__`) → "이 컴포넌트 바꾸면 뭐가 영향?" 안전 판단
- `--collapse` → 코드맵을 단일 JSON으로 LLM 컨텍스트에 저렴하게 주입
- `--doc/--doc-join` → 긴 요구사항 문서를 문장 단위로 그라운딩(할루시네이션 억제)

## 기존 프로젝트 import (로드맵)
업로드/깃 URL → 스택 감지 → Quarkify 인덱싱 → "이해 요약" 제시 → 편집 루프 진입.

## 결정 필요
- LLM 제공자/모델 고정, 발행 인프라(Vercel/Netlify/자체), 멀티테넌시/저장소 모델, 인증.
