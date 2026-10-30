#!/usr/bin/env bash
# Download OpenStreetMap extracts for the Safe Tour map area (Gwanghwamun–Bukchon–Myeongdong–Namsan)
# in tiles small enough for the OSM API's 50,000-node limit.
# Usage: tools/safe-tour/fetch_osm.sh <output-dir>
set -euo pipefail
out=${1:?output directory}
mkdir -p "$out"
i=0
fetch() { # lon_min lat_min lon_max lat_max
  i=$((i+1))
  curl -sSf -m 120 "https://api.openstreetmap.org/api/0.6/map?bbox=$1,$2,$3,$4" -o "$out/t$i.xml"
  echo "tile $i: $1,$2,$3,$4"
}
for lat in 37.552 37.559 37.566 37.573 37.580; do
  for lon in 126.970 126.9775 126.985 126.9925; do
    fetch "$lon" "$lat" "$(echo "$lon + 0.0075" | bc)" "$(echo "$lat + 0.007" | bc)"
  done
done
for lon in 126.9775 126.985 126.9925; do   # Namsan / N Seoul Tower
  fetch "$lon" 37.546 "$(echo "$lon + 0.0075" | bc)" 37.552
done
