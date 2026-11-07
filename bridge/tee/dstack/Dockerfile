# syntax=docker/dockerfile:1
# The hosted bridge as a container, for a TEE that runs Docker Compose
# (dstack on Phala Cloud, #696). The same bridge as the Aleph image (#583):
# bridge/rootfs/deploy-bridge.sh makes it in both.
#
# Build from the repository's root:
#   docker build -f bridge/tee/dstack/Dockerfile -t belege-bridge-dstack .
# The bases are pinned by digest; the release workflow passes the same ones.
ARG BUILD_BASE=node:22-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f
ARG RUN_BASE=debian:12@sha256:854dd8ab51d62866dbd8f5431d15ce77b12983a2a4a1e1fe43a2395dc7ef9f61

FROM ${BUILD_BASE} AS build
WORKDIR /src
COPY . .
RUN corepack enable && corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate \
 && bridge/rootfs/deploy-bridge.sh /out

FROM ${RUN_BASE}
# Node from the build stage: one binary, nothing else of the build image.
# It brings its own CA certificates and needs only glibc and libstdc++, which
# Debian has: no apt install here (it would change the image for nothing).
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /out /opt/belege-bridge
COPY bridge/tee/dstack/entrypoint.sh /usr/local/bin/belege-bridge-entrypoint
COPY bridge/tee/dstack/sort-secrets.mjs /opt/belege-bridge-tee/sort-secrets.mjs
COPY bridge/tee/dstack/registrar.mjs /opt/belege-bridge-tee/registrar.mjs
COPY bridge/tee/dstack/intake.mjs /opt/belege-bridge-tee/intake.mjs
RUN groupadd --system --gid 10001 belege-bridge \
 && useradd --system --uid 10001 --gid 10001 --home-dir /run/belege-bridge --shell /usr/sbin/nologin belege-bridge \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
USER 10001:10001
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/belege-bridge-entrypoint"]
