#!/bin/sh
# Generate config.json from environment variables at container startup
cat > /usr/share/nginx/html/config.json <<EOF
{
  "googleApiKey": "${GOOGLE_API_KEY:-}",
  "mapboxToken": "${MAPBOX_TOKEN:-}",
  "bingApiKey": "${BING_API_KEY:-}"
}
EOF

exec nginx -g 'daemon off;'
