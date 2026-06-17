// lemony 에이전트 오케스트레이터 (골격)
// 파이프라인: 자연어 요청 → Quarkify 맵 조회 → 수정 타겟 결정 → LLM 패치 → 적용 → 재인덱싱
// TODO: 각 단계 구현. 핵심은 "추측 금지" — 항상 quark_meta/콜그래프로 위치/영향 확정 후 수정.

interface EditRequest { projectDir: string; prompt: string; }

export async function handleEdit(req: EditRequest) {
  // 1) Quarkify 코드맵 확보 (quarkifyRun / collapse)
  // 2) prompt 의도 → 후보 심볼/파일 타겟팅 (quark_meta.json, _mirror/by_role)
  // 3) 영향 범위 안전 판단 (콜그래프 resolves_to__)
  // 4) LLM 으로 패치 생성 (Claude) — file:line 컨텍스트만 주입(토큰 절약)
  // 5) 적용 → 증분 재인덱싱 → 프리뷰 갱신 → 성공/실패 리포트
  console.log('TODO: handleEdit', req.prompt);
}

// TODO: HTTP 서버(예: builder UI 와 통신), 세션/히스토리, 발행 트리거
