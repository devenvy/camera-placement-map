#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts: writes the runtime API-key defaults
# from environment variables. /tmp is writable even with a read-only root filesystem.
set -eu
cat > /tmp/config.json <<JSON
{
  "googleApiKey": "${GOOGLE_API_KEY:-}",
  "mapboxToken": "${MAPBOX_TOKEN:-}",
  "bingApiKey": "${BING_API_KEY:-}"
}
JSON
