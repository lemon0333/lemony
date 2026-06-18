import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 멀티모달 RAG — lemony 의 키 밸류: "이미지/문서를 넣으면 알아서 사이트".
// 핵심: 이미지는 임베딩이 안 되므로 비전으로 "디자인 사양(spec)"을 추출해 인덱싱하고,
// 생성 시 [추출 사양 + 원본 이미지(ground-truth)] 를 함께 멀티모달로 넣는다(2단계).
// 키 불필요: 로그인된 claude CLI 헤드리스(-p, --allowedTools Read) 사용.

export interface Asset {
  type: 'image' | 'doc';
  path: string;
  summary: string;       // 검색용 2~3문장 요약
  purpose?: string;      // hero/nav/pricing/brand ...
  spec?: any;            // 이미지: 구조화 디자인 사양 JSON
  text?: string;         // 문서: 본문(청크)
}

function parseJson(t: string): any {
  let s = (t || '').trim();
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) s = f[1].trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

const ANALYZE_SYSTEM = `당신은 디자인 자산을 웹 구현용 사양으로 변환하는 분석가입니다. 주어진 이미지(스크린샷·목업·로고·슬라이드 등)를 Read 도구로 열어 본 뒤, 추측이 아니라 "이미지에서 실제로 관찰되는 것"만 기록합니다. 보이지 않는 값은 null.
추출: asset_type(screenshot_ui|mockup|logo|photo|slide|diagram|other), purpose(사이트의 어느 부분: hero/nav/pricing/brand...), summary(검색용 2~3문장), palette{bg,primary,accent,text,approx}, typography{family(serif|sans|mono|display),weights,scale}, layout(자연어+구조 배열), components[](button,card,navbar,form...), copy(이미지 속 텍스트 그대로 transcription), mood[](미니멀/따뜻함/핀테크/에디토리얼...), implementation_notes.
JSON 객체 하나만 출력(마크다운 금지).`;

// 이미지 1장 → 풍부한 디자인 사양
export function analyzeImage(imgPath: string): Asset {
  const prompt = `${ANALYZE_SYSTEM}\n\n분석할 이미지: ${imgPath}\nRead 도구로 열어 위 형식의 JSON 을 출력하세요.`;
  const out = execFileSync('claude', ['-p', prompt, '--allowedTools', 'Read', '--output-format', 'text'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = parseJson(out) || {};
  return { type: 'image', path: imgPath, summary: j.summary || '', purpose: j.purpose || '', spec: j };
}

// 문서(md/txt) → 요약 + 본문 (비전 불필요)
export function ingestDoc(docPath: string): Asset {
  const text = fs.readFileSync(docPath, 'utf-8');
  const firstHeading = (text.match(/^#+\s*(.+)$/m)?.[1] || text.split('\n').find((l) => l.trim()) || '').slice(0, 80);
  return { type: 'doc', path: docPath, summary: firstHeading, text: text.slice(0, 8000) };
}

// 혼합 자산 인제스트 (이미지 + 문서)
export function ingestAssets(paths: string[]): Asset[] {
  const out: Asset[] = [];
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    try {
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) out.push(analyzeImage(p));
      else if (['.md', '.txt'].includes(ext)) out.push(ingestDoc(p));
      // pptx 등은 추후(python-pptx + 슬라이드 렌더)
    } catch (e) { /* skip 실패 자산 */ }
  }
  return out;
}

// 검색: 의도(prompt)와 관련된 자산 top-k (자산 적으면 전부)
export function retrieve(assets: Asset[], prompt: string, k = 8): Asset[] {
  if (assets.length <= k) return assets;
  const toks = prompt.toLowerCase().split(/[^a-z0-9가-힣]+/).filter((t) => t.length >= 2);
  const score = (a: Asset) => {
    const hay = `${a.summary} ${a.purpose} ${JSON.stringify(a.spec || '')} ${a.text || ''}`.toLowerCase();
    return toks.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
  };
  return [...assets].sort((x, y) => score(y) - score(x)).slice(0, k);
}

// 생성 프롬프트에 주입할 자산 사양 블록
export function assetSpecBlock(assets: Asset[]): string {
  if (!assets.length) return '';
  let s = '\n=== 디자인 자산 사양 (이미지에서 추출 / 문서) — 색·타이포·레이아웃·카피를 충실히 반영하라 ===\n';
  assets.forEach((a, i) => {
    if (a.type === 'image') {
      const sp = a.spec || {};
      s += `[이미지 ${i + 1}] purpose=${a.purpose} | ${a.summary}\n  palette=${JSON.stringify(sp.palette || {})} typo=${JSON.stringify(sp.typography || {})} components=${JSON.stringify(sp.components || [])}\n  copy=${JSON.stringify(sp.copy || '')} mood=${JSON.stringify(sp.mood || [])}\n`;
    } else {
      s += `[문서 ${i + 1}] ${a.summary}\n  내용: ${(a.text || '').slice(0, 1200)}\n`;
    }
  });
  return s;
}

// 생성 시 ground-truth 로 Read 할 원본 이미지 경로
export function imagePaths(assets: Asset[]): string[] {
  return assets.filter((a) => a.type === 'image').map((a) => a.path);
}

export function saveAssets(assets: Asset[], file: string) {
  fs.writeFileSync(file, JSON.stringify(assets, null, 2), 'utf-8');
}
