import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensNormalize, getAddress } from 'ethers';
import { playerName } from './auth.mjs';

const reserved = new Set(['admin', 'api', 'ens', 'map', 'mine', 'minemine', 'moderator', 'null', 'play', 'root', 'support', 'system', 'wallet']);

export class NameRegistryError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function normalizeHandle(input) {
  if (typeof input !== 'string') throw new NameRegistryError('Invalid MineMine username.', 'invalid_handle');
  const handle = input.toLowerCase();
  if (!/^[a-z][a-z0-9]{2,15}$/.test(handle) || reserved.has(handle)) {
    throw new NameRegistryError('Invalid or reserved MineMine username.', 'invalid_handle');
  }
  return handle;
}

function managedHandle(ensName) {
  const labels = ensName.split('.');
  if (labels.length !== 3 || labels[1] !== 'minemine' || labels[2] !== 'eth') return null;
  return normalizeHandle(labels[0]);
}

function identifier(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new NameRegistryError(`Invalid ${label}.`, 'invalid_input');
  }
  return value;
}

export function createNameRegistry(worldDir, now = Date.now) {
  mkdirSync(worldDir, { recursive: true, mode: 0o700 });
  const directory = path.join(worldDir, 'name_registry');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = path.join(directory, 'registry.sqlite');
  try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!lstatSync(file).isFile()) throw new Error('Name registry path must be a regular file.');
  }
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS names (
      handle TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('admin_reserved', 'checkout_held', 'paid_pending_ens', 'paid_active', 'wallet_claimed')),
      account_id TEXT,
      intended_account_id TEXT,
      order_id TEXT UNIQUE,
      payment_id TEXT UNIQUE,
      ens_name TEXT,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS names_account_unique ON names(account_id) WHERE account_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS name_audit (
      id INTEGER PRIMARY KEY,
      handle TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ens_selections (
      account_id TEXT PRIMARY KEY,
      ens_name TEXT NOT NULL UNIQUE,
      selected_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_profiles (
      player_name TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE,
      first_signed_in_at INTEGER NOT NULL,
      last_signed_in_at INTEGER NOT NULL
    );`);
  // Earlier worlds used a CHECK constraint without paid_active. Rebuild that
  // one table atomically so existing holds, payments, and audit history survive.
  const namesSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'names'").get().sql;
  if (!namesSchema.includes("'paid_active'")) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE names_migrated (
        handle TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('admin_reserved', 'checkout_held', 'paid_pending_ens', 'paid_active', 'wallet_claimed')),
        account_id TEXT,
        intended_account_id TEXT,
        order_id TEXT UNIQUE,
        payment_id TEXT UNIQUE,
        ens_name TEXT,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO names_migrated SELECT * FROM names;
      DROP TABLE names;
      ALTER TABLE names_migrated RENAME TO names;
      CREATE UNIQUE INDEX names_account_unique ON names(account_id) WHERE account_id IS NOT NULL;
      COMMIT;`);
  }
  const find = db.prepare('SELECT * FROM names WHERE handle = ?');
  const byOrder = db.prepare('SELECT * FROM names WHERE order_id = ?');
  const bySelectedEns = db.prepare('SELECT account_id FROM ens_selections WHERE ens_name = ?');
  const addAudit = db.prepare('INSERT INTO name_audit(handle, action, actor, at) VALUES (?, ?, ?, ?)');
  const removeExpiredAdmin = db.prepare("DELETE FROM names WHERE handle = ? AND state = 'admin_reserved' AND expires_at <= ?");
  const addName = db.prepare('INSERT INTO names(handle, state, account_id, intended_account_id, order_id, payment_id, ens_name, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)');
  const replaceName = db.prepare('UPDATE names SET state = ?, account_id = ?, intended_account_id = NULL, order_id = ?, payment_id = NULL, ens_name = ?, expires_at = NULL, updated_at = ? WHERE handle = ?');
  const unavailable = () => { throw new NameRegistryError('MineMine username is unavailable.', 'unavailable'); };
  const conflict = () => { throw new NameRegistryError('Name reservation does not match this account or order.', 'conflict'); };

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
  function current(handle) {
    const row = find.get(handle);
    return row?.state === 'admin_reserved' && row.expires_at <= now() ? null : row || null;
  }
  function availableFor(row, accountId) {
    if (!row) return true;
    return row.state === 'admin_reserved' && row.intended_account_id === accountId;
  }
  function occupy(handle, accountId, state, orderId = null, ensName = null) {
    const selectedBy = bySelectedEns.get(`${handle}.minemine.eth`)?.account_id;
    if (selectedBy && selectedBy !== accountId) unavailable();
    const previous = find.get(handle);
    if (previous?.state === 'admin_reserved' && previous.expires_at <= now()) {
      removeExpiredAdmin.run(handle, now());
      addAudit.run(handle, 'admin_expired', 'system', now());
    }
    const row = current(handle);
    if (!availableFor(row, accountId)) unavailable();
    if (row) replaceName.run(state, accountId, orderId, ensName, now(), handle);
    else addName.run(handle, state, accountId, null, orderId, ensName, null, now());
    addAudit.run(handle, state, accountId, now());
    return current(handle);
  }
  function ensureUniqueAccount(accountId) {
    const row = db.prepare('SELECT handle FROM names WHERE account_id = ?').get(accountId);
    if (row) throw new NameRegistryError('This account already has a MineMine username.', 'account_has_name');
  }

  return {
    file,
    lookup(input) { return current(normalizeHandle(input)); },
    managedNameForAccount(accountId) {
      identifier(accountId, 'account');
      return db.prepare("SELECT ens_name FROM names WHERE account_id = ? AND state = 'paid_active'").get(accountId)?.ens_name || null;
    },
    adminReservations() {
      return db.prepare("SELECT handle, intended_account_id, expires_at FROM names WHERE state = 'admin_reserved' AND expires_at > ? ORDER BY updated_at DESC LIMIT 100").all(now());
    },
    recentAudit(limit = 50) {
      return db.prepare('SELECT id, handle, action, actor, at FROM name_audit ORDER BY at DESC, id DESC LIMIT ?').all(limit);
    },
    recordWalletSignIn(session) {
      let accountId;
      try { accountId = getAddress(session?.address).toLowerCase(); }
      catch { throw new NameRegistryError('Invalid wallet profile address.', 'invalid_input'); }
      if (session.playerName !== playerName(accountId)) {
        throw new NameRegistryError('Wallet profile and character do not match.', 'conflict');
      }
      return transaction(() => {
        const existing = db.prepare('SELECT account_id FROM wallet_profiles WHERE player_name = ?').get(session.playerName);
        if (existing && existing.account_id !== accountId) {
          throw new NameRegistryError('Player ID collision; refusing to overwrite identity.', 'conflict');
        }
        const at = now();
        db.prepare(`INSERT INTO wallet_profiles(player_name, account_id, first_signed_in_at, last_signed_in_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(player_name) DO UPDATE SET last_signed_in_at = excluded.last_signed_in_at`)
          .run(session.playerName, accountId, at, at);
        return this.walletProfile(session.playerName);
      });
    },
    walletProfile(name) {
      if (typeof name !== 'string' || !/^w_[a-f0-9]{17}$/.test(name)) {
        throw new NameRegistryError('Invalid player ID.', 'invalid_input');
      }
      const row = db.prepare('SELECT player_name, account_id, first_signed_in_at, last_signed_in_at FROM wallet_profiles WHERE player_name = ?').get(name);
      return row ? { playerName: row.player_name, address: row.account_id,
        firstSignedInAt: new Date(row.first_signed_in_at).toISOString(),
        lastSignedInAt: new Date(row.last_signed_in_at).toISOString() } : null;
    },
    selectedEns(accountId) {
      return db.prepare('SELECT ens_name FROM ens_selections WHERE account_id = ?').get(identifier(accountId, 'account'))?.ens_name || null;
    },
    ensNameAllowed(accountId, ensName) {
      identifier(accountId, 'account');
      let handle;
      try { handle = managedHandle(ensNormalize(ensName)); }
      catch { return false; }
      if (!handle) return true;
      const row = current(handle);
      return !row || row.account_id === accountId ||
        (row.state === 'admin_reserved' && row.intended_account_id === accountId);
    },
    selectEns(accountId, ensName) {
      identifier(accountId, 'account');
      if (typeof ensName !== 'string' || ensName.length > 255 || ensName !== ensName.trim() || !ensName.includes('.')) {
        throw new NameRegistryError('Invalid ENS name.', 'invalid_input');
      }
      try { ensName = ensNormalize(ensName); }
      catch { throw new NameRegistryError('Invalid ENS name.', 'invalid_input'); }
      return transaction(() => {
        if (!this.ensNameAllowed(accountId, ensName)) unavailable();
        const previous = db.prepare('SELECT ens_name FROM ens_selections WHERE account_id = ?').get(accountId)?.ens_name;
        if (previous === ensName) return ensName;
        if (previous) {
          db.prepare('DELETE FROM ens_selections WHERE account_id = ?').run(accountId);
          addAudit.run(previous, 'ens_replaced', accountId, now());
        }
        const priorOwner = db.prepare('SELECT account_id FROM ens_selections WHERE ens_name = ?').get(ensName)?.account_id;
        if (priorOwner) {
          db.prepare('DELETE FROM ens_selections WHERE ens_name = ?').run(ensName);
          addAudit.run(ensName, 'ens_reassigned', accountId, now());
        }
        db.prepare('INSERT INTO ens_selections(account_id, ens_name, selected_at) VALUES (?, ?, ?)').run(accountId, ensName, now());
        addAudit.run(ensName, 'ens_selected', accountId, now());
        return ensName;
      });
    },
    clearSelectedEns(accountId, expectedName = null) {
      identifier(accountId, 'account');
      return transaction(() => {
        const selected = db.prepare('SELECT ens_name FROM ens_selections WHERE account_id = ?').get(accountId)?.ens_name;
        if (!selected || (expectedName !== null && selected !== expectedName)) return false;
        db.prepare('DELETE FROM ens_selections WHERE account_id = ?').run(accountId);
        addAudit.run(selected, 'ens_cleared', accountId, now());
        return true;
      });
    },
    reserveAdmin(input, actor, intendedAccountId, expiresAt) {
      const handle = normalizeHandle(input);
      identifier(actor, 'admin actor');
      if (intendedAccountId !== null) identifier(intendedAccountId, 'intended account');
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new NameRegistryError('Invalid reservation expiry.', 'invalid_input');
      return transaction(() => {
        if (current(handle)) unavailable();
        if (bySelectedEns.get(`${handle}.minemine.eth`)) unavailable();
        removeExpiredAdmin.run(handle, now());
        addName.run(handle, 'admin_reserved', null, intendedAccountId, null, null, expiresAt, now());
        addAudit.run(handle, 'admin_reserved', actor, now());
        return current(handle);
      });
    },
    releaseAdmin(input, actor) {
      const handle = normalizeHandle(input);
      identifier(actor, 'admin actor');
      return transaction(() => {
        const row = current(handle);
        if (!row || row.state !== 'admin_reserved') conflict();
        db.prepare("DELETE FROM names WHERE handle = ? AND state = 'admin_reserved'").run(handle);
        addAudit.run(handle, 'admin_released', actor, now());
        return true;
      });
    },
    beginCheckout(input, accountId, orderId) {
      const handle = normalizeHandle(input);
      identifier(accountId, 'account');
      identifier(orderId, 'order');
      return transaction(() => {
        const existing = byOrder.get(orderId);
        if (existing) {
          if (existing.handle === handle && existing.account_id === accountId) return existing;
          conflict();
        }
        ensureUniqueAccount(accountId);
        return occupy(handle, accountId, 'checkout_held', orderId);
      });
    },
    markPaid(input, accountId, orderId, paymentId) {
      const handle = normalizeHandle(input);
      identifier(accountId, 'account');
      identifier(orderId, 'order');
      identifier(paymentId, 'payment');
      return transaction(() => {
        const row = find.get(handle);
        if (!row || row.account_id !== accountId || row.order_id !== orderId) conflict();
        if (['paid_pending_ens', 'paid_active'].includes(row.state) && row.payment_id === paymentId) return row;
        if (row.state !== 'checkout_held') conflict();
        db.prepare("UPDATE names SET state = 'paid_pending_ens', payment_id = ?, updated_at = ? WHERE handle = ?").run(paymentId, now(), handle);
        addAudit.run(handle, 'paid_pending_ens', accountId, now());
        return current(handle);
      });
    },
    // The caller supplies an authoritative mainnet ENS resolver. Its result is
    // checked again before every display, so later record changes fail closed.
    async activateManagedName(input, accountId, orderId, paymentId, resolveAddress) {
      const handle = normalizeHandle(input);
      identifier(orderId, 'order');
      identifier(paymentId, 'payment');
      let target;
      try { target = getAddress(accountId).toLowerCase(); }
      catch { throw new NameRegistryError('Invalid managed-name wallet.', 'invalid_input'); }
      if (target !== accountId || typeof resolveAddress !== 'function') {
        throw new NameRegistryError('Invalid managed-name activation.', 'invalid_input');
      }
      const ensName = `${handle}.minemine.eth`;
      let resolved;
      try { resolved = getAddress(await resolveAddress(ensName)).toLowerCase(); }
      catch { throw new NameRegistryError('Managed ENS name could not be verified.', 'ens_unverified'); }
      if (resolved !== target) throw new NameRegistryError('Managed ENS name points to another wallet.', 'ens_unverified');
      return transaction(() => {
        const row = find.get(handle);
        if (!row || row.account_id !== accountId || row.order_id !== orderId || row.payment_id !== paymentId ||
            !['paid_pending_ens', 'paid_active'].includes(row.state)) conflict();
        if (row.state === 'paid_active') return row;
        db.prepare("UPDATE names SET state = 'paid_active', ens_name = ?, updated_at = ? WHERE handle = ?")
          .run(ensName, now(), handle);
        addAudit.run(handle, 'paid_active', accountId, now());
        return current(handle);
      });
    },
    // Call only after the payment provider confirms the session cannot complete.
    releaseCheckout(input, accountId, orderId) {
      const handle = normalizeHandle(input);
      identifier(accountId, 'account');
      identifier(orderId, 'order');
      return transaction(() => {
        const row = find.get(handle);
        if (!row) return false;
        if (row.state !== 'checkout_held' || row.account_id !== accountId || row.order_id !== orderId) conflict();
        db.prepare('DELETE FROM names WHERE handle = ?').run(handle);
        addAudit.run(handle, 'checkout_released', accountId, now());
        return true;
      });
    },
    // The caller must prove current ENS ownership before binding this alias.
    claimVerifiedEns(input, accountId, ensName) {
      const handle = normalizeHandle(input);
      identifier(accountId, 'account');
      identifier(ensName, 'verified ENS name');
      try { ensName = ensNormalize(ensName); }
      catch { throw new NameRegistryError('Invalid ENS name.', 'invalid_input'); }
      return transaction(() => {
        const existing = current(handle);
        if (existing?.state === 'wallet_claimed' && existing.account_id === accountId && existing.ens_name === ensName) return existing;
        ensureUniqueAccount(accountId);
        return occupy(handle, accountId, 'wallet_claimed', null, ensName);
      });
    },
    close() { db.close(); },
  };
}
