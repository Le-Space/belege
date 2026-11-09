# syntax=docker/dockerfile:1
# The launcher (#696) as a container, for the Le Space host behind its
# reverse proxy (deploy/compose.yaml). Not the bridge: it holds no books'
# secret, only Le Space's own Phala key and its NEAR key, both mounted at run
# time and never baked in.
#
# Build from the repository's root:
#   docker build -f bridge/tee/launcher/Dockerfile -t belege-bridge-launcher .
# The bases are the bridge image's, pinned by digest.
ARG BUILD_BASE=node:22-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f
ARG RUN_BASE=debian:12@sha256:854dd8ab51d62866dbd8f5431d15ce77b12983a2a4a1e1fe43a2395dc7ef9f61

FROM ${BUILD_BASE} AS build
WORKDIR /src
COPY . .
RUN corepack enable && corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate \
 && pnpm install --frozen-lockfile --filter @belege/bridge-launcher... \
 && pnpm --filter @belege/bridge-launcher deploy --legacy --prod /out/bridge/tee/launcher \
 && rm -rf /out/bridge/tee/launcher/test \
 && mkdir -p /out/bridge/tee/dstack \
 && cp bridge/tee/dstack/provision.mjs bridge/tee/dstack/compose.yaml /out/bridge/tee/dstack/

FROM ${RUN_BASE}
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /out /opt/belege-launcher
RUN groupadd --system --gid 10002 belege-launcher \
 && useradd --system --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin belege-launcher
USER 10002:10002
ENV NODE_ENV=production LAUNCHER_HOST=0.0.0.0 LAUNCHER_PORT=8790
EXPOSE 8790
ENTRYPOINT ["node", "/opt/belege-launcher/bridge/tee/launcher/src/cli.js"]
