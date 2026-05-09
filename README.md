# RAC MEX MCP Server

Asset management integration for Rirratjingu Aboriginal Corporation (RAC) connecting MEX CMMS to Claude AI through the Model Context Protocol (MCP).

## Overview

This project provides:

- **Express.js API Server** — REST API that talks to MEX via OData
- **MCP Server** — Claude Desktop integration for AI-powered asset queries

## Project Structure

```
rac-mex-mcp/
├── server.js         # Express.js API server (deploy to Railway)
├── mcp-server.js     # MCP server for Claude Desktop
├── package.json      # Dependencies
├── .env.example      # Credentials template
└── .gitignore
```

## File Summary

| File | Purpose |
|------|---------|
| `server.js` | Express server — calls MEX OData API, exposes REST endpoints |
| `mcp-server.js` | MCP server — Claude Desktop talks to this, it calls Railway |

## Prerequisites

- Node.js >= 18.0.0
- MEX Admin account credentials
- Railway account (for hosting)

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```
MEX_BASE_URL=https://rirratjinguaboriginalcorporation.mexcmms.com
MEX_USERNAME=your_admin_username
MEX_PASSWORD=your_admin_password
PORT=3000
RAILWAY_API_URL=https://your-app.up.railway.app
```

## Scripts

```bash
npm start       # Start production server
npm run dev     # Start with nodemon (auto-reload)
npm run mcp     # Run MCP server locally
```

## API Endpoints

### Health & Connection
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/connection-status` | Test MEX connection |
| GET | `/api/endpoints` | List all available MEX OData endpoints |

### Assets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets` | List assets (supports ?limit, ?skip, ?filter, ?orderby, ?select) |
| GET | `/api/assets/search?q=term` | Search assets by keyword |
| GET | `/api/assets/:assetNo` | Get single asset by Asset Number |
| GET | `/api/assets/summary/by-status` | Asset counts grouped by status |
| GET | `/api/assets/summary/by-type` | Asset counts grouped by type |

### Asset Types
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/asset-types` | List all asset categories |

### Work Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/work-orders` | List work orders (supports ?status, ?assetNo) |
| GET | `/api/work-orders/:workOrderNo` | Get single work order |

## MCP Tools (Claude Desktop)

The MCP server exposes 10 tools:

| Tool | Description |
|------|-------------|
| `test_mex_connection` | Test API connectivity |
| `list_assets` | List assets with optional filtering |
| `search_assets` | Search by keyword |
| `get_asset` | Get single asset by number |
| `list_asset_types` | List all asset categories |
| `get_asset_summary_by_status` | Asset counts by status |
| `get_asset_summary_by_type` | Asset counts by type |
| `list_work_orders` | List work orders |
| `get_work_order` | Get single work order |
| `list_mex_endpoints` | Explore available MEX data |

## Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rac-mex": {
      "command": "node",
      "args": ["C:/path/to/rac-mex-mcp/mcp-server.js"],
      "env": {
        "RAILWAY_API_URL": "https://your-app.up.railway.app"
      }
    }
  }
}
```

## Deployment (Railway)

1. Push this repo to GitHub
2. Connect repo to Railway
3. Set environment variables in Railway dashboard:
   - `MEX_BASE_URL`
   - `MEX_USERNAME`
   - `MEX_PASSWORD`
4. Deploy — Railway auto-detects Node.js
5. Copy your Railway URL into `RAILWAY_API_URL` in Claude Desktop config

## MEX OData API Notes

- MEX uses OData v3.0
- Authentication: HTTP Basic Auth (Base64 encoded username:password)
- Base endpoint: `https://yoursite.mexcmms.com/odata.svc`
- Returns JSON when `Accept: application/json` header is set
- OData v3 filter syntax: `substringof('term', FieldName)` for partial match

## About

Built for Rirratjingu Aboriginal Corporation (RAC) to enable AI-powered asset management reporting via Claude Desktop.
