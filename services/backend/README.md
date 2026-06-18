# lemony 백엔드 (Kotlin / Spring Boot)

lemony 플랫폼의 백엔드 — API·인증·사이트·프리뷰. **프론트는 React, 백은 Kotlin** 구조.

## 패키지 레이어링 (flowstock 컨벤션 참조)
`dev.lemony.{domain.<기능>.{controller,service}, global.{response,config,security}, infra.ai}` — flowstock-backend(`com.flowstock.*`)와 동일 패턴.
- `domain/site/controller/SiteController` · `global/response/ApiResponse` · `infra/ai/AgentService`
- Dockerfile(temurin 21-jre, prebuilt jar) · infra(`../../infra`: k8s/terraform/scripts/docs)도 flowstock 참조.

## 역할 분담
- **Kotlin/Spring (여기)**: API, 인증(추후 OAuth2 GitHub/Google), 사이트 영속/목록, 프리뷰 서빙, orchestration.
- **Node 에이전트 도구**: `claude` CLI(키 없이 LLM) + `Quarkify`(코드 토폴로지). Kotlin 이 `ProcessBuilder` 로 호출(`AgentService`).
- **React 프론트(apps/web)**: 이 백엔드 API 를 호출.

## 왜 이렇게
- 단일 정적 HTML 은 프론트/백 동적 동작이 불가 → 제대로 된 풀스택.
- 생성/편집할 코드(React 프론트 + Kotlin 백)를 **Quarkify 가 그대로 그라운딩** — Kotlin·TS/React·HTML 파서가 모두 있음(검증: 이 백엔드 자신을 Quarkify 로 매핑하면 Controller=web_endpoint, Service=business_logic 로 분류됨).

## 엔드포인트
- `POST /api/create {prompt}` → 사이트 생성 → `{id, previewUrl}`
- `POST /api/edit {id, prompt}` → 자연어 수정
- `GET /api/sites` → 내 사이트 목록
- `GET /preview/{id}/**` → 생성 사이트 프리뷰
- `GET /api/auth/me` → 현재 사용자(추후 OAuth2)

## 실행 (Kotlin 툴체인 필요 — flowstock 과 동일)
```bash
cd services/backend
./gradlew bootRun        # :8787
```
환경: `LEMONY_SITES`(사이트 루트), `QUARKIFY_PATH`(quarkify.mjs).

## 남은 작업 (Node 서버에서 포팅)
인증(OAuth2), 이미지 RAG(도메인 이해), Quarkify 섹션단위 그라운딩 편집(/edit-loop), 사이트 영속(DB). 현재는 Node 에이전트 서버(`services/agent`)가 이 기능들을 갖춘 인터림 백엔드.
