# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RAC Financial Dashboard - A financial analysis platform for Rirratjingu Aboriginal Corporation integrating Xero accounting with Claude AI via Model Context Protocol (MCP).

## Commands

```bash
npm start      # Start production server (node server.js)
npm run dev    # Development with auto-reload (nodemon)
npm run deploy # Deploy to Railway
npm install    # Install dependencies
```

## Architecture

### Two Main Server Files

1. **server.js** - Express.js REST API server
   - Xero and ApprovalMax OAuth authentication
   - 50+ REST API endpoints for financial data
   - PostgreSQL token storage with auto-refresh
   - Serves frontend dashboards from `public/`

2. **mcp-server.js** - MCP server for Claude Desktop
   - 21 tools exposed to Claude via MCP protocol
   - Calls Express API via `RAILWAY_API_URL` environment variable
   - Tool definitions with JSON schemas in `ListToolsRequestSchema` handler
   - Tool implementations in `CallToolRequestSchema` handler

### Data Flow

```
Claude Desktop -> mcp-server.js -> Railway API (server.js) -> Xero API
                                                            -> PostgreSQL (tokens)
```

### Database Tables

- `tokens` - Xero OAuth tokens per tenant
- `approvalmax_tokens` - ApprovalMax OAuth tokens

## Key Patterns

- **ES6 Modules**: Uses `import` syntax (not CommonJS `require`)
- **Node.js >= 18.0.0**: Required for native fetch and ES modules
- **Async/Await**: All API calls are promise-based
- **Multi-tenant**: Supports 7 RAC organizations via `tenantId` parameter

## Adding a New API Endpoint

1. Add handler in `server.js`:
   ```javascript
   app.get('/api/new-endpoint/:tenantId', async (req, res) => {
     // Use xeroClient for Xero API calls
   });
   ```

## Adding a New MCP Tool

1. Add tool definition in `ListToolsRequestSchema` handler in `mcp-server.js`
2. Add tool handler case in `CallToolRequestSchema` switch statement
3. Call Express endpoint via `callRailwayAPI()` helper

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI` - Xero OAuth
- `RAILWAY_API_URL` - Deployed API URL for MCP server
- `PORT` - Server port (default 3000)

Optional:
- `APPROVALMAX_CLIENT_ID`, `APPROVALMAX_CLIENT_SECRET`, `APPROVALMAX_REDIRECT_URI`

## Debugging

- `/api/health` - System health check
- `/api/connection-status` - Verify Xero connections
- `/api/debug/database` - Token storage info
- Check console logs from both server.js and mcp-server.js


## RAC-Specific Information

### Supported Organizations (7 RAC Entities)
- Rirratjingu Mining
- Rirratjingu Enterprises
- Rirratjingu Property Management
- Rirratjingu Aboriginal Corporation
- [add the remaining 3 entities you work with]

### Business Context
- This is for Rirratjingu Aboriginal Corporation
- Primary users: Matt, Rhian, Paul, Saheel
- Multi-entity consolidated financial reporting
- MCP integration enables Claude Desktop to query live financial data
- Dashboard provides trial balances, cash positions, P&L analysis

### Important Conventions
- Australian date formats (DD/MM/YYYY)
- All currency in AUD
- Entity separation is critical for accurate reporting
- OAuth tokens stored in PostgreSQL with auto-refresh

