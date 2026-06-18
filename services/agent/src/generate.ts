import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ingestAssets, retrieve, assetSpecBlock, imagePaths, saveAssets } from './domain.ts';

// 웹사이트 생성 엔진 — 비전공자의 한국어 요청 → 완성된 단일 파일 사이트(index.html).
// LLM 백엔드: 로그인된 claude CLI(헤드리스). 별도 API 키 불필요.
// 단일 HTML 이라 빌드/번들 없이 즉시 프리뷰 가능 → 마찰 최소.

const GEN_SYSTEM = `당신은 lemony의 웹사이트 생성 엔진입니다. 비전공자의 한국어 요청을 받아 완성된 단일 파일 웹페이지를 만듭니다.
규칙:
- 완전한 자기완결 HTML 문서 하나만 출력합니다 (인라인 <style> + 필요한 최소 인라인 <script>). 외부 빌드/번들/CDN 의존 없이 그대로 열려야 합니다.
- 반응형(모바일 포함), 시맨틱 마크업, 한국어 콘텐츠. 헤더/히어로/핵심 섹션 2~4개/푸터 + 그럴듯한 더미 콘텐츠를 채웁니다.
- 디자인: 진부한 "AI 느낌"(보라 그라데이션, Inter/Arial/system 기본 폰트, 천편일률 카드 레이아웃) 금지. 주제에 어울리는 고유한 색팔레트·타이포·여백·약간의 마이크로 인터랙션을 사용합니다.
- **정적 브로슈어가 아니라 실제로 동작하는 페이지**를 만듭니다. 요청에 맞게 인터랙션을 인라인 <script> 로 실제 구현하세요:
  · 폼(문의/신청/예약 등)은 제출 시 검증 + 화면 피드백 + 입력값을 localStorage 에 저장/복원하여 실제로 "받는" 동작을 합니다.
  · 목록/방명록/할일 등은 입력→추가→localStorage 영속→삭제까지 동작합니다.
  · 파일 업로드가 어울리면 <input type="file"> + 미리보기(FileReader)를 구현합니다.
  · 탭/토글/필터/카운터/모달 등 필요한 동적 UI는 동작하도록 JS 로 구현합니다.
  외부 서버가 없으므로 모든 처리는 클라이언트(브라우저)에서 완결합니다. 더미 백엔드/가짜 fetch 금지 — 실제로 동작하는 것만.
- 설명/마크다운/코드펜스 없이 HTML 문서만 출력합니다. 반드시 <!DOCTYPE html> 로 시작합니다.`;

