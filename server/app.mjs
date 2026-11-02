import { createServer } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { existsSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Contract, FetchRequest, JsonRpcProvider, formatUnits, getAddress } from 'ethers';
import { AuthError, createAuth } from './auth.mjs';
import { createGrants } from './grants.mjs';
import { createEnsResolver } from './ens.mjs';
import { createEnsOwnership } from './ens-ownership.mjs';
import { createTownCredits } from './towns.mjs';
import { writeBalanceSnapshot } from './balance-snapshot.mjs';
import { attachGameProxy } from './game-proxy.mjs';
import { createPlayerStats, createPlayerExplorer } from './player-stats.mjs';
import { createNameRegistry, NameRegistryError } from './name-registry.mjs';
import { createBetaCodes, BetaCodeError } from './beta-codes.mjs';

const publicRoot = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ogg': 'audio/ogg' };
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
  const ens = createEnsResolver(config.ensRpcUrl);
  const ensOwnership = config.ensOwnership || createEnsOwnership(config.ensRpcUrl);
  grants.clear();
  const limits = new Map();
  const secureSuffix = config.secure ? '; Secure' : '';
  const sessionCookie = config.secure ? '__Host-miners_session' : 'miners_session';
  const challengeCookie = config.secure ? '__Host-miners_challenge' : 'miners_challenge';
  const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureSuffix}`;
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const nativeReady = () => {
    try {
      const age = Date.now() - statSync(path.join(config.worldDir, 'minemine-server-heartbeat')).mtimeMs;
      return age >= -1_000 && age < 10_000;
    } catch { return false; }
  };
  const available = () => config.gameEnabled && config.adapterReady && nativeReady() && existsSync(path.join(publicRoot, 'engine/adapter.js')) && existsSync(path.join(publicRoot, 'engine/index.html'));
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
  const towns = createTownCredits(config, provider);
  const playerStats = createPlayerStats(config.worldDir);
  const playerExplorer = createPlayerExplorer(config.worldDir);
  const names = createNameRegistry(config.worldDir, config.now || Date.now);
  const betaCodes = createBetaCodes(config.worldDir, config.now || Date.now);
  const adminWallets = new Set((config.adminWalletAddresses || []).map(address => address.toLowerCase()));
  const adminWriteFresh = session => {
    const age = (config.now || Date.now)() - session.authenticatedAt;
    return Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
  };
  async function playerIdentity(session) {
    const accountId = session.address.toLowerCase();
    const selected = names.selectedEns(accountId);
    if (selected) {
      try {
        await ensOwnership.verify(selected, session.address);
        return { ...session, ensName: selected, selectedEnsName: selected };
      } catch (error) {
        if (error instanceof AuthError && error.status === 403) names.clearSelectedEns(accountId, selected);
        // An unavailable RPC never permits an unverified selected name to display.
      }
    }
    let primary = null;
    try { primary = await ens.name(session.address); } catch { /* Address remains authoritative. */ }
    if (primary) {
      try { await ensOwnership.verify(primary, session.address); }
      catch { primary = null; }
    }
    return { ...session, ensName: primary, selectedEnsName: null };
  }
  const betaAdmitted = session => {
    if (!session) return false;
    if (!config.betaInvitesEnabled || adminWallets.has(session.address.toLowerCase()) || session.betaAdmitted) return true;
    if (betaCodes.isAdmitted(session.address.toLowerCase())) { session.betaAdmitted = true; return true; }
    return false;
  };
  const balances = new Map();
  async function balance(address, fresh = false) {
    if (!config.tokenAddress || !provider) return { configured: false };
    const cached = balances.get(address);
    if (!fresh && cached && Date.now() - cached.at < 15_000) return cached.value;
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
    const wsOrigin = config.origin.replace(/^http/, 'ws');
    const frameAncestors = req.url === '/engine/connect.html' ? "'self'" : "'none'";
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " + (enginePage ? "script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " : "style-src 'self'; ") + "img-src 'self' data:; connect-src 'self' " + wsOrigin + "; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors " + frameAncestors);
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== new URL(config.origin).host) throw new AuthError('Unexpected host.', 400);
      const url = new URL(req.url, config.origin);
      if (url.origin !== config.origin) throw new AuthError('Unexpected origin.', 400);
      if (req.method === 'POST' && req.headers.origin !== config.origin) throw new AuthError('Unexpected request origin.', 403);
      if (url.pathname.startsWith('/api/')) {
        // Caddy overwrites this dedicated header. Trust it only when the API is
        // bound to loopback, HTTPS is configured, and the peer is loopback.
        const peer = req.socket.remoteAddress || 'unknown';
        const proxied = req.headers['x-minemine-client-ip'];
        const ip = config.trustedLoopbackProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) &&
          typeof proxied === 'string' && isIP(proxied) ? proxied : peer;
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
        if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { chainId: config.chainId, tokenAddress: config.tokenAddress, townContractAddress: config.townContractAddress, currencySymbol: 'MINE', gameReady: available(), soloPlaytestAvailable: soloAvailable(), enginePresent: existsSync(path.join(publicRoot, 'engine/index.html')), ensAvailable: Boolean(config.ensRpcUrl || config.ensOwnership), betaInvitesEnabled: Boolean(config.betaInvitesEnabled), milestone: 'solo-playtest', walletSupport: 'EOA' });
        if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, nativeReady: nativeReady(), gameReady: available(), currencyConfigured: Boolean(config.tokenAddress && config.rpcUrl) });
        if (req.method === 'POST' && url.pathname === '/api/auth/challenge') {
          const data = await body(req);
          const challenge = auth.issue(data.address, data.chainId, jar[challengeCookie]);
          res.setHeader('Set-Cookie', cookie(challengeCookie, challenge.token, 300));
          return json(res, 200, { message: challenge.message, expiresAt: challenge.expiresAt });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
          const data = await body(req);
          const verified = await auth.verify(jar[challengeCookie], data.signature);
          if (session) { grants.revoke(session, sessionToken); auth.revoke(sessionToken); gameProxy.revoke(sessionToken); }
          res.setHeader('Set-Cookie', [cookie(sessionCookie, verified.token, 43200), cookie(challengeCookie, '', 0)]);
          return json(res, 200, verified.session);
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
          if (session) grants.revoke(session, sessionToken);
          auth.revoke(sessionToken);
          gameProxy.revoke(sessionToken);
          auth.cancel(jar[challengeCookie]);
          res.setHeader('Set-Cookie', [cookie(sessionCookie, '', 0), cookie(challengeCookie, '', 0)]);
          return json(res, 200, { ok: true });
        }
        if (!session) throw new AuthError('Sign in with your wallet first.');
        if (url.pathname.startsWith('/api/admin/')) {
          if (!adminWallets.has(session.address.toLowerCase())) throw new AuthError('Admin access required.', 403);
          if (req.method === 'GET' && url.pathname === '/api/admin/stats') return json(res, 200, await playerStats(nativeReady()));
          if (req.method === 'GET' && url.pathname === '/api/admin/players') {
            const query = url.searchParams.get('q') || '';
            const page = Number(url.searchParams.get('page') || '1');
            try { return json(res, 200, await playerExplorer(query, page)); }
            catch (error) { if (error.message.startsWith('Invalid player')) throw new AuthError(error.message, 400); throw error; }
          }
          if (req.method === 'GET' && url.pathname === '/api/admin/names') {
            return json(res, 200, { reservations: names.adminReservations().map(row => ({ handle: row.handle, expiresAt: new Date(row.expires_at).toISOString() })) });
          }
          if (req.method === 'GET' && url.pathname === '/api/admin/beta/codes') {
            return json(res, 200, { codes: betaCodes.list().map(row => ({ id: row.id, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), maxUses: row.max_uses, uses: row.uses, intendedAccount: row.intended_account, revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString() })) });
          }
          if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
            const events = [
              ...names.recentAudit().map(row => ({ source: 'username', target: row.handle, action: row.action, actor: row.actor, at: row.at, id: row.id })),
              ...betaCodes.recentAudit().map(row => ({ source: 'beta code', target: row.code_id, action: row.action, actor: row.actor, at: row.at, id: row.id })),
            ].sort((a, b) => b.at - a.at || b.id - a.id || a.source.localeCompare(b.source)).slice(0, 50);
            return json(res, 200, { events: events.map(({ id, ...event }) => ({ ...event, at: new Date(event.at).toISOString() })) });
          }
          if (req.method === 'POST' && ['/api/admin/beta/codes/create', '/api/admin/beta/codes/revoke'].includes(url.pathname)) {
            if (!adminWriteFresh(session)) throw new AuthError('Sign in with your admin wallet again before changing beta codes.', 403);
            const data = await body(req);
            try {
              if (url.pathname.endsWith('/create')) {
                let intendedAccount = null;
                if (data.intendedAccount) {
                  try { intendedAccount = getAddress(data.intendedAccount).toLowerCase(); }
                  catch { throw new BetaCodeError('Invalid intended wallet address.', 'invalid_input'); }
                }
                const days = data.days ?? 14;
                if (!Number.isInteger(days) || days < 1 || days > 30) throw new BetaCodeError('Choose 1 to 30 days.', 'invalid_input');
                const created = betaCodes.create({ actor: session.address.toLowerCase(), maxUses: data.maxUses ?? 1, expiresAt: (config.now || Date.now)() + days * 24 * 60 * 60_000, intendedAccount });
                return json(res, 201, { ...created, expiresAt: new Date(created.expiresAt).toISOString() });
              }
              return json(res, 200, { revoked: betaCodes.revoke(data.id, session.address.toLowerCase()) });
            } catch (error) {
              if (error instanceof BetaCodeError) throw new AuthError(error.message, error.code === 'not_found' ? 404 : 400);
              throw error;
            }
          }
          if (req.method === 'POST' && ['/api/admin/names/reserve', '/api/admin/names/release'].includes(url.pathname)) {
            if (!adminWriteFresh(session)) throw new AuthError('Sign in with your admin wallet again before changing reservations.', 403);
            const data = await body(req);
            try {
              if (url.pathname.endsWith('/reserve')) {
                const record = names.reserveAdmin(data.handle, session.address, null, (config.now || Date.now)() + 7 * 24 * 60 * 60_000);
                return json(res, 201, { handle: record.handle, expiresAt: new Date(record.expires_at).toISOString() });
              }
              names.releaseAdmin(data.handle, session.address);
              return json(res, 200, { released: true });
            } catch (error) {
              if (error instanceof NameRegistryError) throw new AuthError(error.message, error.code === 'invalid_handle' || error.code === 'invalid_input' ? 400 : 409);
              throw error;
            }
          }
          throw new AuthError('Unknown admin route.', 404);
        }
        if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, session);
        if (req.method === 'GET' && url.pathname === '/api/beta/status') return json(res, 200, { enabled: Boolean(config.betaInvitesEnabled), admitted: adminWallets.has(session.address.toLowerCase()) || betaCodes.isAdmitted(session.address.toLowerCase()) });
        if (req.method === 'POST' && url.pathname === '/api/beta/redeem') {
          const data = await body(req);
          try {
            const result = betaCodes.redeem(data.code, session.address.toLowerCase());
            session.betaAdmitted = true;
            return json(res, 200, result);
          } catch (error) {
            if (error instanceof BetaCodeError) throw new AuthError(error.message, 400);
            throw error;
          }
        }
        if (req.method === 'GET' && url.pathname === '/api/identity') return json(res, 200, await playerIdentity(session));
        if (req.method === 'POST' && url.pathname === '/api/identity/ens') {
          const data = await body(req);
          const verified = await ensOwnership.verify(data.name, session.address);
          names.selectEns(session.address.toLowerCase(), verified.name);
          return json(res, 200, { ...session, ensName: verified.name, selectedEnsName: verified.name, ensVersion: verified.version });
        }
        if (req.method === 'POST' && url.pathname === '/api/identity/ens/clear') {
          await body(req);
          return json(res, 200, { cleared: names.clearSelectedEns(session.address.toLowerCase()) });
        }
        if (req.method === 'GET' && url.pathname === '/api/currency/recipient') return json(res, 200, await ens.recipient(url.searchParams.get('input')));
        if (req.method === 'GET' && url.pathname === '/api/currency/balance') return json(res, 200, await balance(session.address));
        if (req.method === 'POST' && url.pathname === '/api/currency/sync') {
          await body(req);
          const value = await balance(session.address, true);
          if (!value.configured) throw new AuthError('MINE is not configured.', 503);
          writeBalanceSnapshot(config, session, value);
          return json(res, 200, value);
        }
        if (req.method === 'GET' && url.pathname === '/api/towns/status') return json(res, 200, await towns.status(session.address));
        if (req.method === 'POST' && url.pathname === '/api/towns/sync') return json(res, 200, await towns.sync(session));
        if (req.method === 'POST' && url.pathname === '/api/game/ticket') {
          if (!betaAdmitted(session)) throw new AuthError('Redeem a beta invite before joining the shared world.', 403);
          if (!available()) throw new AuthError('The Luanti engine and server adapter are not ready yet. See the roadmap.', 503);
          const identity = await playerIdentity(session);
          return json(res, 200, { ...grants.issue(session, sessionToken, identity.ensName), address: config.gameAddress, port: config.gamePort });
        }
        throw new AuthError('Unknown API route.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AuthError('Method not allowed.', 405);
      if (url.pathname === '/play' || url.pathname === '/play/') {
        res.writeHead(302, { Location: soloAvailable() ? '/engine/index.html' : 'https://cupojoseph.github.io/minemine/play/' });
        res.end();
        return;
      }
      if (url.pathname === '/map' || url.pathname === '/map/') {
        res.writeHead(302, { Location: '/map/index.html' });
        res.end();
        return;
      }
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
      const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}-${Math.floor(info.ctimeMs).toString(16)}"`;
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match']?.split(',').map(value => value.trim()).includes(etag)) {
        res.writeHead(304);
        res.end();
        return;
      }
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
  const gameProxy = attachGameProxy(server, config, request => cookies(request)[sessionCookie], token => betaAdmitted(auth.get(token)));
  server.stopGameProxy = () => gameProxy.close();
  server.on('close', () => { gameProxy.close(); provider?.destroy(); ens.close(); names.close(); betaCodes.close(); });
  return server;
}
