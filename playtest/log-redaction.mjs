// The pinned Luanti build prints its command-line arguments during startup.
// Keep short-lived game credentials out of the browser console while main runs.
export function installConsoleRedactor(target) {
  let secret = '';
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    if (typeof target[level] !== 'function') continue;
    const method = target[level];
    target[level] = (...values) => Reflect.apply(method, target,
      values.map(value => secret && typeof value === 'string' ? value.replaceAll(secret, '[redacted]') : value));
  }
  return {
    set(value) {
      if (typeof value !== 'string' || value.length < 32) throw new Error('Invalid game credential.');
      secret = value;
    },
    clear() { secret = ''; },
  };
}
