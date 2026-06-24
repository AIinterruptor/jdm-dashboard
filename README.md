# JDM Command Center

Philippines intelligence dashboard with real-time situational awareness.

**Live:** https://aiinterruptor.github.io/jdm-dashboard

## Features

- **Leaflet map** with tactical/satellite/terrain layers, NASA GIBS overlays (fires, precipitation, nightlights), and weather radar
- **Intel feeds** from GDELT, USGS earthquakes, Open-Meteo weather, CoinGecko crypto, Frankfurter FX rates, World Bank indicators
- **JARVIS AI chat** with threat analysis, simulation engine, and ML-powered crisis prediction
- **4 sub-modes:** LGU Commander, PNP Watch, Home Security, Business Edge
- **OSINT terminal** with deep search, entity extraction, and network analysis
- **Radio intercept** panel with PH AM stations and international streams
- **Mobile responsive** with bottom nav and stacked panels

## Architecture

Single-page static app (no build step). Cloudflare Worker proxy handles CORS for RSS feeds and gov sources.

| Component | Stack |
|---|---|
| Map | Leaflet + OpenStreetMap/CARTO tiles |
| Data | GDELT, USGS, Open-Meteo, CoinGecko, Frankfurter |
| Proxy | Cloudflare Worker (`jdm-proxy.josed-jdm.workers.dev`) |
| Hosting | GitHub Pages |
| AI | Configurable LLM (Gemini/OpenRouter/OpenAI) |
