import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const hash = value => createHash('sha256').update(value).digest('hex');
const codePattern = /^MM-[A-Za-z0-9_-]{32}$/;

export class BetaCodeError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function account(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/.test(value)) throw new BetaCodeError('Invalid account.', 'invalid_input');
  return value;
}

export function createBetaCodes(worldDir, now = Date.now) {
  const directory = path.join(worldDir, 'beta_invites');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = path.join(directory, 'invites.sqlite');
  try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!lstatSync(file).isFile()) throw new Error('Beta invite path must be a regular file.');
  }
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS beta_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
      uses INTEGER NOT NULL DEFAULT 0,
      intended_account TEXT,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS beta_admissions (
      account_id TEXT PRIMARY KEY,
      code_id TEXT NOT NULL REFERENCES beta_codes(id),
      admitted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS beta_audit (
      id INTEGER PRIMARY KEY,
      code_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      at INTEGER NOT NULL
    );`);
  db.exec('PRAGMA foreign_keys = ON');
  const findByHash = db.prepare('SELECT * FROM beta_codes WHERE code_hash = ?');
  const findById = db.prepare('SELECT * FROM beta_codes WHERE id = ?');
  const findAdmission = db.prepare('SELECT code_id, admitted_at FROM beta_admissions WHERE account_id = ?');
  const audit = db.prepare('INSERT INTO beta_audit(code_id, action, actor, at) VALUES (?, ?, ?, ?)');
  const invalidCode = () => { throw new BetaCodeError('Invalid or expired beta code.', 'invalid_code'); };
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    file,
    create({ actor, maxUses = 1, expiresAt, intendedAccount = null }) {
      account(actor);
      if (intendedAccount !== null) account(intendedAccount);
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100 || !Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > now() + 30 * 24 * 60 * 60_000) {
        throw new BetaCodeError('Invalid beta code limits.', 'invalid_input');
      }
      const plaintext = `MM-${randomBytes(24).toString('base64url')}`;
      const id = randomBytes(12).toString('hex');
      transaction(() => {
        db.prepare('INSERT INTO beta_codes(id, code_hash, created_by, created_at, expires_at, max_uses, intended_account) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, hash(plaintext), actor, now(), expiresAt, maxUses, intendedAccount);
        audit.run(id, 'created', actor, now());
      });
      return { id, code: plaintext, expiresAt, maxUses, intendedAccount };
    },
    list() {
      return db.prepare('SELECT id, created_at, expires_at, max_uses, uses, intended_account, revoked_at FROM beta_codes ORDER BY created_at DESC, id DESC LIMIT 100').all();
    },
    recentAudit(limit = 50) {
      return db.prepare('SELECT id, code_id, action, actor, at FROM beta_audit ORDER BY at DESC, id DESC LIMIT ?').all(limit);
    },
    revoke(id, actor) {
      account(actor);
      if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) throw new BetaCodeError('Invalid beta code ID.', 'invalid_input');
      return transaction(() => {
        const row = findById.get(id);
        if (!row) throw new BetaCodeError('Beta code not found.', 'not_found');
        if (row.revoked_at !== null) return false;
        db.prepare('UPDATE beta_codes SET revoked_at = ? WHERE id = ?').run(now(), id);
        audit.run(id, 'revoked', actor, now());
        return true;
      });
    },
    redeem(plaintext, accountId) {
      account(accountId);
      if (typeof plaintext !== 'string' || !codePattern.test(plaintext)) invalidCode();
      return transaction(() => {
        const existing = findAdmission.get(accountId);
        if (existing) return { admitted: true, alreadyAdmitted: true };
        const row = findByHash.get(hash(plaintext));
        if (!row || row.revoked_at !== null || row.expires_at <= now() || row.uses >= row.max_uses || (row.intended_account && row.intended_account !== accountId)) invalidCode();
        db.prepare('INSERT INTO beta_admissions(account_id, code_id, admitted_at) VALUES (?, ?, ?)').run(accountId, row.id, now());
        db.prepare('UPDATE beta_codes SET uses = uses + 1 WHERE id = ?').run(row.id);
        audit.run(row.id, 'redeemed', accountId, now());
        return { admitted: true, alreadyAdmitted: false };
      });
    },
    isAdmitted(accountId) { return Boolean(findAdmission.get(account(accountId))); },
    close() { db.close(); },
  };
}
