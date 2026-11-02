const fields = ['town', 'x1', 'x2', 'z1', 'z2'];

export function validateClaims(input) {
  if (!Array.isArray(input) || input.length > 1024) throw new Error('Town claim snapshot is invalid.');
  return input.map(claim => {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
        Object.keys(claim).sort().join(',') !== [...fields].sort().join(',') ||
        typeof claim.town !== 'string' || !/^[A-Za-z0-9 _-]{3,24}$/.test(claim.town)) throw new Error('Town claim snapshot is invalid.');
    for (const coordinate of fields.slice(1)) {
      if (!Number.isInteger(claim[coordinate]) || Math.abs(claim[coordinate]) > 30927) throw new Error('Town claim snapshot is invalid.');
    }
    if (claim.x1 > claim.x2 || claim.z1 > claim.z2 || claim.x2 - claim.x1 > 32 || claim.z2 - claim.z1 > 32) throw new Error('Town claim snapshot is invalid.');
    return { town: claim.town, x1: claim.x1, x2: claim.x2, z1: claim.z1, z2: claim.z2 };
  });
}
