// Preload for `next dev` on Windows: point the resolver at Google DNS so the
// mongodb+srv:// SRV lookup succeeds (matches MONGODB_DNS_SERVERS in .env.local).
// Loaded via NODE_OPTIONS=--require ./scripts/dns-preload.cjs
const dns = require('node:dns');
const servers = (process.env.MONGODB_DNS_SERVERS || '8.8.8.8,8.8.4.4')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
try {
  dns.setServers(servers);
} catch {
  // best effort
}
