import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const playerName = (address) => `w_${digest(getAddress(address).toLowerCase()).slice(0, 18)}`;
const random = () => randomBytes(32).toString('hex');
export class AuthError extends Error {
  constructor(message, status = 401) { super(message); this.status = status; }
}

// Exact, server-generated SIWE messages: clients cannot supply a different domain,
// URI, chain, nonce, issue time, or expiry. EOA accounts only in this milestone.
export function createAuth({ origin, chainId, now = Date.now, capacity = 10_000 }) {
  const challenges = new Map();
  const sessions = new Map();
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
      const message = `${url.protocol}//${url.host} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Miners. This does not authorize a transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
      challenges.set(digest(token), { address, message, expiresAt });
      return { token, message, expiresAt };
    },
    verify(token, signature) {
      clean();
      const key = digest(token || '');
      const challenge = challenges.get(key);
      // Consume before signature verification; failed signatures need a new challenge.
      challenges.delete(key);
      if (!challenge) throw new AuthError('Sign-in expired or already used. Please try again.');
      let recovered;
      try { recovered = verifyMessage(challenge.message, signature); } catch { throw new AuthError('Invalid wallet signature.'); }
      if (recovered !== challenge.address) throw new AuthError('Signature does not match the requested wallet.');
      if (sessions.size >= capacity) throw new AuthError('Session capacity reached.', 503);
      const sessionToken = random();
      const session = { address: challenge.address, playerName: playerName(challenge.address), expiresAt: now() + sessionTTL };
      sessions.set(digest(sessionToken), session);
      return { token: sessionToken, session };
    },
    get(token) { clean(); return token ? sessions.get(digest(token)) : undefined; },
    revoke(token) { if (token) sessions.delete(digest(token)); },
    cancel(token) { if (token) challenges.delete(digest(token)); },
  };
}
