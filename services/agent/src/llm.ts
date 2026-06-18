import process from 'node:process';

// Claude(@anthropic-ai/sdk) 호출로 코드 패치를 생성하는 LLM 코어.
// 모델: claude-opus-4-8 (adaptive thinking), 긴 출력 대비 스트리밍, 구조화 출력(output_config.format).
// ANTHROPIC_API_KEY 또는 SDK 가 없으면 dry-run 으로 안전하게 폴백한다.

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

export async function proposePatch(opts: { prompt: string; context: string }): Promise<PatchResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { dryRun: true, plan: { summary: 'DRY RUN — ANTHROPIC_API_KEY 미설정. 실제 패치 생성을 건너뜀.', edits: [] } };
  }
  let Anthropic: any;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return { dryRun: true, plan: { summary: 'DRY RUN — @anthropic-ai/sdk 미설치 (npm install 필요).', edits: [] } };
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
  let plan: PatchPlan;
  try { plan = JSON.parse(text); } catch { plan = { summary: 'LLM 응답 JSON 파싱 실패', edits: [] }; }
  if (!Array.isArray(plan.edits)) plan.edits = [];
  return { dryRun: false, plan };
}
