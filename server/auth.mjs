import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { createSmartSignatureVerifier } from './smart-signatures.mjs';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
// The pinned browser client accepts at most 19 characters (PLAYERNAME_SIZE - 1).
export const playerName = (address) => `w_${digest(getAddress(address).toLowerCase()).slice(0, 17)}`;
const random = () => randomBytes(32).toString('hex');
export class AuthError extends Error {
  constructor(message, status = 401) { super(message); this.status = status; }
}

// Exact, server-generated SIWE messages: clients cannot supply a different domain,
// URI, chain, nonce, issue time, or expiry.
export function createAuth({ origin, chainId, rpcUrl, smartVerifier, now = Date.now, capacity = 10_000 }) {
  const verifySmart = smartVerifier || createSmartSignatureVerifier({ chainId, rpcUrl });
  const challenges = new Map();
  const sessions = new Map();
  let smartChecks = 0;
  const challengeTTL = 5 * 60_000;
  const sessionTTL = 12 * 60 * 60_000;
  const clean = () => {
    for (const map of [challenges, sessions]) {
      for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key);
    }
  };
  return {
    issue(address, requestedChain, previousChallenge) {
      clean();
      if (requestedChain !== chainId) throw new AuthError('Switch your wallet to the configured test network.', 400);
      try { address = getAddress(address); } catch { throw new AuthError('Invalid Ethereum address.', 400); }
      if (previousChallenge) challenges.delete(digest(previousChallenge));
      if (challenges.size >= capacity) throw new AuthError('Sign-in capacity reached. Try again shortly.', 503);
      const token = random();
      const nonce = randomBytes(16).toString('hex');
      const issuedAt = new Date(now()).toISOString();
      const expiresAt = now() + challengeTTL;
      const url = new URL(origin);
      const message = `${url.protocol}//${url.host} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to MineMine. This does not authorize a transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
      challenges.set(digest(token), { address, message, expiresAt });
      return { token, message, expiresAt };
    },
    async verify(token, signature) {
      clean();
      const key = digest(token || '');
      const challenge = challenges.get(key);
      // Consume before signature verification; failed signatures need a new challenge.
      challenges.delete(key);
      if (!challenge) throw new AuthError('Sign-in expired or already used. Please try again.');
      if (typeof signature !== 'string' || signature.length < 4 || signature.length > 8000 ||
          signature.length % 2 !== 0 || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new AuthError('Invalid wallet signature.');
      let recovered;
      try { recovered = verifyMessage(challenge.message, signature); } catch { /* Smart signatures are not recoverable as EOAs. */ }
      if (recovered !== challenge.address) {
        if (!verifySmart) throw new AuthError('Signature does not match the requested wallet.');
        if (smartChecks >= 32) throw new AuthError('Smart-wallet verification is busy. Try again shortly.', 503);
        let valid;
        smartChecks++;
        try { valid = await verifySmart({ address: challenge.address, message: challenge.message, signature }); }
        catch { throw new AuthError('Smart-wallet verification is temporarily unavailable.', 503); }
        finally { smartChecks--; }
        if (!valid) throw new AuthError('Signature does not match the requested wallet.');
      }
      if (challenge.expiresAt <= now()) throw new AuthError('Sign-in expired or already used. Please try again.');
      if (sessions.size >= capacity) throw new AuthError('Session capacity reached.', 503);
      const sessionToken = random();
      const session = { address: challenge.address, playerName: playerName(challenge.address), authenticatedAt: now(), expiresAt: now() + sessionTTL };
      sessions.set(digest(sessionToken), session);
      return { token: sessionToken, session };
    },
    get(token) { clean(); return token ? sessions.get(digest(token)) : undefined; },
    revoke(token) { if (token) sessions.delete(digest(token)); },
    cancel(token) { if (token) challenges.delete(digest(token)); },
  };
}
