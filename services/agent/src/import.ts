import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateConfig, quarkifyRun, loadSymbolMeta } from './quarkify.ts';

// 기존 프로젝트 import 파이프라인:
//   소스(깃 URL/로컬) → 스택 감지 → Quarkify 매핑 → "이해 요약" 생성 → 편집 루프 준비.
// 비전공자가 이미 만든 블로그/사이트를 lemony 로 가져와 이어서 작업하게 하는 진입점.

type Stack = { language: string; framework: string; sourceFiles: string[] };

function has(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name));
}

function anyFile(dir: string, ext: string, max = 4000): boolean {
  let found = false, seen = 0;
  const skip = new Set(['node_modules', '.git', 'build', 'dist', '.venv', 'venv', 'target', '.next']);
  const walk = (d: string) => {
    if (found || seen > max) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found) return;
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(d, e.name)); }
      else { seen++; if (e.name.endsWith(ext)) { found = true; return; } }
    }
  };
  walk(dir);
  return found;
}

// 스택 감지 (마커 파일 + 확장자 존재로 추론)
export function detectStack(dir: string): Stack {
  if (has(dir, 'build.gradle') || has(dir, 'build.gradle.kts') || has(dir, 'pom.xml')) {
    if (anyFile(dir, '.kt')) return { language: 'Kotlin', framework: 'JVM/Spring', sourceFiles: ['**/src/main/**/*.kt'] };
    return { language: 'Java', framework: 'JVM/Spring', sourceFiles: ['**/src/main/**/*.java'] };
  }
  if (has(dir, 'Cargo.toml')) return { language: 'Rust', framework: 'Cargo', sourceFiles: ['src/**/*.rs'] };
  if (has(dir, 'go.mod')) return { language: 'Go', framework: 'Go modules', sourceFiles: ['**/*.go'] };
  if (has(dir, 'requirements.txt') || has(dir, 'pyproject.toml') || has(dir, 'setup.py')) {
    const sub = has(dir, 'app') ? 'app/**/*.py' : '**/*.py';
    return { language: 'Python', framework: 'Python', sourceFiles: [sub] };
  }
  if (has(dir, 'package.json')) {
    const ts = has(dir, 'tsconfig.json') || anyFile(dir, '.ts');
    const sf = ts ? ['src/**/*.ts', 'src/**/*.tsx'] : ['src/**/*.js', 'src/**/*.jsx'];
    let framework = 'Node/JS';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.next) framework = 'Next.js';
      else if (deps.react) framework = 'React';
      else if (deps.vue) framework = 'Vue';
      else if (deps['@angular/core']) framework = 'Angular';
    } catch {}
    return { language: ts ? 'TypeScript' : 'JavaScript', framework, sourceFiles: sf };
  }
  // 폴백: 흔한 확장자 전체 스캔
  return { language: 'mixed', framework: 'unknown', sourceFiles: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.py', '**/*.kt', '**/*.java', '**/*.go', '**/*.rs'] };
}

function isGit(src: string): boolean {
  return /^(https?:\/\/|git@)/.test(src) || src.endsWith('.git');
}

type ImportResult = {
  name: string; srcDir: string; mapDir: string; stack: Stack;
  summary: { files: number; symbols: number; byRole: Record<string, number>; byKind: Record<string, number>; entryPoints: string[] };
  summaryPath: string;
};

