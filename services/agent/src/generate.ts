import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 웹사이트 생성 엔진 — 비전공자의 한국어 요청 → 완성된 단일 파일 사이트(index.html).
// LLM 백엔드: 로그인된 claude CLI(헤드리스). 별도 API 키 불필요.
// 단일 HTML 이라 빌드/번들 없이 즉시 프리뷰 가능 → 마찰 최소.

const GEN_SYSTEM = `당신은 lemony의 웹사이트 생성 엔진입니다. 비전공자의 한국어 요청을 받아 완성된 단일 파일 웹페이지를 만듭니다.
규칙:
- 완전한 자기완결 HTML 문서 하나만 출력합니다 (인라인 <style> + 필요한 최소 인라인 <script>). 외부 빌드/번들/CDN 의존 없이 그대로 열려야 합니다.
- 반응형(모바일 포함), 시맨틱 마크업, 한국어 콘텐츠. 헤더/히어로/핵심 섹션 2~4개/푸터 + 그럴듯한 더미 콘텐츠를 채웁니다.
- 디자인: 진부한 "AI 느낌"(보라 그라데이션, Inter/Arial/system 기본 폰트, 천편일률 카드 레이아웃) 금지. 주제에 어울리는 고유한 색팔레트·타이포·여백·약간의 마이크로 인터랙션을 사용합니다.
- 설명/마크다운/코드펜스 없이 HTML 문서만 출력합니다. 반드시 <!DOCTYPE html> 로 시작합니다.`;

function stripFence(t: string): string {
  const m = t.match(/```(?:html)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

function runClaude(prompt: string): string {
  return execFileSync('claude', ['-p', prompt, '--output-format', 'text'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// 자연어 → 완성 HTML 문자열
export function generateHtml(prompt: string): string {
  let html = stripFence(runClaude(`${GEN_SYSTEM}\n\n사용자 요청:\n${prompt}\n\n위 요청에 맞는 완성된 index.html 한 개를 출력하세요.`));
  if (!/<!doctype|<html/i.test(html)) html = `<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${html}\n</body></html>`;
  return html;
}

// 기존 단일 HTML 사이트를 자연어로 수정 → 새 HTML (통째 재작성, 단일 파일이라 단순/안정)
export function editHtml(current: string, prompt: string): string {
  const full = `${GEN_SYSTEM}\n\n아래는 현재 사이트의 index.html 전체입니다. 사용자의 수정 요청을 반영한 *전체* HTML 을 다시 출력하세요. 요청과 무관한 부분은 그대로 유지합니다.\n\n=== 현재 index.html ===\n${current}\n\n=== 수정 요청 ===\n${prompt}\n\n수정된 index.html 전체를 출력하세요.`;
  let html = stripFence(runClaude(full));
  if (!/<!doctype|<html/i.test(html)) html = current; // 안전: 형식 이상하면 원본 유지
  return html;
}

// 새 사이트 워크스페이스 생성 (index.html 작성)
export function createSite(prompt: string, baseDir: string): { id: string; dir: string; file: string } {
  const id = 'site_' + Date.now().toString(36);
  const dir = path.join(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, generateHtml(prompt), 'utf8');
  return { id, dir, file };
}

// CLI: node --experimental-strip-types src/generate.ts "<만들고 싶은 사이트>" [outDir]
const invokedDirect = process.argv[1] && process.argv[1].endsWith('generate.ts');
if (invokedDirect) {
  const prompt = process.argv[2];
  if (!prompt) { console.error('사용법: node --experimental-strip-types src/generate.ts "<사이트 설명>" [outDir]'); process.exit(1); }
  const base = process.argv[3] ? path.resolve(process.argv[3]) : path.join(process.cwd(), 'lemony-sites');
  console.log('🍋 사이트 생성 중 (claude CLI)...');
  const site = createSite(prompt, base);
  const bytes = fs.statSync(site.file).size;
  console.log(`✅ 생성 완료: ${site.file} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`   브라우저로 열기: open "${site.file}"`);
}
