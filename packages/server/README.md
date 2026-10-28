# @ripen/server

Self-hosted Ripen server: the HTTP API on `node:http` with SQLite from `node:sqlite`. No runtime dependencies. Node.js 22.13+.

```bash
RIPEN_CLIENT_KEY=... RIPEN_ADMIN_TOKEN=... npx ripen-server      # http://127.0.0.1:4747
```

Configuration, Docker, TLS, backups and security: [Self-hosting](https://github.com/userTrv/ripen/blob/main/docs/guide/self-hosting.md). Endpoints: [specification](https://github.com/userTrv/ripen/blob/main/docs/spec.md).

## As a library

```ts
import { createRipenServer, Service, Store } from '@ripen/server';
import { DEFAULT_CONFIG } from '@ripen/core';

const server = createRipenServer(new Service(DEFAULT_CONFIG, new Store('ripen.db')), {
  clientKey, adminToken, corsOrigins: ['https://app.example.com'],
});
server.listen(4747);
```

`@ripen/server/engine` has no Node.js imports: the service, the API as a function (`createApi(service, options)(request)`) and `MemoryStore`. Use it in edge runtimes, tests or a browser.

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.
