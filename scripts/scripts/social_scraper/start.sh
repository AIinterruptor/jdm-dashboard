#!/bin/bash
# JDM Social Scraper Startup Script
# Run from: ~/.openclaw/workspace/scripts/social_scraper/

cd "$(dirname "$0")"

# Check if node_modules exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the JDM bridge
echo "Starting Social Scraper JDM Bridge..."
node jdm-bridge.js &

# Wait for bridge to start
sleep 2

# Start the dashboard server
echo "Starting Dashboard on http://localhost:4200"
cd ~/.local/share/OpenClaw/canvas/jdm/social
python3 -m http.server 4200 --bind 0.0.0.0 &

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  🤖 SOCIAL SCRAPER READY                                 ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Dashboard:  http://localhost:4200                       ║"
echo "║  HTTP API:   http://localhost:8765                        ║"
echo "║  WebSocket:  ws://localhost:18789 (gateway)              ║"
echo "╚══════════════════════════════════════════════════════════╝"