#!/usr/bin/env bash
# After a recording run: keep the videos (Playwright wipes results/ on the
# next run), convert scene 1 to MP4, and put scene 2's two devices side by side.
#   e2e-video/compose.sh <out dir>
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-out}"; mkdir -p "$out"
s1=$(ls results/belege-demo-*/video.webm 2>/dev/null | head -1 || true)
if [ -n "$s1" ]; then
  ffmpeg -nostdin -v error -y -i "$s1" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$out/belege-scene1.mp4"
  echo "scene 1: $out/belege-scene1.mp4"
fi
mac=$(ls results/qr-pairing-*/mac/*.webm 2>/dev/null | head -1 || true)
phone=$(ls results/qr-pairing-*/phone/*.webm 2>/dev/null | head -1 || true)
if [ -n "$mac" ] && [ -n "$phone" ]; then
  ffmpeg -nostdin -v error -y -i "$mac" -i "$phone" \
    -filter_complex "[0:v]scale=960:720,setsar=1[l];[1:v]scale=960:720,setsar=1[r];[l][r]hstack=inputs=2" \
    -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$out/belege-scene2-qr.mp4"
  echo "scene 2: $out/belege-scene2-qr.mp4"
fi
