// The pinned Luanti build prints its command-line arguments during startup.
// Keep short-lived game credentials out of the browser console while main runs.
export function redactConsoleSecret(target, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Invalid game credential.');
  const original = new Map();
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    if (typeof target[level] !== 'function') continue;
    const method = target[level];
    original.set(level, method);
    target[level] = (...values) => Reflect.apply(method, target,
      values.map(value => typeof value === 'string' ? value.replaceAll(secret, '[redacted]') : value));
  }
  return () => {
    for (const [level, method] of original) target[level] = method;
    secret = '';
  };
}
