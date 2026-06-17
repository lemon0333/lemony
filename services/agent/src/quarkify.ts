import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Quarkify CLI 래퍼. 생성/임포트된 사이트 코드를 매핑해 에이전트에 코드맵을 제공한다.
// TODO: Quarkify 경로 설정화, 에러 처리, 증분 인덱싱 연동
const QUARKIFY = process.env.QUARKIFY_PATH
  || path.resolve(import.meta.dirname, '../../../../Quarkify/quarkify/quarkify.mjs');

export function quarkifyRun(configPath: string) {
  // node quarkify.mjs <config.mjs>  → quark/_mirror/_axon/quark_meta.json 생성
  execFileSync('node', [QUARKIFY, configPath], { stdio: 'inherit' });
}

export function collapse(outDir: string): string {
  // 코드맵을 단일 JSON 으로 → LLM 컨텍스트에 저렴하게 주입
  execFileSync('node', [QUARKIFY, '--collapse', outDir], { stdio: 'inherit' });
  return path.join(outDir, 'quark_tree.json');
}

// TODO: loadSymbolMeta(outDir) — quark_meta.json 읽어 file:line 그라운딩 제공
// TODO: impactOf(symbol) — 콜그래프(resolves_to__) 따라 영향 범위 계산
