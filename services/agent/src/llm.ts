import process from 'node:process';
import { execFileSync } from 'node:child_process';

// 코드 패치를 생성하는 LLM 코어. 백엔드 우선순위:
//  1) ANTHROPIC_API_KEY 있으면 @anthropic-ai/sdk (claude-opus-4-8, adaptive thinking, 스트리밍, 구조화출력)
//  2) 없으면 로그인된 `claude` CLI 를 헤드리스(-p)로 사용 → 별도 키 불필요
//  3) 둘 다 없으면 dry-run
// 모델/사고 설정은 SDK 경로에서만 명시; CLI 경로는 로그인 세션의 설정을 따른다.

const MODEL = 'claude-opus-4-8';

export interface FileEdit { path: string; search: string; replace: string; reason?: string; }
export interface PatchPlan { summary: string; edits: FileEdit[]; }
export interface PatchResult { plan: PatchPlan; dryRun: boolean; refused?: boolean; }

const EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: '무엇을 왜 바꿨는지 한국어 한두 문장' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '프로젝트 루트 기준 상대 경로' },
          search: { type: 'string', description: '해당 파일에 존재하는 정확한 원문 부분 문자열' },
          replace: { type: 'string', description: '대체할 새 코드' },
          reason: { type: 'string' },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  required: ['summary', 'edits'],
};

const SYSTEM = `You are lemony's code-editing agent — you modify an existing web project precisely on behalf of a non-developer.
Rules:
- Ground every edit in the provided context (exact file:line snippets). Never invent files, symbols, or APIs not shown.
- Each edit is an exact string search/replace inside one file. "search" MUST be a verbatim substring copied from that file's snippet (including indentation).
- Keep changes minimal and scoped to the user's request — no unrelated refactors, no new files unless strictly required.
- Requests are usually in Korean. Interpret intent faithfully; if the request is impossible from the given context, return an empty edits array and explain why in "summary".`;

function parseEditJson(text: string): PatchPlan {
  let t = (text || '').trim();
  // 코드펜스/잡텍스트 제거 후 첫 { ~ 마지막 } 추출
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try {
    const plan = JSON.parse(t);
    if (!Array.isArray(plan.edits)) plan.edits = [];
    if (typeof plan.summary !== 'string') plan.summary = '';
    return plan;
  } catch { return { summary: 'LLM 응답 JSON 파싱 실패', edits: [] }; }
}

// 로그인된 claude CLI 가 있으면 헤드리스로 호출 (키 불필요)
function claudeCliAvailable(): boolean {
  try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function proposeViaCli(opts: { prompt: string; context: string }): PatchResult {
  const fullPrompt = `${SYSTEM}\n\n요청:\n${opts.prompt}\n\n=== 코드 컨텍스트 (file:line) ===\n${opts.context}\n\n` +
    `위 컨텍스트에만 근거해 정확한 search/replace 편집을 JSON 으로 출력하라. ` +
    `형식: {"summary": string, "edits": [{"path": string, "search": string, "replace": string}]}. ` +
    `마크다운/설명 없이 JSON 객체만 출력.`;
  let out: string;
  try {
    out = execFileSync('claude', ['-p', fullPrompt, '--output-format', 'text'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err: any) {
    return { dryRun: false, plan: { summary: 'claude CLI 실행 실패: ' + (err && err.message ? err.message.split('\n')[0] : err), edits: [] } };
  }
  return { dryRun: false, plan: parseEditJson(out) };
}

export async function proposePatch(opts: { prompt: string; context: string }): Promise<PatchResult> {
  // 백엔드 2) — API 키 없으면 로그인된 claude CLI 사용
  if (!process.env.ANTHROPIC_API_KEY) {
    if (claudeCliAvailable()) return proposeViaCli(opts);
    return { dryRun: true, plan: { summary: 'DRY RUN — ANTHROPIC_API_KEY 미설정 & claude CLI 없음.', edits: [] } };
  }
  // 백엔드 1) — SDK
  let Anthropic: any;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    if (claudeCliAvailable()) return proposeViaCli(opts);
    return { dryRun: true, plan: { summary: 'DRY RUN — @anthropic-ai/sdk 미설치 & claude CLI 없음.', edits: [] } };
  }

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: EDIT_SCHEMA } },
    messages: [{
      role: 'user',
      content: `요청:\n${opts.prompt}\n\n=== 코드 컨텍스트 (file:line) ===\n${opts.context}\n\n위 컨텍스트에만 근거해 정확한 search/replace 편집을 스키마에 맞춰 제시하라.`,
    }],
  });

  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    return { dryRun: false, refused: true, plan: { summary: '모델이 요청을 거부함(안전상).', edits: [] } };
  }
  const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return { dryRun: false, plan: parseEditJson(text) };
}
