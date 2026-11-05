import { createNameRegistry } from '../server/name-registry.mjs';
import { readConfig } from '../server/config.mjs';
import { requestServiceToken, syncPendingProfiles } from '../server/spacetime-profile-sync.mjs';

const { worldDir } = readConfig();
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
try {
  if (statusOnly) {
    console.log(`Pending wallet profile projections: ${registry.pendingProfileProjectionCount()}.`);
  } else if (registry.pendingProfileProjections(100).length === 0) {
    console.log('No pending wallet profiles.');
  } else {
    const token = await requestServiceToken({ clientId, clientSecret });
    const count = await syncPendingProfiles({ registry, databaseOrigin, databaseName, token });
    console.log(`Acknowledged ${count} wallet profile projections.`);
  }
} finally { registry.close(); }
