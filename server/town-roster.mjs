import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const playerId = /^w_[a-f0-9]{17}$/;
const townName = /^[A-Za-z0-9 _-]{3,24}$/;
const fileName = 'town-admin-roster.json';

// Only the admin profile API calls this reader. It returns an allowlisted
// summary instead of forwarding the private roster to a browser.
export function townMembership(worldDir, playerName) {
  try {
    if (!playerId.test(playerName)) throw new Error('Invalid player ID.');
    const file = path.join(worldDir, fileName);
    const info = statSync(file);
    if (!info.isFile() || info.size > 1_048_576) throw new Error('Invalid roster size.');
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.towns) || snapshot.towns.length > 128) throw new Error('Invalid roster.');
    const seen = new Set();
    let result = null;
    for (const town of snapshot.towns) {
      if (!playerId.test(town?.owner) || !townName.test(town.name) || !Array.isArray(town.members) ||
          !Number.isSafeInteger(town.claims) || town.claims < 0 || town.claims > 256 ||
          !Number.isSafeInteger(town.protectedColumns) || town.protectedColumns < 0 || town.protectedColumns > 278_784) {
        throw new Error('Invalid town.');
      }
      if (seen.has(town.owner)) throw new Error('Duplicate player.');
      seen.add(town.owner);
      for (const member of town.members) {
        if (!playerId.test(member) || seen.has(member)) throw new Error('Invalid member.');
        seen.add(member);
      }
      if (town.owner === playerName || town.members.includes(playerName)) {
        result = { name: town.name, role: town.owner === playerName ? 'owner' : 'member', owner: town.owner,
          memberCount: town.members.length, claimCount: town.claims, protectedColumns: town.protectedColumns };
      }
    }
    return { status: result ? 'present' : 'none', town: result, snapshotAt: info.mtime.toISOString() };
  } catch {
    return { status: 'unavailable', town: null, snapshotAt: null };
  }
}
