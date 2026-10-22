export function makeRemoteArgs(ticket, LuantiArgs, now = Date.now()) {
  if (!ticket || !/^w_[0-9a-f]{17}$/.test(ticket.name) || typeof ticket.password !== 'string' || ticket.password.length < 32 ||
      ticket.address !== '127.0.0.1' || !Number.isInteger(ticket.port) || ticket.port < 1 || ticket.port > 65535 ||
      !Number.isSafeInteger(ticket.expiresAt) || ticket.expiresAt <= now) throw new Error('Game ticket is invalid or expired. Request a new one.');
  const args = new LuantiArgs();
  args.go = true;
  args.name = ticket.name;
  args.password = ticket.password;
  args.address = ticket.address;
  args.port = ticket.port;
  args.gameid = 'minetest';
  return args;
}

export function sameOriginProxyUrl(origin) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid game origin.');
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/game-proxy`;
}