// 메인 파이프라인
export function importProject(source: string, opts: { workDir?: string } = {}): ImportResult {
  const workDir = opts.workDir || path.join(os.tmpdir(), 'lemony-imports');
  fs.mkdirSync(workDir, { recursive: true });

  // 1) 소스 확보 (깃이면 clone, 아니면 로컬 경로)
  let srcDir: string;
  let name: string;
  if (isGit(source)) {
    name = (source.split('/').pop() || 'repo').replace(/\.git$/, '');
    srcDir = path.join(workDir, name);
    if (!fs.existsSync(srcDir)) {
      console.log(`📥 clone: ${source}`);
      execFileSync('git', ['clone', '--depth', '1', source, srcDir], { stdio: 'inherit' });
    } else {
      console.log(`📁 기존 클론 재사용: ${srcDir}`);
    }
  } else {
    srcDir = path.resolve(source);
    name = path.basename(srcDir);
    if (!fs.existsSync(srcDir)) throw new Error(`소스 경로가 없습니다: ${srcDir}`);
  }

  // 2) 스택 감지
  const stack = detectStack(srcDir);
  console.log(`🔎 스택 감지: ${stack.language} (${stack.framework})`);

  // 3) Quarkify 매핑
  const mapDir = path.join(workDir, `${name}-quarkmap`);
  const configPath = path.join(workDir, `${name}.config.mjs`);
  generateConfig({ name, srcDir, outDir: mapDir, sourceFiles: stack.sourceFiles, configPath, incremental: true });
  console.log('🧭 Quarkify 매핑 중...');
  quarkifyRun(configPath, { quiet: true });

  // 4) 이해 요약 (quark_meta 집계)
  const meta = loadSymbolMeta(mapDir);
  const byRole: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const files = new Set<string>();
  for (const s of meta.symbols) {
    byRole[s.role] = (byRole[s.role] || 0) + 1;
    byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    if (s.file) files.add(s.file);
  }
  const entryPoints = meta.symbols
    .filter((s: any) => s.role === 'web_endpoint')
    .slice(0, 20)
    .map((s: any) => `${s.name}  (${s.file}:${s.startLine || '?'})`);

  const summary = { files: files.size, symbols: meta.count, byRole, byKind, entryPoints };

  // 5) 사람이 읽는 요약 문서
  let md = `# 📦 Import 이해 요약 — ${name}\n\n`;
  md += `- 스택: **${stack.language}** (${stack.framework})\n`;
  md += `- 소스: \`${srcDir}\`\n- 코드맵: \`${mapDir}\`\n`;
  md += `- 파일 ${summary.files} · 심볼 ${summary.symbols}\n\n`;
  md += `## 역할 분포\n${Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n`;
  md += `## 종류 분포\n${Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n`;
  md += `## 진입점 (웹 엔드포인트)\n${entryPoints.length ? entryPoints.map((e) => `- ${e}`).join('\n') : '- (감지된 엔드포인트 없음)'}\n\n`;
  md += `## 다음 단계\n- 이 코드맵(\`quark_meta.json\`/콜그래프) 위에서 lemony 에이전트가 자연어 편집을 정확히 타겟팅\n- 큰 변경 전 \`--solve\` 로 관련 심볼/영향범위 확인\n`;
  const summaryPath = path.join(mapDir, 'IMPORT_SUMMARY.md');
  fs.writeFileSync(summaryPath, md, 'utf-8');

  return { name, srcDir, mapDir, stack, summary, summaryPath };
}

// CLI: node --experimental-strip-types src/import.ts <git-url|local-path> [workDir]
const invokedDirect = process.argv[1] && process.argv[1].endsWith('import.ts');
if (invokedDirect) {
  const source = process.argv[2];
  if (!source) {
    console.error('사용법: node --experimental-strip-types src/import.ts <git-url|local-path> [workDir]');
    process.exit(1);
  }
  try {
    const r = importProject(source, { workDir: process.argv[3] });
    console.log('\n=============================================');
    console.log(' 🎉 Import 완료!');
    console.log('=============================================');
    console.log(` 📦 ${r.name} — ${r.stack.language} (${r.stack.framework})`);
    console.log(` 📄 파일 ${r.summary.files} · 심볼 ${r.summary.symbols}`);
    console.log(` 🎯 진입점 ${r.summary.entryPoints.length}개`);
    console.log(` 📝 요약: ${r.summaryPath}`);
    console.log(` 🧭 코드맵: ${r.mapDir}`);
    console.log('=============================================\n');
  } catch (err: any) {
    console.error('❌ import 실패:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
