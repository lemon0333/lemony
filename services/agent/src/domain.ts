import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// 이미지 RAG — 도메인 이해 엔진.
// 사용자가 준 이미지(브랜드 로고/제품 사진/레퍼런스 UI 등)를 Claude 비전으로 분석해
// "도메인 프로필"(팔레트·스타일·실제 콘텐츠 단서)을 추출하고, 생성/수정 시 이를 그라운딩한다.
// 키 불필요: 로그인된 claude CLI 를 헤드리스(-p, --allowedTools Read)로 사용.

export interface DomainProfile {
  domain: string;            // 이 브랜드/제품/주제 요약
  palette: string[];         // 대표 색 (hex)
  style: string[];           // 스타일 키워드
  content: string[];         // 이미지에서 읽은 실제 텍스트/메뉴/제품명 등
  cards: Array<{ file: string; desc: string }>;
}

function parseJson(text: string): any {
  let t = (text || '').trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) t = f[1].trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
}

const INGEST_SYSTEM = `당신은 lemony의 도메인 이해 엔진입니다. 사용자가 제공한 이미지들(브랜드/제품/레퍼런스)을 Read 도구로 모두 열어 분석한 뒤, 웹사이트 생성에 활용할 "도메인 프로필"을 JSON 으로만 출력합니다.
형식: {"domain": "이 브랜드/제품/주제가 무엇인지 한두 문장", "palette": ["#hex", ...대표색 3~6개], "style": ["스타일 키워드", ...], "content": ["이미지에서 읽은 실제 텍스트/메뉴/제품명/슬로건", ...], "cards": [{"file": "경로", "desc": "이 이미지가 무엇인지 한 줄"}]}
마크다운/설명 없이 JSON 객체 하나만 출력하세요.`;

export function ingestImages(imagePaths: string[]): DomainProfile {
  const refs = imagePaths.map((p) => `- ${p}`).join('\n');
  const prompt = `${INGEST_SYSTEM}\n\n분석할 이미지 파일:\n${refs}\n\n각 파일을 Read 도구로 열어 본 뒤, 위 형식의 JSON 도메인 프로필을 출력하세요.`;
  const out = execFileSync('claude', ['-p', prompt, '--allowedTools', 'Read', '--output-format', 'text'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const p = parseJson(out) || {};
  return {
    domain: p.domain || '', palette: p.palette || [], style: p.style || [],
    content: p.content || [], cards: p.cards || [],
  };
}

// 생성 프롬프트에 주입할 도메인 그라운딩 블록
export function domainPromptBlock(profile: DomainProfile | null): string {
  if (!profile || (!profile.domain && !profile.palette.length)) return '';
  return `\n=== 사용자 도메인 프로필 (제공 이미지 분석 결과 — 이 정보를 반드시 반영해 디자인·콘텐츠를 그라운딩하라) ===
도메인: ${profile.domain}
대표 팔레트(이 색들을 실제 사용): ${profile.palette.join(', ')}
스타일: ${profile.style.join(', ')}
이미지에서 읽은 실제 콘텐츠(가능하면 그대로 사용): ${profile.content.join(' · ')}
`;
}

export function saveProfile(profile: DomainProfile, file: string) {
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf-8');
}
