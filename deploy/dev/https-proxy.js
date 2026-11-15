// Dev-only HTTPS front of the server (production: Nginx, 11-operations/deployment.md). No dependencies.
// The agent enrolls only over HTTPS checked against the CA (D-014.3), so the dev server needs one in front of it.
// Uses the broker certificate of gen-dev-certs.sh (SAN localhost, 127.0.0.1, 10.0.2.2).
//   node deploy/dev/https-proxy.js        HTTPS 127.0.0.1:8443 -> HTTP 127.0.0.1:8000
// A VirtualBox NAT guest reaches it at https://10.0.2.2:8443 (10.0.2.2 maps to this host's loopback).
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const certs = path.join(__dirname, 'certs');
const listenPort = Number(process.env.HTTPS_PORT || 8443);
const target = { host: '127.0.0.1', port: Number(process.env.SERVER_PORT || 8000) };

const server = https.createServer(
  { cert: fs.readFileSync(path.join(certs, 'broker.crt')), key: fs.readFileSync(path.join(certs, 'broker.key')) },
  (req, res) => {
    const upstream = http.request(
      { ...target, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress } },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`server not reachable: ${err.message}\n`);
    });
    req.pipe(upstream);
  },
);
server.listen(listenPort, '127.0.0.1', () => console.log(`https://127.0.0.1:${listenPort} -> http://${target.host}:${target.port}`));
