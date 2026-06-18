import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { importProject } from './import.ts';
import { handleEdit } from './edit-loop.ts';

// OSS 난제 자동수정 루프 — Quarkify --solve(난제 위치/영향범위) 위에 LLM 편집 루프를 얹은 것.
// 흐름: 레포 ingest(import) → 스택 맞춰 인덱싱 → 이슈로 타겟팅+패치 → 테스트 → 리포트.
// PR 생성은 push/인증이 필요하므로 기본은 로컬 패치까지 (gh 가 있으면 안내).

const TEST_CMDS: Array<{ marker: string; cmd: string[]; label: string }> = [
  { marker: 'package.json', cmd: ['npm', 'test', '--silent'], label: 'npm test' },
  { marker: 'pyproject.toml', cmd: ['python', '-m', 'pytest', '-q'], label: 'pytest' },
  { marker: 'requirements.txt', cmd: ['python', '-m', 'pytest', '-q'], label: 'pytest' },
  { marker: 'go.mod', cmd: ['go', 'test', './...'], label: 'go test' },
  { marker: 'Cargo.toml', cmd: ['cargo', 'test'], label: 'cargo test' },
  { marker: 'build.gradle.kts', cmd: ['./gradlew', 'test'], label: 'gradle test' },
  { marker: 'build.gradle', cmd: ['./gradlew', 'test'], label: 'gradle test' },
];

function detectTest(dir: string) {
  for (const t of TEST_CMDS) if (fs.existsSync(path.join(dir, t.marker))) return t;
  return null;
}

function runTests(dir: string) {
  const t = detectTest(dir);
  if (!t) return { ran: false, label: '(테스트 명령 미탐지)', passed: null as boolean | null };
  try {
    execFileSync(t.cmd[0], t.cmd.slice(1), { cwd: dir, stdio: 'inherit' });
    return { ran: true, label: t.label, passed: true };
  } catch {
    return { ran: true, label: t.label, passed: false };
  }
}

export async function autofix(source: string, issue: string, opts: { workDir?: string } = {}) {
  console.log(`🩺 OSS 자동수정 시작\n   소스: ${source}\n   이슈: ${issue}`);

  // 1) 레포 ingest + 스택 감지 + Quarkify 매핑 (import 파이프라인 재사용)
  const imported = importProject(source, { workDir: opts.workDir });
  console.log(`   스택: ${imported.stack.language} (${imported.stack.framework}) · 심볼 ${imported.summary.symbols}`);

  // 2) 베이스라인 테스트
  console.log('🧪 베이스라인 테스트...');
  const before = runTests(imported.srcDir);

  // 3) 편집 루프 (solve 로 타겟팅 → LLM 패치 → 적용). 스택에 맞는 sourceFiles 재사용.
  const result = await handleEdit({
    projectDir: imported.srcDir,
    prompt: issue,
    mapDir: imported.mapDir,
    sourceFiles: ['auto'],
  });

  // 4) 수정 후 테스트
  let after = { ran: false, label: '', passed: null as boolean | null };
  if (result.applied.length) {
    console.log('🧪 수정 후 테스트...');
    after = runTests(imported.srcDir);
  }

  // 5) 리포트
  console.log('=============================================');
  console.log(' 🩺 OSS 자동수정 결과');
  console.log('=============================================');
  console.log(` ${result.dryRun ? '⚠️  DRY RUN (' + result.summary + ')' : '요약: ' + result.summary}`);
  console.log(` 🎯 타겟: ${result.targets.join(', ') || '없음'}`);
  console.log(` ✏️  적용: ${result.applied.length}개  ${result.applied.join(', ')}`);
  if (result.failed.length) console.log(` ⚠️  실패: ${result.failed.length}개`);
  if (before.ran) console.log(` 🧪 테스트: ${before.passed ? '통과' : '실패'} → ${after.ran ? (after.passed ? '통과' : '실패') : '미실행'} (${before.label})`);
  console.log(` 📁 작업본: ${imported.srcDir}`);
  console.log(' ↪️  PR: 변경 검토 후  git -C <작업본> checkout -b fix && git commit && gh pr create');
  console.log('=============================================');

  return { imported, result, tests: { before, after } };
}

// CLI: node --experimental-strip-types src/autofix.ts <git-url|path> "<이슈 설명>" [workDir]
const invokedDirect = process.argv[1] && process.argv[1].endsWith('autofix.ts');
if (invokedDirect) {
  const source = process.argv[2];
  const issue = process.argv[3];
  if (!source || !issue) {
    console.error('사용법: node --experimental-strip-types src/autofix.ts <git-url|local-path> "<이슈 설명>" [workDir]');
    process.exit(1);
  }
  autofix(source, issue, { workDir: process.argv[4] }).catch((err) => {
    console.error('❌ 자동수정 실패:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
