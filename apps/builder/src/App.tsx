import React, { useState } from 'react';

// 빌더 UI: 좌측 한국어 프롬프트 입력 → services/agent(/edit) 호출 → 결과 표시.
// 에이전트가 Quarkify 맵으로 정확히 타겟팅해 수정한 파일/요약을 돌려준다.
// TODO: 우측 iframe 에 생성된 사이트 dev 서버 프리뷰 연결, 편집 히스토리, 발행 버튼, import 진입점.

const AGENT_URL = (import.meta as any).env?.VITE_AGENT_URL || 'http://localhost:8787';

interface EditResult {
  dryRun?: boolean; refused?: boolean; summary?: string;
  applied?: string[]; failed?: any[]; targets?: string[]; error?: string;
}

export function App() {
  // 데모 단계에선 편집 대상 프로젝트 경로를 입력받는다 (추후 세션/워크스페이스로 대체).
  const [projectDir, setProjectDir] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);

  async function onSubmit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AGENT_URL}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir, prompt }),
      });
      setResult(await res.json());
    } catch (err: any) {
      setResult({ error: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <aside style={{ width: 420, padding: 16, borderRight: '1px solid #eee', overflow: 'auto' }}>
        <h1>lemony 🍋</h1>
        <p style={{ color: '#666', fontSize: 13 }}>만들고 싶은 걸 한국어로 적어주세요.</p>
        <input value={projectDir} onChange={(e) => setProjectDir(e.target.value)}
          placeholder="편집할 프로젝트 경로 (예: /path/to/my-site)"
          style={{ width: '100%', marginBottom: 8 }} />
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 메인 버튼 색을 초록으로 바꾸고 글씨를 키워줘"
          style={{ width: '100%', height: 110 }} />
        <button onClick={onSubmit} disabled={busy || !projectDir || !prompt} style={{ marginTop: 8 }}>
          {busy ? '작업 중…' : '수정하기'}
        </button>

        {result && (
          <div style={{ marginTop: 16, fontSize: 13 }}>
            {result.error && <p style={{ color: 'crimson' }}>에러: {result.error}</p>}
            {result.dryRun && <p style={{ color: '#b45309' }}>⚠️ DRY RUN (ANTHROPIC_API_KEY 설정 시 실제 수정)</p>}
            {result.summary && <p><b>요약:</b> {result.summary}</p>}
            {result.targets?.length ? <p><b>타겟:</b> {result.targets.join(', ')}</p> : null}
            {result.applied?.length ? <p style={{ color: 'green' }}><b>적용:</b> {result.applied.join(', ')}</p> : null}
            {result.failed?.length ? <p style={{ color: '#b45309' }}><b>미적용:</b> {result.failed.length}개</p> : null}
          </div>
        )}
      </aside>
      <main style={{ flex: 1 }}>
        {/* TODO: 생성된 사이트 dev 서버를 iframe 으로 프리뷰 */}
        <iframe title="preview" style={{ width: '100%', height: '100%', border: 0 }} />
      </main>
    </div>
  );
}