function stripFence(t: string): string {
  const m = t.match(/```(?:html)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

function runClaude(prompt: string): string {
  // 도구 사용 금지(파일 쓰기/편집/Bash) — headless claude 가 Write 로 파일을 만들려다
  // 권한에 막혀 HTML 대신 안내문을 뱉는 것을 방지. 결과는 stdout 으로만.
  const guarded = prompt + '\n\n[중요] 어떤 도구(Write/Edit/Bash/Read 등)도 사용하지 말 것. 파일을 만들지 말고, 결과 HTML 전문만 응답 텍스트로 그대로 출력하라.';
  return execFileSync('claude', ['-p', guarded, '--disallowedTools', 'Write,Edit,Bash,Read,Glob,Grep', '--output-format', 'text'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// 자연어 → 완성 HTML 문자열. domainBlock 이 있으면 도메인(이미지 RAG) 그라운딩을 주입.
export function generateHtml(prompt: string, domainBlock = ''): string {
  let html = stripFence(runClaude(`${GEN_SYSTEM}\n${domainBlock}\n사용자 요청:\n${prompt}\n\n위 요청에 맞는 완성된 index.html 한 개를 출력하세요.`));
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

// 새 사이트 워크스페이스 생성 (index.html 작성). domainBlock 으로 도메인 그라운딩 가능.
export function createSite(prompt: string, baseDir: string, domainBlock = ''): { id: string; dir: string; file: string } {
  const id = 'site_' + Date.now().toString(36);
  const dir = path.join(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, generateHtml(prompt, domainBlock), 'utf8');
  return { id, dir, file };
}

// ── 멀티모달 RAG 생성: 추출 사양 + 원본 이미지(ground-truth) 를 함께 넣어 생성 ──
function runClaudeMultimodal(prompt: string): string {
  // 이미지 ground-truth 를 위해 Read 만 허용, 파일 쓰기/실행은 금지(안내문 뱉기 방지)
  return execFileSync('claude', ['-p', prompt, '--disallowedTools', 'Write,Edit,Bash,Glob,Grep', '--output-format', 'text'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function generateFromAssets(prompt: string, assets: any[]): string {
  const block = assetSpecBlock(assets);
  const imgs = imagePaths(assets);
  const groundTruth = imgs.length
    ? `\n원본 이미지(시각적 ground-truth — 사양보다 항상 우선). Read 도구로 다음 파일을 열어 색/타이포/레이아웃/카피를 직접 확인해 반영하라:\n${imgs.map((p) => '- ' + p).join('\n')}\n`
    : '';
  const PRINCIPLES = `\n[원칙] 자산의 색·타이포·레이아웃·카피를 충실히 재현(임의 AI 기본스타일 금지). 이미지 속 카피는 그대로 사용. 자산이 여러 개면 purpose 로 섹션 통합. 비동기 생성이므로 멈춰 되묻지 말고 일단 동작하는 결과를 내라.`;
  const full = `${GEN_SYSTEM}${PRINCIPLES}${block}${groundTruth}\n사용자 요청:\n${prompt}\n\nHTML 전문만 출력(파일 쓰지 말 것).`;
  let html = stripFence(runClaudeMultimodal(full));
  if (!/<!doctype|<html/i.test(html)) html = `<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${html}\n</body></html>`;
  return html;
}

export function createSiteFromAssets(prompt: string, baseDir: string, assets: any[]): { id: string; dir: string; file: string } {
  const id = 'site_' + Date.now().toString(36);
  const dir = path.join(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, generateFromAssets(prompt, assets), 'utf8');
  return { id, dir, file };
}

// CLI:
//   생성: node --experimental-strip-types src/generate.ts "<사이트 설명>" [outDir]
//   수정: node --experimental-strip-types src/generate.ts --edit <siteDir> "<수정 요청>"
const invokedDirect = process.argv[1] && process.argv[1].endsWith('generate.ts');
if (invokedDirect) {
  if (process.argv[2] === '--edit') {
    const siteDir = process.argv[3];
    const instruction = process.argv[4];
    if (!siteDir || !instruction) { console.error('사용법: ... --edit <siteDir> "<수정 요청>"'); process.exit(1); }
    const file = path.join(path.resolve(siteDir), 'index.html');
    if (!fs.existsSync(file)) { console.error(`❌ index.html 없음: ${file}`); process.exit(1); }
    const before = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file + '.prev', before, 'utf-8'); // 변경 전 백업(diff 용)
    console.log(`✏️  수정 중 (claude CLI): "${instruction}"`);
    const after = editHtml(before, instruction);
    fs.writeFileSync(file, after, 'utf-8');
    console.log(`✅ 수정 완료: ${file} (${(before.length / 1024).toFixed(1)}→${(after.length / 1024).toFixed(1)} KB)`);
    console.log(`   diff: diff "${file}.prev" "${file}"  |  열기: open "${file}"`);
  } else if (process.argv[2] === '--domain') {
    // 멀티모달 RAG: --domain <img1,doc1,...> "<사이트 설명>" [outDir]
    const paths = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const prompt = process.argv[4];
    if (!paths.length || !prompt) { console.error('사용법: ... --domain <img1,doc1,...> "<사이트 설명>" [outDir]'); process.exit(1); }
    console.log(`🖼  자산 분석/인덱싱 중 (${paths.length}개, 멀티모달 RAG)...`);
    const assets = ingestAssets(paths);
    for (const a of assets) console.log(`   [${a.type}] ${a.purpose || ''} — ${a.summary}`);
    const relevant = retrieve(assets, prompt);
    const base = process.argv[5] ? path.resolve(process.argv[5]) : path.join(process.cwd(), 'lemony-sites');
    console.log(`🍋 자산 그라운딩 생성 중 (사양 + 원본이미지 ${relevant.filter((a) => a.type === 'image').length}장)...`);
    const site = createSiteFromAssets(prompt, base, relevant);
    saveAssets(assets, path.join(site.dir, 'assets.json'));
    console.log(`✅ 생성 완료: ${site.file} (${(fs.statSync(site.file).size / 1024).toFixed(1)} KB)`);
    console.log(`   브라우저로 열기: open "${site.file}"`);
  } else {
    const prompt = process.argv[2];
    if (!prompt) { console.error('사용법: node --experimental-strip-types src/generate.ts "<사이트 설명>" [outDir]'); process.exit(1); }
    const base = process.argv[3] ? path.resolve(process.argv[3]) : path.join(process.cwd(), 'lemony-sites');
    console.log('🍋 사이트 생성 중 (claude CLI)...');
    const site = createSite(prompt, base);
    console.log(`✅ 생성 완료: ${site.file} (${(fs.statSync(site.file).size / 1024).toFixed(1)} KB)`);
    console.log(`   브라우저로 열기: open "${site.file}"`);
  }
}
