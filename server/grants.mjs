import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { digest, playerName } from './auth.mjs';

export function createGrants(worldDir, now = Date.now) {
  const dir = path.join(worldDir, 'wallet_grants');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  function read(name) {
    if (!/^w_[0-9a-f]{17}$/.test(name)) return undefined;
    try { return JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')); } catch { return undefined; }
  }
  return {
    issue(session, sessionToken, ensName = null) {
      const name = playerName(session.address);
      const previous = read(name);
      if (previous && previous.address.toLowerCase() !== session.address.toLowerCase()) throw new Error('Player ID collision; refusing to overwrite identity.');
      const password = randomBytes(32).toString('base64url');
      const expiresAt = Math.floor(now() / 1000) + 120;
      // Luanti's legacy password encoding. Contains no wallet signature/key.
      // The 256-bit random password is a two-minute capability, never user-chosen.
      // Native-engine compatibility must be verified before GAME_ENABLED is enabled.
      const record = {
        name, address: session.address, expires_at: expiresAt,
        // Luanti's base64_encode deliberately omits '=' padding.
        password_hash: createHash('sha1').update(name + password).digest('base64').replace(/=+$/, ''),
        session_hash: digest(sessionToken),
      };
      if (ensName && typeof ensName === 'string' && ensName.length <= 255 && !/[\x00-\x1f\x7f]/.test(ensName)) record.ens_name = ensName;
      const target = path.join(dir, `${name}.json`);
      const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, target);
      return { name, password, expiresAt: expiresAt * 1000 };
    },
    revoke(session, sessionToken) {
      const record = read(session.playerName);
      if (record?.session_hash === digest(sessionToken)) rmSync(path.join(dir, `${session.playerName}.json`), { force: true });
    },
    // A restart invalidates browser sessions and outstanding join credentials.
    clear() {
      for (const name of readdirSync(dir)) if (/^w_[0-9a-f]{17}\.json(?:\.[0-9a-f]+\.tmp)?$/.test(name)) rmSync(path.join(dir, name), { force: true });
    },
  };
}
