export function validateSpawn(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'x,z' ||
      !Number.isInteger(value.x) || !Number.isInteger(value.z) ||
      Math.abs(value.x) > 30927 || Math.abs(value.z) > 30927) {
    throw new Error('Invalid world spawn coordinates.');
  }
  return value;
}
