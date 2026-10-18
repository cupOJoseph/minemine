import { createServer } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { existsSync, createReadStream, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, FetchRequest, JsonRpcProvider, formatUnits } from 'ethers';
import { AuthError, createAuth } from './auth.mjs';
import { createGrants } from './grants.mjs';

const publicRoot = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg' };
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p.length === 2));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AuthError('Expected JSON.', 415);
  let value = '';
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new AuthError('Request too large.', 413);
    value += chunk;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch { throw new AuthError('Invalid JSON body.', 400); }
}

export function createApp(config) {
  const auth = createAuth(config);
  const grants = createGrants(config.worldDir);
  grants.clear();
  const limits = new Map();
  const secureSuffix = config.secure ? '; Secure' : '';
  const sessionCookie = config.secure ? '__Host-miners_session' : 'miners_session';
  const challengeCookie = config.secure ? '__Host-miners_challenge' : 'miners_challenge';
  const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureSuffix}`;
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const available = () => config.gameEnabled && config.adapterReady && existsSync(path.join(publicRoot, 'engine/adapter.js')) && existsSync(path.join(publicRoot, 'engine/index.html'));
  const soloAvailable = () => {
    try {
      const build = JSON.parse(readFileSync(path.join(publicRoot, 'engine/build.json'), 'utf8'));
      if (build.kind !== 'solo-engine-playtest' || !/^[a-f0-9]{12}$/.test(build.release)) return false;
      return ['index.html', build.release + '/luanti.wasm', build.release + '/packs/minetest.pack'].every(file => existsSync(path.join(publicRoot, 'engine', file)));
    } catch { return false; }
  };
  let provider;
  if (config.rpcUrl) {
    const request = new FetchRequest(config.rpcUrl);
    request.timeout = 8000;
    provider = new JsonRpcProvider(request);
  }
  const balances = new Map();
  async function balance(address) {
    if (!config.tokenAddress || !provider) return { configured: false };
    const cached = balances.get(address);
    if (cached && Date.now() - cached.at < 15_000) return cached.value;
    if (Number((await provider.getNetwork()).chainId) !== config.chainId) throw new AuthError('Currency RPC uses the wrong chain.', 503);
    const token = new Contract(config.tokenAddress, ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], provider);
    const blockNumber = await provider.getBlockNumber();
    const [raw, decimals] = await Promise.all([token.balanceOf(address, { blockTag: blockNumber }), token.decimals({ blockTag: blockNumber })]);
    const value = { configured: true, address: config.tokenAddress, raw: raw.toString(), formatted: formatUnits(raw, decimals), decimals: Number(decimals), blockNumber, chainId: config.chainId, observedAt: new Date().toISOString() };
    if (balances.size >= 10_000) balances.clear();
    balances.set(address, { at: Date.now(), value });
    return value;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // Upstream engine builds its own runtime styles and menu event attributes.
    // Keep those permissions scoped to the engine; wallet pages retain strict CSP.
    const enginePage = req.url?.startsWith('/engine/');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " + (enginePage ? "script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " : "style-src 'self'; ") + "img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== new URL(config.origin).host) throw new AuthError('Unexpected host.', 400);
      const url = new URL(req.url, config.origin);
      if (url.origin !== config.origin) throw new AuthError('Unexpected origin.', 400);
      if (req.method === 'POST' && req.headers.origin !== config.origin) throw new AuthError('Unexpected request origin.', 403);
      if (url.pathname.startsWith('/api/')) {
        // Do not trust X-Forwarded-For. Reverse proxies need an explicit, verified trust policy.
        const ip = req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
        let limit = limits.get(ip);
        if (!limit) {
          if (limits.size >= 10_000) throw new AuthError('Server busy.', 503);
          limits.set(ip, limit = { count: 0, until: now + 60_000 });
        }
        if (++limit.count > 120) throw new AuthError('Too many requests. Wait one minute.', 429);
        const jar = cookies(req);
        const sessionToken = jar[sessionCookie];
        const session = auth.get(sessionToken);
        if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { chainId: config.chainId, tokenAddress: config.tokenAddress, currencySymbol: 'MINE', gameReady: available(), soloPlaytestAvailable: soloAvailable(), enginePresent: existsSync(path.join(publicRoot, 'engine/index.html')), milestone: 'foundation', walletSupport: 'EOA' });
        if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, gameReady: available(), currencyConfigured: Boolean(config.tokenAddress && config.rpcUrl) });
        if (req.method === 'POST' && url.pathname === '/api/auth/challenge') {
          const data = await body(req);
          const challenge = auth.issue(data.address, data.chainId, jar[challengeCookie]);
          res.setHeader('Set-Cookie', cookie(challengeCookie, challenge.token, 300));
          return json(res, 200, { message: challenge.message, expiresAt: challenge.expiresAt });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
          const data = await body(req);
          const verified = auth.verify(jar[challengeCookie], data.signature);
          if (session) { grants.revoke(session, sessionToken); auth.revoke(sessionToken); }
          res.setHeader('Set-Cookie', [cookie(sessionCookie, verified.token, 43200), cookie(challengeCookie, '', 0)]);
          return json(res, 200, verified.session);
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
          if (session) grants.revoke(session, sessionToken);
          auth.revoke(sessionToken);
          auth.cancel(jar[challengeCookie]);
          res.setHeader('Set-Cookie', [cookie(sessionCookie, '', 0), cookie(challengeCookie, '', 0)]);
          return json(res, 200, { ok: true });
        }
        if (!session) throw new AuthError('Sign in with your wallet first.');
        if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, session);
        if (req.method === 'GET' && url.pathname === '/api/currency/balance') return json(res, 200, await balance(session.address));
        if (req.method === 'POST' && url.pathname === '/api/game/ticket') {
          if (!available()) throw new AuthError('The Luanti engine and server adapter are not ready yet. See the roadmap.', 503);
          return json(res, 200, { ...grants.issue(session, sessionToken), address: config.gameAddress, port: config.gamePort });
        }
        throw new AuthError('Unknown API route.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AuthError('Method not allowed.', 405);
      let relative;
      try { relative = decodeURIComponent(url.pathname); } catch { throw new AuthError('Invalid path.', 400); }
      if (relative.includes('\0') || relative.split('/').some(s => s.startsWith('.') || s.includes('\\'))) throw new AuthError('Not found.', 404);
      const requested = path.resolve(publicRoot, `.${relative === '/' ? '/index.html' : relative}`);
      if (!requested.startsWith(publicRoot + path.sep)) throw new AuthError('Not found.', 404);
      let file;
      try { file = await realpath(requested); } catch { throw new AuthError('Not found.', 404); }
      if (!file.startsWith(publicRoot + path.sep)) throw new AuthError('Not found.', 404);
      const info = await stat(file);
      if (!info.isFile()) throw new AuthError('Not found.', 404);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
      if (req.method === 'HEAD') res.end();
      else await pipeline(createReadStream(file), res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Server could not complete this request.' });
      else res.end();
      if (!error.status) console.error('Request failed:', error.code || error.name);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => provider?.destroy());
  return server;
}
