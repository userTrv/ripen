#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, parseConfig, type RipenConfig } from '@ripen/core';
import { createRipenServer } from './http.ts';
import { Service } from './service.ts';
import { Store } from './store.ts';

/**
 * Configuration comes from environment variables, never from command-line
 * arguments, so secrets do not end up in the process list or shell history.
 */
const env = process.env;

const clientKey = requireSecret('RIPEN_CLIENT_KEY');
const adminToken = requireSecret('RIPEN_ADMIN_TOKEN');
const config = loadConfig(env['RIPEN_CONFIG'] ?? 'ripen.config.json');
const store = new Store(env['RIPEN_DB'] ?? 'ripen.db');
const service = new Service(config, store);

const server = createRipenServer(service, {
  clientKey,
  adminToken,
  corsOrigins: (env['RIPEN_CORS_ORIGINS'] ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  ...(env['RIPEN_DASHBOARD_DIR'] ? { dashboardDir: env['RIPEN_DASHBOARD_DIR'] } : {}),
});

// Optional retention: events older than this many days are deleted at start and daily.
const retentionDays = env['RIPEN_RETENTION_DAYS'];
if (retentionDays !== undefined) {
  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1) {
    console.error('RIPEN_RETENTION_DAYS must be a whole number of days, at least 1');
    process.exit(1);
  }
  const purge = () => {
    const deleted = service.purgeOlderThan(days);
    if (deleted > 0) console.log(`retention: deleted ${deleted} events older than ${days} days`);
  };
  purge();
  setInterval(purge, 24 * 60 * 60 * 1000).unref();
}

const port = Number(env['PORT'] ?? 4747);
const host = env['HOST'] ?? '127.0.0.1';
server.listen(port, host, () => {
  console.log(`ripen server on http://${host}:${port}, channels: ${config.channels.map((c) => c.id).join(' → ')}`);
  if (env['RIPEN_DASHBOARD_DIR']) console.log(`dashboard on http://${host}:${port}/dashboard/`);
});

// Stop accepting connections, let requests in flight finish, drop idle keep-alive
// connections (they would otherwise hold the shutdown open) and give up after 5 s.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      server.closeAllConnections();
      store.close();
      process.exit(0);
    }, 5000).unref();
  });
}

function loadConfig(path: string): RipenConfig {
  if (!existsSync(path)) {
    console.log(`${path} not found, using the default channels`);
    return DEFAULT_CONFIG;
  }
  try {
    return parseConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    console.error(`${path}: ${(error as Error).message}`);
    process.exit(1);
  }
}

function requireSecret(name: string): string {
  const value = env[name];
  if (!value || value.length < 16) {
    console.error(`${name} must be set to at least 16 characters`);
    process.exit(1);
  }
  return value;
}
