import fs from 'node:fs';
import path from 'node:path';
import { generateConfig, quarkifyRun, solve } from './quarkify.ts';
import { proposePatch } from './llm.ts';

// lemony 편집 루프: 자연어 요청 → Quarkify 맵으로 타겟팅 → LLM 패치 생성 → 적용 → 재인덱싱.
// "추측 금지"가 핵심: 항상 quark_meta/콜그래프(solve)로 위치를 확정한 뒤 그 슬라이스만 컨텍스트로 준다.

export interface EditRequest { projectDir: string; prompt: string; mapDir?: string; sourceFiles?: string[]; }

// 파일 발견은 Quarkify 의 auto 모드에 위임 (소비자가 글로브를 추측하지 않는다).
const DEFAULT_GLOBS = ['auto'];

export async function handleEdit(opts: EditRequest) {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir)) throw new Error(`프로젝트 경로가 없습니다: ${projectDir}`);
  const mapDir = opts.mapDir ? path.resolve(opts.mapDir) : path.join(projectDir, '.lemony-map');
  const configPath = path.join(mapDir, '.lemony-quarkify.config.mjs');
  fs.mkdirSync(mapDir, { recursive: true });

  // 1) 인덱싱 (증분)
  generateConfig({
    name: 'lemony-edit', srcDir: projectDir, outDir: mapDir,
    sourceFiles: opts.sourceFiles || DEFAULT_GLOBS, configPath, incremental: true,
  });
  quarkifyRun(configPath, { quiet: true });

  // 2) 요청과 관련된 심볼/파일 타겟팅 (solve_pack)
  solve(mapDir, opts.prompt);
  const packPath = path.join(mapDir, 'solve_pack.json');
  const pack = fs.existsSync(packPath) ? JSON.parse(fs.readFileSync(packPath, 'utf-8')) : { candidates: [] };
  const candidates = pack.candidates || [];

  // 3) file:line 슬라이스로 그라운딩 컨텍스트 구성
  const context = buildContext(projectDir, candidates);

  // 4) LLM 패치 생성
  const { plan, dryRun, refused } = await proposePatch({ prompt: opts.prompt, context });

  // 5) 적용 (정확한 search/replace, 미일치는 건너뛰고 보고)
  const applied: string[] = [];
  const failed: any[] = [];
  for (const e of plan.edits) {
    const abs = path.join(projectDir, e.path);
    if (!fs.existsSync(abs)) { failed.push({ path: e.path, why: '파일 없음' }); continue; }
    const cur = fs.readFileSync(abs, 'utf-8');
    if (!cur.includes(e.search)) { failed.push({ path: e.path, why: 'search 원문 미일치' }); continue; }
    fs.writeFileSync(abs, cur.replace(e.search, e.replace), 'utf-8');
    applied.push(e.path);
  }

  // 6) 변경분 재인덱싱 (증분이라 빠름)
  if (applied.length) quarkifyRun(configPath, { quiet: true });

  return {
    dryRun: !!dryRun,
    refused: !!refused,
    summary: plan.summary,
    applied,
    failed,
    targets: candidates.slice(0, 8).map((c: any) => `${c.name} (${c.file}:${c.startLine || '?'})`),
  };
}

// 후보 심볼들의 실제 소스 슬라이스를 모아 LLM 컨텍스트로 만든다 (전체 파일 X → 토큰 절약).
function buildContext(projectDir: string, candidates: any[]): string {
  let out = '';
  const seen = new Set<string>();
  for (const c of candidates.slice(0, 8)) {
    const key = `${c.file}:${c.startLine}`;
    if (!c.file || seen.has(key)) continue;
    seen.add(key);
    const abs = path.join(projectDir, c.file);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf-8').split('\n');
    const start = Math.max(0, (c.startLine || 1) - 1);
    const end = Math.min(lines.length, c.endLine || (c.startLine || 1) + 25);
    out += `\n--- ${c.file}:${start + 1}-${end}  (${c.name} / ${c.kind})\n`;
    out += lines.slice(start, end).map((l, i) => `${start + 1 + i}: ${l}`).join('\n') + '\n';
  }
  return out || '(관련 코드 슬라이스를 찾지 못했습니다. 더 구체적으로 요청해 주세요.)';
}
