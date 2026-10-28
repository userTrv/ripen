# Ripen server image. Base image pinned by digest; see CLAUDE.md, "Зависимости".
# node:22.23.3-alpine, published 2026-09-23.
ARG NODE_IMAGE=node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS build
WORKDIR /src
# pnpm comes from packageManager in package.json, verified by its hash.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY packages/elements/package.json packages/elements/
COPY packages/cli/package.json packages/cli/
COPY packages/openfeature/package.json packages/openfeature/
COPY packages/dashboard/package.json packages/dashboard/
COPY apps/demo/package.json apps/demo/
# An extra CA for TLS-inspecting corporate proxies can be passed as a build secret:
#   docker build --secret id=ca,src=/path/to/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN pnpm exec tsc -b packages/core packages/server packages/cli packages/dashboard \
 && cp packages/dashboard/public/index.html packages/dashboard/dist/

# The runtime has no node_modules from npm at all: only Ripen's own compiled code.
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4747 \
    RIPEN_DB=/data/ripen.db \
    RIPEN_CONFIG=/data/ripen.config.json \
    RIPEN_DASHBOARD_DIR=/app/dashboard
WORKDIR /app
COPY --from=build /src/packages/core/package.json node_modules/@ripen/core/package.json
COPY --from=build /src/packages/core/dist node_modules/@ripen/core/dist
COPY --from=build /src/packages/server/package.json node_modules/@ripen/server/package.json
COPY --from=build /src/packages/server/dist node_modules/@ripen/server/dist
COPY --from=build /src/packages/cli/package.json node_modules/@ripen/cli/package.json
COPY --from=build /src/packages/cli/dist node_modules/@ripen/cli/dist
COPY --from=build /src/packages/dashboard/dist dashboard
RUN mkdir /data && chown node:node /data \
 && ln -s /app/node_modules/@ripen/cli/dist/main.js /usr/local/bin/ripen && chmod +x /app/node_modules/@ripen/cli/dist/main.js
USER node
VOLUME /data
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
# RIPEN_CLIENT_KEY and RIPEN_ADMIN_TOKEN must come from the environment (e.g. --env-file).
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/node_modules/@ripen/server/dist/main.js"]
