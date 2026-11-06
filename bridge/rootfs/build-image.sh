#!/usr/bin/env bash
# build-image.sh <out.ext4> <bridge dir> <attest-relay.cjs>: the hosted
# bridge's rootfs (#583) as a plain ext4 image.
#
# Debian 12 with systemd, Node, Caddy and the bridge baked in: nothing is
# pulled after the unlock, so the bridge answers seconds after it. relay-
# button's aleph-confidential-rootfs action then makes it confidential (its
# init, a systemctl replacement) and encrypts it. Made the way
# Le-Space/paperless-anywhere's rootfs/build-image.sh makes its image.
#
#   <bridge dir>       `pnpm --filter @belege/bridge deploy --legacy --prod <dir>`
#                      of the tagged checkout (production dependencies only)
#   <attest-relay.cjs> relay-button's packages/attest-relay bundled into one file
#
# Needs root, debootstrap and debian-archive-keyring.
set -euo pipefail

NODE_VERSION=v22.21.0
NODE_SHA256=71a04f4b9144870c9407b8019fe912514229e50246bc706862eded3ac8e9025d

out="${1:?usage: build-image.sh <out.ext4> <bridge dir> <attest-relay.cjs>}"
bridge="${2:?missing the bridge directory (pnpm deploy)}"
attest="${3:?missing the attest relay bundle}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[ -f "$bridge/src/cli.js" ] && [ -d "$bridge/node_modules" ] || { echo "not a deployed bridge: $bridge" >&2; exit 1; }
[ -s "$attest" ] || { echo "no attest relay bundle: $attest" >&2; exit 1; }
work="$(mktemp -d)"
root="$work/root"
trap 'rm -rf "$work"' EXIT

# Signed packages only: with --keyring debootstrap refuses an unverified Release file.
keyring=/usr/share/keyrings/debian-archive-keyring.gpg
[ -s "$keyring" ] || { echo "missing $keyring (apt install debian-archive-keyring)" >&2; exit 1; }
debootstrap --variant=minbase --keyring="$keyring" \
  --include=systemd,systemd-sysv,dbus,python3,openssh-server,caddy,ca-certificates,curl,iproute2,procps,util-linux,kmod,jq,nftables \
  bookworm "$root" https://deb.debian.org/debian >/dev/null

# Debian's security fixes on top: sshd and Caddy face the network.
cat > "$root/etc/apt/sources.list" <<'APT'
deb https://deb.debian.org/debian bookworm main
deb https://deb.debian.org/debian bookworm-updates main
deb https://security.debian.org/debian-security bookworm-security main
APT
chroot "$root" sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade' >/dev/null

curl -fsSL -o "$work/node.tar.xz" "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
echo "${NODE_SHA256}  $work/node.tar.xz" | sha256sum -c - >/dev/null
install -d "$root/usr/local/lib/nodejs"
tar -xJf "$work/node.tar.xz" -C "$root/usr/local/lib/nodejs" --strip-components=1 \
  --exclude='*/include' --exclude='*/share' --exclude='*/lib/node_modules/corepack' \
  --exclude='*/lib/node_modules/npm'
ln -sf /usr/local/lib/nodejs/bin/node "$root/usr/bin/node"

# The bridge, owned by root and read-only to the user it runs as.
install -d -m 755 "$root/opt/belege-bridge"
cp -a "$bridge/." "$root/opt/belege-bridge/"
rm -rf "$root/opt/belege-bridge/test"
chown -R 0:0 "$root/opt/belege-bridge"
chmod -R go-w "$root/opt/belege-bridge"
chroot "$root" useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin belege-bridge

install -d "$root/usr/local/lib/attest-relay"
install -m 644 "$attest" "$root/usr/local/lib/attest-relay/attest-relay.cjs"

install -D -m 644 "$here/files/Caddyfile" "$root/etc/caddy/Caddyfile"
for unit in belege-bridge.service belege-bridge-status.service belege-bridge-forget-passphrase.service \
  belege-bridge-net-hardening.service attest-relay.service; do
  install -D -m 644 "$here/files/$unit" "$root/etc/systemd/system/$unit"
done
for script in belege-bridge-run belege-bridge-https belege-bridge-status belege-bridge-forget-passphrase \
  belege-bridge-net-hardening belege-bridge-check; do
  install -D -m 755 "$here/files/$script" "$root/usr/local/sbin/$script"
done

printf 'PermitRootLogin prohibit-password\nPasswordAuthentication no\nUseDNS no\n' \
  > "$root/etc/ssh/sshd_config.d/belege-bridge.conf"
echo belege-bridge > "$root/etc/hostname"
: > "$root/etc/resolv.conf"
chroot "$root" systemctl enable caddy.service ssh.service belege-bridge.service belege-bridge-status.service \
  belege-bridge-forget-passphrase.service belege-bridge-net-hardening.service attest-relay.service >/dev/null 2>&1

rm -rf "$root"/var/cache/apt/* "$root"/var/lib/apt/lists/* "$root"/usr/share/doc/* \
  "$root"/usr/share/man/* "$root"/usr/share/info/* "$root"/usr/share/locale/*

# Little room on top: the instance grows the filesystem to its disk at boot,
# and free space costs full upload once the image is encrypted.
size_mib=$(( $(du -sm "$root" | cut -f1) * 108 / 100 + 64 ))
echo "rootfs content: $(du -sh "$root" | cut -f1), image ${size_mib} MiB"
truncate -s "${size_mib}M" "$out"
mkfs.ext4 -q -b 4096 -T default -L belege-bridge -d "$root" "$out"
