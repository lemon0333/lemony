import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { handleEdit } from './edit-loop.ts';
import { createSite, editHtml, generateHtmlStreaming } from './generate.ts';
import { startOAuth, handleCallback, demoLogin, logout, userFromReq, authStatus } from './auth.ts';

// lemony 에이전트 HTTP 서버.
//  POST /create   {prompt}            → 자연어로 새 사이트 생성 → {id, previewUrl}
//  POST /edit-site {id, prompt}       → 생성된 단일 HTML 사이트를 자연어로 수정
//  GET  /preview/<id>/...             → 생성된 사이트 정적 서빙 (빌더 iframe 용)
//  POST /edit     {projectDir,prompt} → (고급) 기존 프로젝트를 Quarkify 그라운딩 편집
// 실행: npm -w @lemony/agent run serve

const PORT = Number(process.env.PORT || 8787);
const SITES = process.env.LEMONY_SITES || path.join(os.tmpdir(), 'lemony-sites');
fs.mkdirSync(SITES, { recursive: true });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const json = (res: http.ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(obj));
};
const readBody = async (req: http.IncomingMessage) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const metaPath = (id: string) => path.join(SITES, id, 'meta.json');
const writeMeta = (id: string, m: any) => { try { fs.writeFileSync(metaPath(id), JSON.stringify(m), 'utf-8'); } catch {} };
const readMeta = (id: string) => { try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf-8')); } catch { return {}; } };

// 사용자 채팅/요청 로그 (JSONL append). 분석·감사·재현용.
const LOG_DIR = process.env.LEMONY_LOG_DIR || path.join(SITES, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logEvent = (req: http.IncomingMessage, e: Record<string, unknown>) => {
  try {
    const user = userFromReq(req);
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    fs.appendFileSync(path.join(LOG_DIR, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), user: user?.id || null, name: user?.name || null, ip, ...e }) + '\n');
  } catch { /* 로깅 실패는 무시 */ }
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  if (req.method === 'GET' && url === '/health') {
    return json(res, 200, { ok: true, sites: SITES });
  }

  // ─── 인증(소셜 로그인) ───
  if (req.method === 'GET' && url === '/auth/me') {
    return json(res, 200, { user: userFromReq(req), providers: authStatus() });
  }
  if (req.method === 'GET' && (url === '/auth/github' || url === '/auth/google')) {
    return startOAuth(url.split('/')[2], res);
  }
  if (req.method === 'GET' && url.startsWith('/auth/') && url.includes('/callback')) {
    const provider = url.split('/')[2];
    return handleCallback(provider, new URL(url, 'http://x').searchParams, res);
  }
  if (req.method === 'POST' && url === '/auth/demo') {
    try { const { name } = await readBody(req); const user = demoLogin(name, res); logEvent(req, { action: 'login', provider: 'demo', loginName: name }); return json(res, 200, { user }); }
    catch { const user = demoLogin('', res); return json(res, 200, { user }); }
  }
  if (req.method === 'POST' && url === '/auth/logout') {
    logout(req, res); return json(res, 200, { ok: true });
  }

  // 빌더 UI (Lovable 스타일) — 서버가 UI 와 API 를 함께 서빙
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const uiFile = path.join(import.meta.dirname, 'ui.html');
    if (fs.existsSync(uiFile)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...CORS });
      fs.createReadStream(uiFile).pipe(res);
      return;
    }
    return json(res, 500, { error: 'ui.html 없음' });
  }

  // 정적 프리뷰: /preview/<id>/<file?>  (단일 HTML 사이트 → 기본 index.html)
  if (req.method === 'GET' && url.startsWith('/preview/')) {
    const rel = decodeURIComponent(url.slice('/preview/'.length).split('?')[0]);
    const parts = rel.split('/').filter((p) => p && p !== '..');
    const id = parts[0] || '';
    const sub = parts.slice(1).join('/') || 'index.html';
    const file = path.join(SITES, id, sub);
    if (!file.startsWith(path.join(SITES, id)) || !fs.existsSync(file)) { res.writeHead(404, CORS); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...CORS });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // 로그인 사용자의 사이트 목록 (내 프로젝트)
  if (req.method === 'GET' && url === '/sites') {
    const user = userFromReq(req);
    const out: any[] = [];
    for (const id of fs.readdirSync(SITES)) {
      const metaFile = path.join(SITES, id, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        if (user && m.owner && m.owner !== user.id) continue; // 내 것만
        out.push({ id, name: m.name, updatedAt: m.updatedAt, previewUrl: `/preview/${id}/` });
      } catch {}
    }
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json(res, 200, { sites: out.slice(0, 50) });
  }

  // 스트리밍 생성(SSE) — 진행 상황을 실시간으로 (동그라미 대신 단계/분량 표시)
  if (req.method === 'GET' && url.startsWith('/create-stream')) {
    const prompt = new URL(url, 'http://x').searchParams.get('prompt') || '';
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...CORS });
    const send = (ev: string, data: any) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!prompt) { send('error', { error: 'prompt 필요' }); res.end(); return; }
    send('status', { text: '요청 이해 중…' });
    try {
      const html = await generateHtmlStreaming(prompt, '', (acc) => {
        const chars = acc.length;
        const stage = chars < 300 ? '디자인 구성 중…' : '코드 생성 중…';
        send('progress', { stage, chars });
      });
      send('status', { text: '마무리…' });
      const user = userFromReq(req);
      const id = 'site_' + Date.now().toString(36);
      const dir = path.join(SITES, id); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
      writeMeta(id, { owner: user?.id || 'anon', name: prompt.slice(0, 40), prompt, createdAt: Date.now(), updatedAt: Date.now() });
      logEvent(req, { action: 'create', mode: 'stream', prompt, siteId: id, chars: html.length });
      send('done', { id, previewUrl: `/preview/${id}/` });
    } catch (err: any) { send('error', { error: err?.message || String(err) }); }
    res.end();
    return;
  }

  if (req.method === 'POST' && url === '/create') {
    try {
      const { prompt } = await readBody(req);
      if (!prompt) return json(res, 400, { error: 'prompt 가 필요합니다.' });
      const user = userFromReq(req);
      const site = createSite(prompt, SITES);
      writeMeta(site.id, { owner: user?.id || 'anon', name: prompt.slice(0, 40), prompt, createdAt: Date.now(), updatedAt: Date.now() });
      logEvent(req, { action: 'create', prompt, siteId: site.id });
      return json(res, 200, { id: site.id, name: prompt.slice(0, 40), previewUrl: `/preview/${site.id}/` });
    } catch (err: any) { return json(res, 500, { error: err?.message || String(err) }); }
  }

  if (req.method === 'POST' && url === '/edit-site') {
    try {
      const { id, prompt } = await readBody(req);
      const file = path.join(SITES, id || '', 'index.html');
      if (!id || !fs.existsSync(file)) return json(res, 404, { error: '사이트를 찾을 수 없습니다.' });
      const current = fs.readFileSync(file, 'utf-8');
      fs.writeFileSync(file, editHtml(current, prompt), 'utf-8');
      const m = readMeta(id); writeMeta(id, { ...m, updatedAt: Date.now() });
      logEvent(req, { action: 'edit', prompt, siteId: id });
      return json(res, 200, { id, previewUrl: `/preview/${id}/` });
    } catch (err: any) { return json(res, 500, { error: err?.message || String(err) }); }
  }

  if (req.method === 'POST' && url === '/edit') { // 고급: 기존 프로젝트 편집
    try {
      const { projectDir, prompt, sourceFiles } = await readBody(req);
      if (!projectDir || !prompt) return json(res, 400, { error: 'projectDir 와 prompt 가 필요합니다.' });
      return json(res, 200, await handleEdit({ projectDir, prompt, sourceFiles }));
    } catch (err: any) { return json(res, 500, { error: err?.message || String(err) }); }
  }

  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, () => {
  console.log(`🍋 lemony agent: http://localhost:${PORT}  (sites: ${SITES})`);
});
