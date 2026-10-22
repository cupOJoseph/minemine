import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

// Pinned webshims/src/emsocket/proxy.js speaks this 24-byte UDP envelope.
const MAGIC = 0x778b4cf6;
const HEADER = 24;
const MAX_FRAME = HEADER + 65507;
const ASSIGNMENT_MS = 5 * 60_000;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_CONNECTIONS = 64;
const MAX_INGRESS_PACKETS_PER_SECOND = 8192;
const MAX_INGRESS_BYTES_PER_SECOND = 2 * 1024 * 1024;
// The browser's virtual destination is distinct from the private UDP target.
// Webshims handles 127.0.0.1 within the browser and never sends it to us.
const VIRTUAL_GAME_ADDRESS = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 10, 0, 0, 1]);

function deny(socket, status) {
  socket.end(`HTTP/1.1 ${status} ${status === 503 ? 'Service Unavailable' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function attachGameProxy(server, config, tokenFromRequest, activeToken) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  const assignments = new Map();
  const connections = new Map();
  const tokens = new WeakMap();
  let addressId = 0;
  let closed = false;

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, config.origin).pathname; } catch { return deny(socket, 403); }
    if (pathname !== '/game-proxy' || request.url !== pathname || !config.gameEnabled) return deny(socket, config.gameEnabled ? 403 : 503);
    if (request.headers.host !== new URL(config.origin).host || request.headers.origin !== config.origin) return deny(socket, 403);
    const token = tokenFromRequest(request);
    if (!token || !activeToken(token)) return deny(socket, 403);
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, token));
  });

  wss.on('connection', (ws, token) => {
    tokens.set(ws, token);
    let bound = null;
    let udp = null;
    let udpReady = false;
    let lastPong = Date.now();
    let trafficWindow = Date.now();
    let trafficPackets = 0;
    let trafficBytes = 0;
    const peers = connections.get(token) || new Set();
    if (peers.size >= 16 || wss.clients.size > MAX_CONNECTIONS) return ws.close(1008, 'Too many game connections');
    peers.add(ws);
    connections.set(token, peers);
    ws.on('pong', () => { lastPong = Date.now(); });
    ws.on('message', (message, binary) => {
      if (!activeToken(token)) return ws.close(1008, 'Session ended');
      if (!bound) {
        if (binary) return ws.close(1003, 'Expected command');
        const command = message.toString('utf8');
        if (command === 'NEWADDR') {
          for (const [code, item] of assignments) if (!item.links.size && item.expiresAt < Date.now()) assignments.delete(code);
          if ([...assignments.values()].filter(item => item.token === token).length >= 4 || assignments.size >= 256) return ws.close(1008, 'Address limit');
          addressId = (addressId % 0xffff) + 1;
          const address = `fd00::${addressId.toString(16)}`;
          const passcode = randomBytes(24).toString('hex').toUpperCase();
          assignments.set(passcode, { token, address, expiresAt: Date.now() + ASSIGNMENT_MS, links: new Set() });
          ws.send(`ADDR ${address} ${passcode} ${randomBytes(6).toString('hex').toUpperCase()}`);
          return;
        }
        const match = /^BIND ([0-9A-F]{48}) UDP ([0-9]{1,5})$/.exec(command);
        if (!match) return ws.close(1008, 'Unsupported proxy command');
        const assignment = assignments.get(match[1]);
        const port = Number(match[2]);
        if (!assignment || assignment.token !== token || (assignment.expiresAt < Date.now() && !assignment.links.size) || port < 1 || port > 65535 || assignment.links.size >= 8) {
          ws.send('BIND FAILED');
          return;
        }
        bound = assignment;
        assignment.links.add(ws);
        udp = dgram.createSocket('udp4');
        udp.on('error', () => ws.close(1011, 'Game socket error'));
        udp.on('message', packet => {
          if (ws.readyState !== WebSocket.OPEN || packet.length > 65507) return;
          if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return ws.close(1009, 'Slow game connection');
          const frame = Buffer.allocUnsafe(HEADER + packet.length);
          frame.writeUInt32BE(MAGIC, 0);
          VIRTUAL_GAME_ADDRESS.copy(frame, 4);
          frame.writeUInt16BE(config.gamePort, 20);
          frame.writeUInt16BE(packet.length, 22);
          packet.copy(frame, HEADER);
          ws.send(frame, { binary: true });
        });
        udp.connect(config.gamePort, '127.0.0.1', error => {
          if (error) return ws.close(1011, 'Game server unavailable');
          udpReady = true;
          if (ws.readyState === WebSocket.OPEN) ws.send('BIND OK');
        });
        return;
      }
      if (!binary || message.length < HEADER || message.length > MAX_FRAME || message.readUInt32BE(0) !== MAGIC ||
          !message.subarray(4, 20).equals(VIRTUAL_GAME_ADDRESS) || message.readUInt16BE(20) !== config.gamePort ||
          message.readUInt16BE(22) !== message.length - HEADER) return ws.close(1008, 'Invalid game destination');
      if (!udpReady) return ws.close(1008, 'Game socket is not ready');
      if (Date.now() - trafficWindow >= 1000) { trafficWindow = Date.now(); trafficPackets = 0; trafficBytes = 0; }
      trafficPackets++;
      trafficBytes += message.length;
      if (trafficPackets > MAX_INGRESS_PACKETS_PER_SECOND || trafficBytes > MAX_INGRESS_BYTES_PER_SECOND) return ws.close(1008, 'Game traffic limit');
      udp.send(message.subarray(HEADER));
    });
    ws.on('close', (code, reason) => {
      if (process.env.DEBUG_GAME_PROXY === 'true') console.log('Game proxy link closed:', { code, reason: reason.toString(), bound: Boolean(bound), bufferedBytes: ws.bufferedAmount, ingressPackets: trafficPackets, ingressBytes: trafficBytes });
      peers.delete(ws);
      if (!peers.size) connections.delete(token);
      if (udp) udp.close();
      if (bound) {
        bound.links.delete(ws);
        if (!bound.links.size) for (const [code, item] of assignments) if (item === bound) assignments.delete(code);
      }
    });
    ws.on('error', () => ws.terminate());
    ws.isAlive = () => Date.now() - lastPong < 90_000;
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!activeToken(tokens.get(ws))) ws.close(1008, 'Session ended');
      else if (!ws.isAlive()) ws.terminate();
      else ws.ping();
    }
    for (const [code, item] of assignments) if (!item.links.size && item.expiresAt < Date.now()) assignments.delete(code);
  }, 30_000);
  heartbeat.unref();

  return {
    revoke(token) {
      for (const ws of connections.get(token) || []) ws.close(1008, 'Session ended');
      for (const [code, item] of assignments) if (item.token === token) assignments.delete(code);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
