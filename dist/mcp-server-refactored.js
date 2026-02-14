#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import fetch from "node-fetch";

// Suppress dotenv console output
const originalConsoleLog = console.log;
console.log = function (...args) {
  if (args[0] && args[0].toString().includes("dotenv@")) return;
  originalConsoleLog.apply(console, args);
};
dotenv.config();
console.log = originalConsoleLog;

// Configuration
const RAILWAY_API_BASE =
  process.env.RAILWAY_API_URL ||
  "https://rac-financial-dashboard-production.up.railway.app";

// ============================================================================
// CORE API UTILITIES
// ============================================================================

/**
 * Call Railway API endpoint
 */
async function callRailwayAPI(endpoint) {
  try {
    const url = `${RAILWAY_API_BASE}${endpoint}`;
    console.error(`🌐 Calling: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Railway API error: ${response.status} - ${response.statusText}`
      );
    }

    const data = await response.json();
    console.error(`✅ Response received`);
    return data;
  } catch (error) {
    console.error(`❌ API call failed: ${error.message}`);
    throw error;
  }
}

/**
 * Call Railway API endpoint with POST
 */
async function callRailwayAPIPOST(endpoint, body) {
  try {
    const url = `${RAILWAY_API_BASE}${endpoint}`;
    console.error(`🌐 Calling (POST): ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Railway API error: ${response.status} - ${response.statusText}`
      );
    }

    const data = await response.json();
    console.error(`✅ Response received`);
    return data;
  } catch (error) {
    console.error(`❌ API call failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get tenant ID from organization name
 */
async function getTenantIdFromName(organizationName) {
  const connections = await callRailwayAPI("/api/connection-status");

  const matchingConnection = connections.find(
    (conn) =>
      conn.tenantName.toLowerCase().includes(organizationName.toLowerCase()) ||
      organizationName.toLowerCase().includes(conn.tenantName.toLowerCase())
  );

  if (!matchingConnection) {
    throw new Error(
      `No connected organization found matching: ${organizationName}`
    );
  }

  if (!matchingConnection.connected) {
    throw new Error(
      `Organization ${matchingConnection.tenantName} is not currently connected (token expired)`
    );
  }

  return matchingConnection.tenantId;
}

/**
 * Resolve tenant ID from either tenantId or organizationName
 */
async function resolveTenantId(args) {
  const { tenantId, organizationName } = args;

  if (tenantId) return tenantId;
  if (organizationName) return await getTenantIdFromName(organizationName);

  throw new Error("Must provide either tenantId or organizationName");
}

/**
 * Build query string from parameters
 */
function buildQueryString(params) {
  const filtered = Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== null)
    .reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {});

  const query = new URLSearchParams(filtered).toString();
  return query ? `?${query}` : "";
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const TOOLS = [
  {
    name: "test_rac_connection",
    description: "Test if RAC Xero MCP server can connect to Railway APIs",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_organizations",
    description: "Get list of connected Xero organizations from Railway system",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_trial_balance",
    description: "Get trial balance for a specific Xero organization",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          description: "Xero tenant ID (optional if organizationName provided)",
        },
        organizationName: {
          type: "string",
          description:
            "Organization name (e.g., 'Mining' or 'Aboriginal Corporation')",
        },
        reportDate: {
          type: "string",
          description:
            "Report date in YYYY-MM-DD format (optional, defaults to today)",
        },
      },
    },
  },
  {
    name: "get_cash_position",
    description:
      "Get cash position and bank account balances for a Xero organization",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
      },
    },
  },
  {
    name: "get_outstanding_invoices",
    description: "Get outstanding invoices for a Xero organization",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
      },
    },
  },
  {
    name: "get_consolidated_trial_balance",
    description:
      "Get consolidated trial balance across all connected RAC entities",
    inputSchema: {
      type: "object",
      properties: {
        reportDate: {
          type: "string",
          description:
            "Report date in YYYY-MM-DD format (optional, defaults to today)",
        },
      },
    },
  },
  {
    name: "get_profit_loss_summary",
    description: "Get profit & loss summary for a specific organization",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        date: { type: "string" },
        periodMonths: { type: "number" },
      },
    },
  },
  {
    name: "get_journal_entries",
    description:
      "Get manual journal entries for a specific organization to identify unusual postings",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        dateFrom: { type: "string" },
        dateTo: { type: "string" },
        accountName: { type: "string" },
      },
    },
  },
  {
    name: "analyze_equity_movements",
    description:
      "Analyze movements in equity accounts, particularly useful for investigating the Future Fund account",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        equityAccountName: { type: "string" },
        monthsBack: { type: "number" },
      },
    },
  },
  {
    name: "get_account_history",
    description: "Get detailed transaction history for a specific account",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        accountName: { type: "string", required: true },
        dateFrom: { type: "string" },
        dateTo: { type: "string" },
      },
    },
  },
  {
    name: "check_bank_reconciliation",
    description:
      "Compare bank account balances between trial balance and actual bank feeds to identify discrepancies",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        bankAccountName: { type: "string" },
      },
    },
  },
  {
    name: "find_unbalanced_transactions",
    description:
      "Find transactions or journal entries that may be causing trial balance imbalances",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        minimumAmount: { type: "number" },
        dateRange: { type: "string" },
      },
    },
  },
  {
    name: "get_chart_of_accounts",
    description:
      "Get complete chart of accounts structure to identify unusual or problematic accounts",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        accountType: { type: "string" },
        includeArchived: { type: "boolean" },
      },
    },
  },
  {
    name: "investigate_imbalance",
    description:
      "Comprehensive analysis tool that investigates trial balance imbalances using multiple data sources",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        focusAccount: { type: "string" },
        analysisDepth: { type: "string" },
      },
    },
  },
  {
    name: "compare_periods",
    description:
      "Compare trial balance between different time periods to identify when imbalances were introduced",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        fromDate: { type: "string" },
        toDate: { type: "string" },
        accountFilter: { type: "string" },
      },
    },
  },
  {
    name: "get_aged_receivables",
    description: "Get aged receivables analysis showing customer payment aging",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        date: { type: "string" },
      },
    },
  },
  {
    name: "analyze_expense_categories",
    description: "Analyze expense breakdown and trends by category",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        date: { type: "string" },
        periodMonths: { type: "number" },
      },
    },
  },
  {
    name: "get_intercompany_transactions",
    description:
      "Analyze intercompany transactions and balances between RAC entities",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        date: { type: "string" },
      },
    },
  },
  {
    name: "get_financial_ratios",
    description: "Calculate key financial ratios for performance analysis",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        date: { type: "string" },
      },
    },
  }, // <-- CRITICAL: Add comma here if there isn't one already
  {
    name: "get_budget",
    description: "Get budget data for a specific organization and quarter",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: { type: "string" },
        quarter: { type: "string" },
        fiscalYear: { type: "string" },
      },
    },
  }, // <-- NO comma (last tool in array)
  {
    name: "get_invoices_detail",
    description:
      "Get detailed invoices with line items for date range - analyze sales by product, customer trends, and revenue patterns",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        organizationName: {
          type: "string",
          description:
            "Organization name (e.g., 'Mining', 'Enterprises', 'Aboriginal Corporation')",
        },
        dateFrom: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (e.g., '2025-07-01')",
        },
        dateTo: {
          type: "string",
          description: "End date in YYYY-MM-DD format (e.g., '2025-10-31')",
        },
        status: {
          type: "string",
          description:
            "Optional: Filter by status (PAID, AUTHORISED, DRAFT, VOIDED, DELETED)",
        },
      },
    },
  },
]; // <-- This closes the TOOLS array

// ============================================================================
// TOOL HANDLERS
// ============================================================================

/**
 * Handle test_rac_connection
 */
async function handleTestConnection() {
  const [healthCheck, connections] = await Promise.all([
    callRailwayAPI("/api/health"),
    callRailwayAPI("/api/connection-status"),
  ]);

  const activeConnections = connections.filter((c) => c.connected);
  const expiredConnections = connections.filter((c) => !c.connected);

  return {
    content: [
      {
        type: "text",
        text: `✅ SUCCESS! RAC Xero MCP server connected to Railway APIs!

Railway System: ${healthCheck.status}
Database: ${healthCheck.database}
Xero Connections: ${connections.length} found
Active Connections: ${activeConnections.length}

Connected Organizations:
${activeConnections.map((c) => `• ${c.tenantName}`).join("\n")}

${
  expiredConnections.length > 0
    ? `Expired Connections:\n${expiredConnections
        .map((c) => `• ${c.tenantName} (${c.error})`)
        .join("\n")}`
    : ""
}`,
      },
    ],
  };
}

/**
 * Handle get_organizations
 */
async function handleGetOrganizations() {
  const connections = await callRailwayAPI("/api/connection-status");

  if (connections.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No Xero organizations found. Please connect organizations through the Railway web dashboard first.",
        },
      ],
    };
  }

  const activeConnections = connections.filter((c) => c.connected);
  const expiredConnections = connections.filter((c) => !c.connected);

  let result = `📊 Found ${connections.length} Xero organization(s):\n\n`;

  if (activeConnections.length > 0) {
    result += "✅ ACTIVE CONNECTIONS:\n";
    activeConnections.forEach((conn) => {
      result += `• ${conn.tenantName}\n  ID: ${conn.tenantId}\n  Last seen: ${conn.lastSeen}\n\n`;
    });
  }

  if (expiredConnections.length > 0) {
    result += "⚠️ EXPIRED CONNECTIONS:\n";
    expiredConnections.forEach((conn) => {
      result += `• ${conn.tenantName}\n  ID: ${conn.tenantId}\n  Error: ${conn.error}\n\n`;
    });
  }

  return { content: [{ type: "text", text: result }] };
}

/**
 * Generic handler for simple tenant-based API calls
 */
async function handleTenantAPICall(args, apiPath, queryParams = {}) {
  const tenantId = await resolveTenantId(args);
  const queryString = buildQueryString(queryParams);
  const data = await callRailwayAPI(`${apiPath}/${tenantId}${queryString}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * Generic handler for API calls without tenant ID
 */
async function handleAPICall(apiPath, queryParams = {}) {
  const queryString = buildQueryString(queryParams);
  const data = await callRailwayAPI(`${apiPath}${queryString}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * Handle check_bank_reconciliation - FIXED VERSION
 * Uses section classification instead of hardcoded bank names
 */
async function handleBankReconciliation(args) {
  const tenantId = await resolveTenantId(args);

  const [trialBalance, cashPosition] = await Promise.all([
    callRailwayAPI(`/api/trial-balance/${tenantId}`),
    callRailwayAPI(`/api/cash-position/${tenantId}`),
  ]);

  // ✅ FIXED: Use section classification instead of hardcoded bank names
  const tbCashAccounts = trialBalance.trialBalance.assets.filter(
    (acc) => acc.section === "Bank"
  );

  // Calculate total from trial balance bank accounts
  const tbTotalCash = tbCashAccounts.reduce((sum, acc) => sum + acc.balance, 0);

  let result = `🏦 BANK RECONCILIATION ANALYSIS\n\n`;
  result += `Organization: ${trialBalance.tenantName}\n\n`;

  result += `📊 TRIAL BALANCE BANK ACCOUNTS:\n`;
  tbCashAccounts.forEach((acc) => {
    result += `• ${acc.name}: $${acc.balance.toLocaleString()}\n`;
  });
  result += `Total per Trial Balance: $${tbTotalCash.toLocaleString()}\n`;

  result += `\n💰 BANK FEEDS/CASH POSITION: $${cashPosition.totalCash.toLocaleString()}\n\n`;

  // Calculate discrepancy
  const difference = Math.abs(tbTotalCash - cashPosition.totalCash);

  if (difference > 1) {
    // Allow for rounding differences
    result += `❌ DISCREPANCY DETECTED: $${difference.toLocaleString()}\n\n`;
    result += `POSSIBLE CAUSES:\n`;
    result += `• Unreconciled bank transactions\n`;
    result += `• Bank feeds not synced with current trial balance date\n`;
    result += `• Manual journal entries not reflected in bank feeds\n`;
    result += `• Timing differences between book entries and bank clearing\n`;
    result += `• Some accounts may be investments/term deposits vs regular bank accounts\n\n`;

    // Show detailed account-by-account comparison
    result += `📋 DETAILED BREAKDOWN:\n\n`;
    result += `Trial Balance Bank Accounts (${tbCashAccounts.length}):\n`;
    tbCashAccounts.forEach((acc) => {
      result += `• ${acc.name}: $${acc.balance.toLocaleString()}\n`;
    });

    result += `\nBank Feeds Accounts (${cashPosition.bankAccounts.length}):\n`;
    cashPosition.bankAccounts.forEach((acc) => {
      result += `• ${acc.name}: $${acc.balance.toLocaleString()}\n`;
    });
  } else {
    result += `✅ RECONCILED: Bank accounts match within tolerance ($${difference.toFixed(
      2
    )})\n\n`;
    result += `All ${tbCashAccounts.length} bank accounts are properly reconciled.\n`;
  }

  return { content: [{ type: "text", text: result }] };
}

/**
 * Handle investigate_imbalance (requires special logic)
 */
async function handleInvestigateImbalance(args) {
  const tenantId = await resolveTenantId(args);
  const trialBalance = await callRailwayAPI(`/api/trial-balance/${tenantId}`);

  const { focusAccount, analysisDepth } = args;
  const balanceCheck = trialBalance.balanceCheck;

  let result = `🔍 COMPREHENSIVE IMBALANCE INVESTIGATION\n\n`;
  result += `Organization: ${trialBalance.tenantName}\n`;
  result += `Analysis Depth: ${analysisDepth || "detailed"}\n`;
  result += `Focus Account: ${focusAccount || "All accounts"}\n\n`;

  result += `⚖️ IMBALANCE SUMMARY:\n`;
  result += `• Status: ${
    balanceCheck.debitsEqualCredits ? "BALANCED" : "OUT OF BALANCE"
  }\n`;

  if (!balanceCheck.debitsEqualCredits) {
    result += `• Difference: $${balanceCheck.difference.toLocaleString()}\n`;
    result += `• Severity: ${
      Math.abs(balanceCheck.difference) > 1000000
        ? "CRITICAL"
        : Math.abs(balanceCheck.difference) > 10000
        ? "HIGH"
        : "LOW"
    }\n\n`;

    const futureFund = trialBalance.trialBalance.equity.find((acc) =>
      acc.name.toLowerCase().includes("future fund")
    );

    if (futureFund) {
      result += `🎯 PRIMARY ISSUE IDENTIFIED:\n`;
      result += `• Future Fund Charitable Payment Reserve: $${futureFund.balance.toLocaleString()}\n`;
      result += `• This account represents ${(
        (futureFund.balance / Math.abs(balanceCheck.difference)) *
        100
      ).toFixed(1)}% of the imbalance\n\n`;

      result += `💡 INVESTIGATION RECOMMENDATIONS:\n`;
      result += `1. Use get_journal_entries to find entries affecting Future Fund\n`;
      result += `2. Use analyze_equity_movements to track when this account was created\n`;
      result += `3. Use find_unbalanced_transactions to identify the problematic entry\n`;
      result += `4. Use get_account_history for detailed Future Fund transaction history\n`;
    }
  } else {
    result += `• Books are properly balanced - no investigation needed\n`;
  }

  return { content: [{ type: "text", text: result }] };
}

// ============================================================================
// MAIN SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: "rac-xero-enhanced",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Register tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Special handlers
    if (name === "test_rac_connection") {
      return await handleTestConnection();
    }

    if (name === "get_organizations") {
      return await handleGetOrganizations();
    }

    if (name === "check_bank_reconciliation") {
      return await handleBankReconciliation(args);
    }

    if (name === "investigate_imbalance") {
      return await handleInvestigateImbalance(args);
    }

    if (name === "investigate_imbalance") {
      return await handleInvestigateImbalance(args);
    }

    if (name === "get_budget") {
      const tenantId = await resolveTenantId(args);

      const quarterMapping = {
        Q1: {
          start: "2025-07-01",
          end: "2025-09-30",
          periods: 3,
          label: "Q1 FY26 (Jul-Sep 2025)",
          days: 92,
        },
        Q2: {
          start: "2025-10-01",
          end: "2025-12-31",
          periods: 3,
          label: "Q2 FY26 (Oct-Dec 2025)",
          days: 92,
        },
        Q3: {
          start: "2026-01-01",
          end: "2026-03-31",
          periods: 3,
          label: "Q3 FY26 (Jan-Mar 2026)",
          days: 90,
        },
        Q4: {
          start: "2026-04-01",
          end: "2026-06-30",
          periods: 3,
          label: "Q4 FY26 (Apr-Jun 2026)",
          days: 91,
        },
      };

      const quarter = args.quarter || "Q1";
      const quarterData = quarterMapping[quarter];

      if (!quarterData) {
        throw new Error(`Invalid quarter. Use Q1, Q2, Q3, or Q4.`);
      }

      const data = await callRailwayAPIPOST("/api/budget-summary", {
        tenantId: tenantId,
        date: quarterData.start,
        periods: quarterData.periods,
      });

      // Parse the budget report
      function parseBudgetReport(report) {
        const rows = report.rows;
        let revenue = 0;
        let operatingExpenses = 0;

        for (const section of rows) {
          if (section.rowType === "Section") {
            if (section.title === "Income") {
              // Find Total Income row
              const totalRow = section.rows.find(
                (r) =>
                  r.rowType === "SummaryRow" &&
                  r.cells[0].value === "Total Income"
              );
              if (totalRow) {
                // Sum columns 1, 2, 3 (the three months)
                revenue =
                  parseFloat(totalRow.cells[1].value || 0) +
                  parseFloat(totalRow.cells[2].value || 0) +
                  parseFloat(totalRow.cells[3].value || 0);
              }
            } else if (section.title === "Less Operating Expenses") {
              // Find Total Operating Expenses row
              const totalRow = section.rows.find(
                (r) =>
                  r.rowType === "SummaryRow" &&
                  r.cells[0].value === "Total Operating Expenses"
              );
              if (totalRow) {
                operatingExpenses =
                  parseFloat(totalRow.cells[1].value || 0) +
                  parseFloat(totalRow.cells[2].value || 0) +
                  parseFloat(totalRow.cells[3].value || 0);
              }
            }
          }
        }

        return { revenue, operatingExpenses };
      }

      // Calculate days elapsed in quarter
      function getDaysElapsed(quarterStart, quarterEnd) {
        const today = new Date();
        const startDate = new Date(quarterStart);
        const endDate = new Date(quarterEnd);

        // If quarter hasn't started yet, return 0
        if (today < startDate) return 0;

        // If quarter has ended, return total days
        if (today > endDate) return quarterData.days;

        // Normalize dates to midnight to avoid time component issues
        const todayMidnight = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate()
        );
        const startMidnight = new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          startDate.getDate()
        );

        // Calculate days elapsed (today is not complete, so count up to yesterday)
        const diffTime = todayMidnight - startMidnight;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        return Math.max(0, diffDays);
      }

      const budget = parseBudgetReport(data.report);
      const daysElapsed = getDaysElapsed(quarterData.start, quarterData.end);
      const totalDays = quarterData.days;

      // Calculate pro-rated budget
      const proRatedRevenue = (budget.revenue / totalDays) * daysElapsed;
      const proRatedExpenses =
        (budget.operatingExpenses / totalDays) * daysElapsed;

      let result = `💼 BUDGET SUMMARY - ${quarterData.label}\n\n`;
      result += `📊 FULL QUARTER BUDGET:\n`;
      result += `• Revenue Budget: $${budget.revenue.toLocaleString()}\n`;
      result += `• Operating Expenses Budget: $${budget.operatingExpenses.toLocaleString()}\n`;
      result += `• Net Budget: $${(
        budget.revenue - budget.operatingExpenses
      ).toLocaleString()}\n\n`;

      if (daysElapsed > 0 && daysElapsed < totalDays) {
        result += `⏱️ PRO-RATED BUDGET (${daysElapsed} of ${totalDays} days completed):\n`;
        result += `• Pro-rated Revenue: $${Math.round(
          proRatedRevenue
        ).toLocaleString()}\n`;
        result += `• Pro-rated Operating Expenses: $${Math.round(
          proRatedExpenses
        ).toLocaleString()}\n`;
        result += `• Daily Revenue Budget: $${Math.round(
          budget.revenue / totalDays
        ).toLocaleString()}\n`;
        result += `• Daily Expense Budget: $${Math.round(
          budget.operatingExpenses / totalDays
        ).toLocaleString()}\n\n`;
        result += `ℹ️ Use pro-rated amounts for actual vs budget comparison\n`;
      } else if (daysElapsed === 0) {
        result += `ℹ️ Quarter has not started yet\n`;
      } else {
        result += `✅ Quarter complete - use full quarter amounts\n`;
      }

      return { content: [{ type: "text", text: result }] };
    }

    // Simple API endpoint mappings
    const API_MAPPINGS = {
      get_trial_balance: { path: "/api/trial-balance", params: ["reportDate"] },
      get_cash_position: { path: "/api/cash-position", params: [] },
      get_outstanding_invoices: {
        path: "/api/outstanding-invoices",
        params: [],
      },
      get_profit_loss_summary: {
        path: "/api/profit-loss",
        params: ["date", "periodMonths"],
      },
      get_journal_entries: {
        path: "/api/journal-entries",
        params: ["dateFrom", "dateTo", "accountName"],
      },
      analyze_equity_movements: {
        path: "/api/equity-analysis",
        params: ["equityAccountName", "monthsBack"],
      },
      get_account_history: {
        path: "/api/account-history",
        params: ["dateFrom", "dateTo"],
        pathParam: "accountName",
      },
      find_unbalanced_transactions: {
        path: "/api/find-unbalanced",
        params: ["minimumAmount", "dateRange"],
      },
      get_chart_of_accounts: {
        path: "/api/chart-of-accounts",
        params: ["accountType", "includeArchived"],
      },
      compare_periods: {
        path: "/api/compare-periods",
        params: ["fromDate", "toDate", "accountFilter"],
      },
      get_aged_receivables: { path: "/api/aged-receivables", params: ["date"] },
      analyze_expense_categories: {
        path: "/api/expense-analysis",
        params: ["date", "periodMonths"],
      },
      get_intercompany_transactions: {
        path: "/api/intercompany",
        params: ["date"],
      },
      get_financial_ratios: { path: "/api/financial-ratios", params: ["date"] },
      get_invoices_detail: {
        path: "/api/invoices-detail",
        params: ["dateFrom", "dateTo", "status"],
      },
    };

    // Non-tenant API calls
    if (name === "get_consolidated_trial_balance") {
      return await handleAPICall("/api/consolidated-trial-balance", {
        reportDate: args.reportDate,
      });
    }

    // Tenant-based API calls
    const mapping = API_MAPPINGS[name];
    if (mapping) {
      const queryParams = mapping.params.reduce((obj, param) => {
        if (args[param] !== undefined) obj[param] = args[param];
        return obj;
      }, {});

      let apiPath = mapping.path;

      // Handle special case where accountName is part of path
      if (mapping.pathParam && args[mapping.pathParam]) {
        apiPath = `${apiPath}/${encodeURIComponent(args[mapping.pathParam])}`;
      }

      return await handleTenantAPICall(args, apiPath, queryParams);
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Error: ${error.message}`,
        },
      ],
    };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);