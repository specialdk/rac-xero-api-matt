# RAC Financial Dashboard

A financial analysis platform for Rirratjingu Aboriginal Corporation (RAC) that integrates Xero accounting software with Claude AI through the Model Context Protocol (MCP).

## Overview

This project provides:
- **Express.js API Server** - REST API for Xero and ApprovalMax integration
- **MCP Server** - Claude Desktop integration for AI-powered financial analysis
- **Database Token Storage** - PostgreSQL-based OAuth token management

## Project Structure

```
rac-xero-api-matt/
├── server.js           # Main Express.js API server
├── mcp-server.js       # MCP server for Claude Desktop
├── oldserver.js        # Previous server version (backup)
├── package.json        # NPM dependencies and scripts
├── .env                # Environment configuration
└── .gitignore          # Git ignore rules
```

## Main Files

| File | Purpose |
|------|---------|
| `server.js` | Express.js server handling Xero/ApprovalMax OAuth, 50+ REST API endpoints, PostgreSQL token storage |
| `mcp-server.js` | MCP server (v3.0.0) enabling Claude Desktop to query financial data via 21 tools |
| `package.json` | Dependencies and npm scripts |

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL database
- Xero Developer Account with API credentials
- ApprovalMax Account (optional)

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
# Server
PORT=3000
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgresql://user:password@host:5432/database

# Xero OAuth
XERO_CLIENT_ID=your_client_id
XERO_CLIENT_SECRET=your_client_secret
XERO_REDIRECT_URI=http://localhost:3000/callback

# ApprovalMax OAuth (optional)
APPROVALMAX_CLIENT_ID=your_client_id
APPROVALMAX_CLIENT_SECRET=your_client_secret
APPROVALMAX_REDIRECT_URI=http://localhost:3000/callback/approvalmax

# MCP Server
RAILWAY_API_URL=https://your-app.up.railway.app
```

## Scripts

```bash
npm start      # Start production server
npm run dev    # Start with nodemon (auto-reload)
npm run deploy # Deploy to Railway
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth` | Initiate Xero OAuth |
| GET | `/auth?provider=approvalmax` | Initiate ApprovalMax OAuth |
| GET | `/callback` | Xero OAuth callback |
| GET | `/callback/approvalmax` | ApprovalMax callback |

### Connection & Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/connection-status` | Get all Xero connections |
| GET | `/api/token-status` | Token expiration status |

### Trial Balance & Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trial-balance/:tenantId` | Trial balance for organization |
| GET | `/api/consolidated-trial-balance` | Consolidated trial balance |
| GET | `/api/profit-loss/:tenantId` | P&L summary |
| GET | `/api/financial-ratios/:tenantId` | Financial ratios |

### Cash & Receivables
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cash-position/:tenantId` | Bank account balances |
| GET | `/api/outstanding-invoices/:tenantId` | Unpaid invoices |
| GET | `/api/aged-receivables/:tenantId` | Aged receivables |

### Analysis Tools
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/journal-entries/:tenantId` | Manual journal entries |
| GET | `/api/equity-analysis/:tenantId` | Equity movements |
| GET | `/api/account-history/:tenantId/:accountName` | Account history |
| GET | `/api/chart-of-accounts/:tenantId` | Chart of accounts |
| GET | `/api/find-unbalanced/:tenantId` | Unbalanced transactions |
| GET | `/api/compare-periods/:tenantId` | Period comparison |
| GET | `/api/expense-analysis/:tenantId` | Expense categories |
| GET | `/api/intercompany/:tenantId` | Intercompany transactions |
| GET | `/api/yoy-analysis/:tenantId` | Year-over-year analysis |
| GET | `/api/monthly-breakdown/:tenantId` | Monthly breakdown |

## MCP Tools (Claude Desktop)

The MCP server exposes 21 tools:

**Core Tools**
- `test_rac_connection` - Test API connectivity
- `get_organizations` - List Xero organizations
- `get_trial_balance` - Trial balance with imbalance detection
- `get_consolidated_trial_balance` - Multi-entity trial balance
- `get_cash_position` - Bank account balances
- `get_outstanding_invoices` - Unpaid invoices

**Diagnostic Tools**
- `investigate_imbalance` - Comprehensive imbalance analysis
- `get_journal_entries` - Manual journal review
- `check_bank_reconciliation` - Reconciliation status
- `find_unbalanced_transactions` - Identify problematic entries
- `get_account_history` - Account transaction history
- `get_chart_of_accounts` - Chart structure

**Business Intelligence Tools**
- `get_profit_loss_summary` - P&L breakdown
- `get_aged_receivables` - Customer payment aging
- `analyze_expense_categories` - Expense trending
- `get_financial_ratios` - Liquidity/profitability metrics
- `get_intercompany_transactions` - Cross-entity analysis
- `compare_periods` - Period-over-period comparison
- `analyze_equity_movements` - Equity account analysis

## Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rac-xero": {
      "command": "node",
      "args": ["C:/rac-mcp/rac-xero/rac-api/rac-xero-api-matt/mcp-server.js"],
      "env": {
        "RAILWAY_API_URL": "https://your-app.up.railway.app"
      }
    }
  }
}
```

## Database Schema

### tokens
```sql
CREATE TABLE tokens (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) UNIQUE NOT NULL,
    tenant_name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at BIGINT NOT NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### approvalmax_tokens
```sql
CREATE TABLE approvalmax_tokens (
    id SERIAL PRIMARY KEY,
    integration_key VARCHAR(255) UNIQUE NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at BIGINT NOT NULL,
    organizations JSONB,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Supported Organizations

1. Rirratjingu Mining Pty Ltd 7168
2. Rirratjingu Aboriginal Corporation 8538
3. Rirratjingu Property Management & Maintenance Services Pty Ltd
4. Rirratjingu Invest P/L ATF Miliditjpi Trust
5. Ngarrkuwuy Developments Pty Ltd
6. Rirratjingu Enterprises Pty Ltd
7. Marrin Square Developments Pty Ltd

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.18.2 | Web server framework |
| xero-node | ^4.34.0 | Xero API SDK |
| pg | ^8.11.3 | PostgreSQL client |
| node-fetch | ^2.7.0 | HTTP requests |
| dotenv | ^16.3.1 | Environment variables |
| @modelcontextprotocol/sdk | ^1.17.3 | MCP server SDK |
| nodemon | ^3.0.1 | Development auto-reload |

## License

MIT
