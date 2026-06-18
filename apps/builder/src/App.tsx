import React, { useState } from 'react';

// 빌더 UI — 비전공자 플로우: 한국어로 "만들기" → 에이전트가 사이트 생성 → 우측 iframe 즉시 프리뷰 → 자연어로 "수정".
// 경로/설정 입력 없음. 에이전트가 워크스페이스를 자동 관리한다.

const AGENT = (import.meta as any).env?.VITE_AGENT_URL || 'http://localhost:8787';

export function App() {
  const [prompt, setPrompt] = useState('');
  const [siteId, setSiteId] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run() {
    if (!prompt.trim()) return;
    setBusy(true); setErr('');
    try {
      const isEdit = !!siteId;
      const res = await fetch(`${AGENT}${isEdit ? '/edit-site' : '/create'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: siteId, prompt } : { prompt }),
      });
      const data = await res.json();
      if (data.error) { setErr(data.error); return; }
      setSiteId(data.id);
      setSrc(`${AGENT}${data.previewUrl}?t=${Date.now()}`); // 캐시버스터로 프리뷰 갱신
      setPrompt('');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside style={{ width: 360, padding: 20, borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0 }}>lemony 🍋</h1>
        <p style={{ color: '#666', fontSize: 13, margin: 0 }}>
          {siteId ? '바꾸고 싶은 걸 말해보세요.' : '만들고 싶은 웹사이트를 한국어로 적어주세요.'}
        </p>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={siteId ? '예: 버튼을 더 크게, 색은 초록으로' : '예: 동네 빵집 소개 페이지. 메뉴랑 영업시간, 오시는 길.'}
          style={{ width: '100%', height: 120, padding: 8 }} />
        <button onClick={run} disabled={busy || !prompt.trim()} style={{ padding: '10px', fontSize: 15, cursor: 'pointer' }}>
          {busy ? '작업 중…' : siteId ? '수정하기' : '만들기'}
        </button>
        {siteId && <button onClick={() => { setSiteId(null); setSrc(''); }} style={{ padding: '6px', fontSize: 12 }}>새 사이트</button>}
        {err && <p style={{ color: 'crimson', fontSize: 13 }}>에러: {err}</p>}
        <p style={{ color: '#aaa', fontSize: 11, marginTop: 'auto' }}>생성/수정은 로그인된 Claude 로 동작 (별도 API 키 불필요)</p>
      </aside>
      <main style={{ flex: 1, background: '#fafafa' }}>
        {src
          ? <iframe title="preview" src={src} style={{ width: '100%', height: '100%', border: 0 }} />
          : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#bbb' }}>여기에 미리보기가 나타납니다</div>}
      </main>
    </div>
  );
}
