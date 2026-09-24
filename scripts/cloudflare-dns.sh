#!/usr/bin/env bash
# Create (or update) the three DNS records for belege.le-space.de on Aleph.
set -euo pipefail
API=https://api.cloudflare.com/client/v4
if [ -z "${CF_API_TOKEN:-}" ]; then read -rsp "Cloudflare API token: " CF_API_TOKEN </dev/tty; echo; fi
auth=(-H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json")

zones=$(curl -sS "${auth[@]}" "$API/zones?name=le-space.de")
if [ "$(jq -r .success <<<"$zones")" != true ] || [ "$(jq -r '.result | length' <<<"$zones")" = 0 ]; then
  echo "Zone le-space.de not reachable with this token: $(jq -r '[.errors[]?.message] | join("; ") // "no zone"' <<<"$zones")"
  exit 1
fi
zone=$(jq -r '.result[0].id' <<<"$zones")

put() { # type name content
  local id body res
  id=$(curl -sS "${auth[@]}" "$API/zones/$zone/dns_records?type=$1&name=$2" | jq -r '.result[0].id // empty')
  body=$(jq -nc --arg t "$1" --arg n "$2" --arg c "$3" '{type:$t,name:$n,content:$c,ttl:1} + (if $t == "CNAME" then {proxied:false} else {} end)')
  if [ -n "$id" ]; then
    res=$(curl -sS -X PUT "${auth[@]}" "$API/zones/$zone/dns_records/$id" --data "$body")
  else
    res=$(curl -sS -X POST "${auth[@]}" "$API/zones/$zone/dns_records" --data "$body")
  fi
  jq -r --arg verb "$([ -n "$id" ] && echo updated || echo created)" \
    'if .success then "✓ \($verb): \(.result.type) \(.result.name) → \(.result.content)" else "✗ \([.errors[].message] | join("; "))" end' <<<"$res"
}

put CNAME belege.le-space.de ipfs.public.aleph.sh
put CNAME _dnslink.belege.le-space.de _dnslink.belege.le-space.de.static.public.aleph.sh
put TXT _control.belege.le-space.de 0xD139E44669fD96C714F888B6b04Fe5D02D02B4fD
