const defaultTokenUrl = 'https://auth.spacetimedb.com/oidc/token';

function normalizedAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
}

function endpoint(input, allowLoopback = false) {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Profile sync requires an HTTPS endpoint.');
  }
  return url;
}

export async function requestServiceToken({ clientId, clientSecret, tokenUrl = defaultTokenUrl,
  fetchImpl = fetch, allowLoopback = false }) {
  if (!clientId || !clientSecret || /[:\r\n]/.test(clientId) || /[\r\n]/.test(clientSecret)) {
    throw new Error('Profile sync requires a service client ID and secret.');
  }
  const url = endpoint(tokenUrl, allowLoopback);
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Service token request failed (HTTP ${response.status}).`);
  const result = await response.json();
  if (typeof result.access_token !== 'string' || result.access_token.split('.').length !== 3) {
    throw new Error('Service token response did not contain a JWT access token.');
  }
  return result.access_token;
}

export function createProfileDisplayVerifier({ registry, ensResolver, ensOwnership }) {
  return async row => {
    if (row.displayName === row.playerId) return true;
    if (!ensResolver || !ensOwnership) return false;
    const managed = registry.managedNameForAccount(row.accountId);
    if (managed === row.displayName) {
      try {
        const resolved = await ensResolver.recipient(managed);
        return normalizedAddress(resolved.address) === row.accountId;
      } catch { return false; }
    }
    try {
      const verified = await ensOwnership.verify(row.displayName, row.accountId);
      return verified.name === row.displayName;
    } catch { return false; }
  };
}

export async function syncPendingProfiles({ registry, databaseOrigin, databaseName, token,
  fetchImpl = fetch, allowLoopback = false, batchSize = 100, verifyDisplay }) {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(databaseName || '')) throw new Error('Invalid SpacetimeDB database name.');
  if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error('Profile sync requires a JWT token.');
  const base = endpoint(databaseOrigin, allowLoopback);
  if (base.pathname !== '/') throw new Error('SpacetimeDB origin must not have a path.');
  const rows = registry.pendingProfileProjections(batchSize);
  const url = new URL(`/v1/database/${databaseName}/call/upsert_profile`, base);
  url.searchParams.set('confirmed', 'true');
  let acknowledged = 0;
  for (const row of rows) {
    let projection = row;
    if (row.displayName !== row.playerId) {
      if (typeof verifyDisplay !== 'function') {
        throw new Error('ENS profile projection requires a live ownership verifier.');
      }
      let verified = false;
      try { verified = await verifyDisplay(row) === true; }
      catch { /* A failed ownership lookup cannot authorize a public display. */ }
      if (!verified) {
        const revision = registry.recordVerifiedProfileDisplay(row.accountId, row.playerId, row.playerId);
        if (!Number.isSafeInteger(revision) || revision <= row.revision) {
          throw new Error('Could not queue the stable character ID after ENS verification failed.');
        }
        projection = { ...row, displayName: row.playerId, revision };
      }
    }
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([projection.accountId, projection.playerId, projection.displayName, projection.revision]),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Profile projection failed (HTTP ${response.status}).`);
    if (registry.acknowledgeProfileProjection(projection.accountId, projection.revision)) acknowledged++;
  }
  return acknowledged;
}
