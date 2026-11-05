import { createNameRegistry } from '../server/name-registry.mjs';
import { readConfig } from '../server/config.mjs';
import { createEnsResolver } from '../server/ens.mjs';
import { createEnsOwnership } from '../server/ens-ownership.mjs';
import { createProfileDisplayVerifier, revalidateAcknowledgedProfiles, requestServiceToken, syncPendingProfiles } from '../server/spacetime-profile-sync.mjs';

const { worldDir, ensRpcUrl } = readConfig();
const statusOnly = process.argv.length === 3 && process.argv[2] === '--status';
if (!statusOnly && process.argv.length !== 2) throw new Error('Usage: sync-spacetime-profiles.mjs [--status]');
const databaseOrigin = process.env.SPACETIME_DB_ORIGIN;
const databaseName = process.env.SPACETIME_DB_NAME;
const clientId = process.env.SPACETIME_AUTH_CLIENT_ID;
const clientSecret = process.env.SPACETIME_AUTH_CLIENT_SECRET;
if (!statusOnly && (!databaseOrigin || !databaseName || !clientId || !clientSecret)) {
  throw new Error('Set SPACETIME_DB_ORIGIN, SPACETIME_DB_NAME, SPACETIME_AUTH_CLIENT_ID and SPACETIME_AUTH_CLIENT_SECRET.');
}
const registry = createNameRegistry(worldDir);
let ensResolver;
try {
  if (statusOnly) {
    console.log(`Pending wallet profile projections: ${registry.pendingProfileProjectionCount()}.`);
  } else {
    ensResolver = createEnsResolver(ensRpcUrl);
    const ensOwnership = createEnsOwnership(ensRpcUrl);
    const verifyDisplay = createProfileDisplayVerifier({ registry, ensResolver, ensOwnership });
    const rechecked = await revalidateAcknowledgedProfiles({ registry, verifyDisplay });
    if (registry.pendingProfileProjections(100).length === 0) {
      console.log(`No pending wallet profiles; rechecked ${rechecked.checked} published names (${rechecked.fallbackQueued} fallbacks).`);
    } else {
      const token = await requestServiceToken({ clientId, clientSecret });
      const count = await syncPendingProfiles({ registry, databaseOrigin, databaseName, token, verifyDisplay });
      console.log(`Acknowledged ${count} wallet profile projections; rechecked ${rechecked.checked} published names (${rechecked.fallbackQueued} fallbacks).`);
    }
  }
} finally { ensResolver?.close(); registry.close(); }
