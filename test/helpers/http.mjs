import { request } from 'node:http';

// Preserve the supplied Host header when testing against an ephemeral port.
export function send(url, { method = 'GET', headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
