import http from 'node:http';
import process from 'node:process';
import { handleEdit } from './edit-loop.ts';

// lemony 에이전트 HTTP 서버 — 빌더 UI(apps/builder)가 POST /edit 로 자연어 편집을 요청한다.
// 실행: npm -w @lemony/agent run serve   (node --experimental-strip-types src/server.ts)

const PORT = Number(process.env.PORT || 8787);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, hasKey: !!process.env.ANTHROPIC_API_KEY }));
    return;
  }
  if (req.method === 'POST' && req.url === '/edit') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { projectDir, prompt, sourceFiles } = JSON.parse(body || '{}');
      if (!projectDir || !prompt) {
        res.writeHead(400, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'projectDir 와 prompt 가 필요합니다.' }));
        return;
      }
      const result = await handleEdit({ projectDir, prompt, sourceFiles });
      res.writeHead(200, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: err && err.message ? err.message : String(err) }));
    }
    return;
  }
  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, () => {
  console.log(`🍋 lemony agent listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('⚠️  ANTHROPIC_API_KEY 미설정 — /edit 는 dry-run 으로 동작합니다.');
});
