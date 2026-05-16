#!/bin/bash
# Build + copy vers webroot ifind.fr/design/v7/
set -e
cd "$(dirname "$0")"
npm run build > /dev/null
rm -rf /opt/moltbot/design-explorations/mockups/v7
mkdir -p /opt/moltbot/design-explorations/mockups/v7
cp -r dist/* /opt/moltbot/design-explorations/mockups/v7/
echo "✅ Deploy → https://ifind.fr/design/v7/"
