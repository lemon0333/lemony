import crypto from 'node:crypto';
import http from 'node:http';
import process from 'node:process';

// 소셜 로그인(GitHub/Google) + 세션.
// 실제 OAuth 는 env 에 client id/secret 가 있어야 동작:
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// 없으면 해당 provider 는 비활성 → 데모 로그인으로 UX 유지.
// 세션은 인메모리(개발용). 운영 시 외부 스토어로 교체.

export const BASE_URL = process.env.LEMONY_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;

export interface User { id: string; name: string; provider: string; avatar?: string; login?: string; }

const sessions = new Map<string, User>(); // sid -> user
const oauthState = new Map<string, { provider: string; ts: number }>(); // CSRF state

const PROVIDERS: Record<string, any> = {
  github: {
    id: () => process.env.GITHUB_CLIENT_ID,
    secret: () => process.env.GITHUB_CLIENT_SECRET,
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    userinfo: 'https://api.github.com/user',
    scope: 'read:user',
  },
  google: {
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid email profile',
  },
};

export function providerEnabled(name: string): boolean {
  const p = PROVIDERS[name];
  return !!(p && p.id() && p.secret());
}

function cookie(res: http.ServerResponse, sid: string) {
  res.setHeader('Set-Cookie', `lemony_sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
}
function clearCookie(res: http.ServerResponse) {
  res.setHeader('Set-Cookie', 'lemony_sid=; HttpOnly; Path=/; Max-Age=0');
}
export function userFromReq(req: http.IncomingMessage): User | null {
  const m = (req.headers.cookie || '').match(/lemony_sid=([^;]+)/);
  return m ? sessions.get(m[1]) || null : null;
}
function login(res: http.ServerResponse, user: User) {
  const sid = crypto.randomUUID();
  sessions.set(sid, user);
  cookie(res, sid);
  return sid;
}

// provider 로 리다이렉트 시작
export function startOAuth(provider: string, res: http.ServerResponse) {
  const p = PROVIDERS[provider];
  if (!providerEnabled(provider)) { res.writeHead(302, { Location: `/?login_error=${provider}_not_configured` }); res.end(); return; }
  const state = crypto.randomUUID();
  oauthState.set(state, { provider, ts: Date.now() });
  const u = new URL(p.authorize);
  u.searchParams.set('client_id', p.id());
  u.searchParams.set('redirect_uri', `${BASE_URL}/auth/${provider}/callback`);
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('state', state);
  if (provider === 'google') u.searchParams.set('response_type', 'code');
  res.writeHead(302, { Location: u.toString() });
  res.end();
}

// callback: code → token → 프로필 → 세션
export async function handleCallback(provider: string, query: URLSearchParams, res: http.ServerResponse) {
  const p = PROVIDERS[provider];
  const code = query.get('code'); const state = query.get('state');
  if (!p || !code || !state || !oauthState.has(state)) { res.writeHead(302, { Location: '/?login_error=bad_callback' }); res.end(); return; }
  oauthState.delete(state);
  try {
    const tokRes = await fetch(p.token, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: p.id(), client_secret: p.secret(), code,
        redirect_uri: `${BASE_URL}/auth/${provider}/callback`, grant_type: 'authorization_code',
      }).toString(),
    });
    const tok = await tokRes.json();
    const accessToken = tok.access_token;
    if (!accessToken) throw new Error('no access_token');
    const uiRes = await fetch(p.userinfo, { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'lemony', Accept: 'application/json' } });
    const info: any = await uiRes.json();
    const user: User = provider === 'github'
      ? { id: 'gh_' + info.id, name: info.name || info.login, login: info.login, avatar: info.avatar_url, provider }
      : { id: 'go_' + info.id, name: info.name || info.email, login: info.email, avatar: info.picture, provider };
    login(res, user);
    res.writeHead(302, { Location: '/' }); res.end();
  } catch (err: any) {
    res.writeHead(302, { Location: '/?login_error=' + encodeURIComponent(err?.message || 'oauth_failed') }); res.end();
  }
}

// 데모(게스트) 로그인 — OAuth 미설정이어도 UX 동작
export function demoLogin(name: string, res: http.ServerResponse): User {
  const user: User = { id: 'demo_' + crypto.randomUUID().slice(0, 8), name: name || '게스트', provider: 'demo' };
  login(res, user);
  return user;
}

export function logout(req: http.IncomingMessage, res: http.ServerResponse) {
  const m = (req.headers.cookie || '').match(/lemony_sid=([^;]+)/);
  if (m) sessions.delete(m[1]);
  clearCookie(res);
}

export function authStatus() {
  return { github: providerEnabled('github'), google: providerEnabled('google') };
}
