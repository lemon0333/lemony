import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Quarkify CLI 래퍼 — 생성/임포트된 코드를 매핑해 에이전트에 코드맵을 제공한다.
// Quarkify 경로는 QUARKIFY_PATH 로 오버라이드 가능. 기본은 형제 디렉터리의 Quarkify.
export const QUARKIFY: string = process.env.QUARKIFY_PATH
  || path.resolve(import.meta.dirname, '../../../../Quarkify/quarkify/quarkify.mjs');

function run(args: string[], opts: { quiet?: boolean } = {}) {
  execFileSync('node', [QUARKIFY, ...args], { stdio: opts.quiet ? 'ignore' : 'inherit' });
}

// 임포트 대상에 맞는 Quarkify config(.mjs)를 생성하고 경로를 반환.
export function generateConfig(o: {
  name: string; srcDir: string; outDir: string; sourceFiles: string[]; configPath: string; incremental?: boolean;
}): string {
  const body = `export default {
  name: ${JSON.stringify(o.name)},
  srcDir: ${JSON.stringify(o.srcDir)},
  outDir: ${JSON.stringify(o.outDir)},
  sourceFiles: ${JSON.stringify(o.sourceFiles)},
  perfData: {},
  incremental: ${o.incremental ? 'true' : 'false'},
  guessRole(name) {
    const n = name.toLowerCase();
    if (n.includes('controller') || n.includes('route') || n.includes('handler')) return 'web_endpoint';
    if (n.includes('service') || n.includes('usecase')) return 'business_logic';
    if (n.includes('repository') || n.includes('dao') || n.includes('store')) return 'data_access';
    if (n.includes('component') || n.includes('page') || n.includes('view')) return 'ui_component';
    if (n.includes('dto') || n.includes('entity') || n.includes('model') || n.includes('schema')) return 'type';
    return 'general';
  },
};
`;
  fs.writeFileSync(o.configPath, body, 'utf-8');
  return o.configPath;
}

export function quarkifyRun(configPath: string, opts: { quiet?: boolean } = {}) {
  run([configPath], opts); // → quark/_mirror/_axon/quark_meta.json
}

export function collapse(outDir: string): string {
  run(['--collapse', outDir], { quiet: true });
  return path.join(outDir, 'quark_tree.json');
}

export function solve(outDir: string, query: string): string {
  run(['--solve', outDir, query], { quiet: true });
  return path.join(outDir, 'solve_pack.md');
}

// quark_meta.json 로드 → file:line 그라운딩 데이터
export function loadSymbolMeta(outDir: string): { count: number; symbols: any[] } {
  const p = path.join(outDir, 'quark_meta.json');
  if (!fs.existsSync(p)) return { count: 0, symbols: [] };
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
