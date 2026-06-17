import React, { useState } from 'react';

// 빌더 UI 골격: 좌측 한국어 프롬프트 입력 → 우측 실시간 프리뷰(iframe).
// TODO: services/agent 에 요청 전송 → 수정 결과를 프리뷰에 반영
// TODO: 채팅형 편집 히스토리, 발행 버튼, 기존 프로젝트 import 진입점
export function App() {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    // TODO: POST /agent/edit { prompt } → Quarkify 맵 기반으로 정확히 수정
    console.log('TODO: send to agent →', prompt);
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <aside style={{ width: 380, padding: 16, borderRight: '1px solid #eee' }}>
        <h1>lemony 🍋</h1>
        <p style={{ color: '#666', fontSize: 13 }}>만들고 싶은 걸 한국어로 적어주세요.</p>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 카페 소개 페이지 만들어줘. 메뉴랑 위치 지도도."
          style={{ width: '100%', height: 120 }} />
        <button onClick={onSubmit} disabled={busy} style={{ marginTop: 8 }}>
          {busy ? '작업 중…' : '만들기 / 수정하기'}
        </button>
      </aside>
      <main style={{ flex: 1 }}>
        {/* TODO: 생성된 사이트 dev 서버를 iframe 으로 프리뷰 */}
        <iframe title="preview" style={{ width: '100%', height: '100%', border: 0 }} />
      </main>
    </div>
  );
}
