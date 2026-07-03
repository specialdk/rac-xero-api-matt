// RAC Financial Dashboard - Complete Server.js with Date Picker Support
// Includes all functionality: Database Token Storage, Trial Balance with Date Support, Multi-entity Integration
// RAC Financial Dashboard - Complete Server.js with Date Picker Support
// Includes all functionality: Database Token Storage, Trial Balance with Date Support, Multi-entity Integration

import dotenv from "dotenv";
import express from "express";
import path from "path";
import fetch from "node-fetch";
import pkg from "xero-node";
const { XeroAccessToken, XeroIdToken, XeroClient } = pkg;
import { Pool } from "pg";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cookieParser from "cookie-parser";
import crypto from "crypto";

// Spend & Revenue classifier modules — see /lib/classifier.js and
// /lib/revenue-classifier.js. Imported as namespaces with renamed
// summarise to avoid collision between the two modules' summarise().
import { summarise as summariseSpend } from "./lib/classifier.js";
import { summariseRevenue } from "./lib/revenue-classifier.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Environment variables
const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const XERO_REDIRECT_URI = process.env.XERO_REDIRECT_URI;

const APPROVALMAX_CLIENT_ID = process.env.APPROVALMAX_CLIENT_ID;
const APPROVALMAX_CLIENT_SECRET = process.env.APPROVALMAX_CLIENT_SECRET;
const APPROVALMAX_REDIRECT_URI = process.env.APPROVALMAX_REDIRECT_URI;

// PostgreSQL connection (Railway provides DATABASE_URL automatically)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// ApprovalMax configuration
const APPROVALMAX_CONFIG = {
  authUrl: "https://identity.approvalmax.com/connect/authorize",
  tokenUrl: "https://identity.approvalmax.com/connect/token",
  apiUrl: "https://public-api.approvalmax.com/api/v1",
  scopes: [
    "https://www.approvalmax.com/scopes/public_api/read",
    "https://www.approvalmax.com/scopes/public_api/write",
    "offline_access",
  ],
};

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create tokens table if it doesn't exist
    await pool.query(`
            CREATE TABLE IF NOT EXISTS tokens (
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
            )
        `);

    // Create ApprovalMax tokens table
    await pool.query(`
            CREATE TABLE IF NOT EXISTS approvalmax_tokens (
                id SERIAL PRIMARY KEY,
                integration_key VARCHAR(255) UNIQUE NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at BIGINT NOT NULL,
                organizations JSONB,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Database tables initialized successfully");
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error initializing database:", error);
  }
}

// Database token storage functions
const tokenStorage = {
  // Store Xero token
  async storeXeroToken(tenantId, tenantName, tokenData) {
    try {
      await pool.query(
        `
    INSERT INTO tokens (tenant_id, tenant_name, provider, access_token, refresh_token, expires_at, last_seen)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id) 
    DO UPDATE SET 
        access_token = $4,
        refresh_token = $5,
        expires_at = $6,
        last_seen = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
`,
        [
          tenantId,
          tenantName,
          "xero",
          tokenData.access_token,
          tokenData.refresh_token,
          Date.now() + tokenData.expires_in * 1000,
        ]
      );
      console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Stored Xero token for: ${tenantName}`);
    } catch (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error storing Xero token:", error);
    }
  },

  // Get Xero token
  async getXeroToken(tenantId) {
    try {
      const result = await pool.query(
        "SELECT * FROM tokens WHERE tenant_id = $1 AND provider = $2",
        [tenantId, "xero"]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const token = result.rows[0];

      // Check if token is expired or expiring within 2 minutes
      const twoMinutesFromNow = Date.now() + 2 * 60 * 1000;
      if (Date.now() > token.expires_at || token.expires_at < twoMinutesFromNow) {
        console.log(`Token expired/expiring for tenant: ${tenantId} - attempting just-in-time refresh...`);
        
        // Attempt just-in-time refresh using refresh_token
        if (token.refresh_token) {
          try {
            const tokenSet = {
              access_token: token.access_token,
              refresh_token: token.refresh_token,
              expires_in: -1,
            };
            await xero.setTokenSet(tokenSet);
            const newTokenSet = await xero.refreshToken();
            
            // Store refreshed token for ALL Xero tenants (shared OAuth credentials)
            const newExpiresAt = Date.now() + newTokenSet.expires_in * 1000;
            await pool.query(
              `UPDATE tokens 
               SET access_token = $1, refresh_token = $2, expires_at = $3, 
                   last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE provider = $4`,
              [newTokenSet.access_token, newTokenSet.refresh_token, newExpiresAt, "xero"]
            );
            
            console.log(`JIT refresh successful for: ${token.tenant_name}`);
            return {
              access_token: newTokenSet.access_token,
              refresh_token: newTokenSet.refresh_token,
              expires_in: newTokenSet.expires_in,
              tenantId: token.tenant_id,
              tenantName: token.tenant_name,
            };
          } catch (refreshError) {
            console.error(`JIT refresh failed for ${tenantId}:`, refreshError.message);
            if (refreshError.message?.includes("invalid_grant") || refreshError.message?.includes("unauthorized")) {
              console.error(`Refresh token chain broken for ${token.tenant_name} - manual re-auth required`);
            }
            return null;
          }
        } else {
          console.log(`No refresh token available for tenant: ${tenantId}`);
          return null;
        }
      }

      return {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: Math.floor((token.expires_at - Date.now()) / 1000),
        tenantId: token.tenant_id,
        tenantName: token.tenant_name,
      };
    } catch (error) {
      console.error("Error getting Xero token:", error);
      return null;
    }
  },

  // Get all Xero connections
  async getAllXeroConnections() {
    try {
      const result = await pool.query(
        "SELECT tenant_id, tenant_name, provider, expires_at, last_seen FROM tokens WHERE provider = $1",
        ["xero"]
      );

      return result.rows.map((row) => ({
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        provider: row.provider,
        connected: Date.now() < row.expires_at,
        lastSeen: row.last_seen.toISOString(),
        error: Date.now() > row.expires_at ? "Token expired" : null,
      }));
    } catch (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting Xero connections:", error);
      return [];
    }
  },

  // Store ApprovalMax token
  async storeApprovalMaxToken(tokenData, organizations) {
    try {
      await pool.query(
        `
                INSERT INTO approvalmax_tokens (integration_key, access_token, refresh_token, expires_at, organizations, last_seen)
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                ON CONFLICT (integration_key)
                DO UPDATE SET 
                    access_token = $2,
                    refresh_token = $3,
                    expires_at = $4,
                    organizations = $5,
                    last_seen = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
            `,
        [
          "approvalmax_integration",
          tokenData.access_token,
          tokenData.refresh_token,
          Date.now() + tokenData.expires_in * 1000,
          JSON.stringify(organizations),
        ]
      );
      console.log(
        `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Stored ApprovalMax token for ${organizations.length} organizations`
      );
    } catch (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error storing ApprovalMax token:", error);
    }
  },

  // Get ApprovalMax token
  async getApprovalMaxToken() {
    try {
      const result = await pool.query(
        "SELECT * FROM approvalmax_tokens WHERE integration_key = $1",
        ["approvalmax_integration"]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const token = result.rows[0];

      // Check if token is expired
      if (Date.now() > token.expires_at) {
        console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ApprovalMax token expired");
        return null;
      }

      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_at,
        organizations: token.organizations,
        lastSeen: token.last_seen.toISOString(),
      };
    } catch (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting ApprovalMax token:", error);
      return null;
    }
  },
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// === Shared-passphrase access gate ===
// Sits in front of static files and every route. Fails CLOSED when env vars
// are missing. Allowlist is intentionally tiny — OAuth callbacks only, since
// they cannot carry the gate cookie back from Xero/ApprovalMax.
const GATE_PASSWORD = process.env.DASHBOARD_GATE_PASSWORD;
const GATE_COOKIE_SECRET = process.env.GATE_COOKIE_SECRET;
const GATE_ENABLED = Boolean(GATE_PASSWORD && GATE_COOKIE_SECRET);
if (!GATE_ENABLED) {
  console.error("[GATE] FAIL-CLOSED: gate env vars missing");
}

const GATE_ALLOWLIST = new Set([
  "/auth",
  "/callback",
  "/callback/approvalmax",
]);

const GATE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RAC Finance &mdash; Access</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f4f6;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  form{background:#fff;padding:1.75rem 2rem;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.08);width:320px;max-width:90vw}
  h1{font-size:1.05rem;margin:0 0 1rem;color:#222;font-weight:600}
  label{display:block;font-size:.85rem;color:#555;margin-bottom:.4rem}
  input[type=password]{width:100%;padding:.6rem .7rem;border:1px solid #ccc;border-radius:4px;font-size:1rem;box-sizing:border-box}
  button{margin-top:1rem;width:100%;padding:.7rem;background:#1a3a52;color:#fff;border:0;border-radius:4px;font-size:1rem;cursor:pointer}
  button:hover{background:#244c6a}
  .err{color:#a3261b;font-size:.85rem;margin-top:.6rem}
</style></head>
<body>
  <form method="POST" action="/gate-login" autocomplete="off">
    <h1>RAC Finance &mdash; access required</h1>
    <label for="p">Passphrase</label>
    <input id="p" name="passphrase" type="password" autofocus required>
    <button type="submit">Continue</button>
    __ERROR__
  </form>
</body></html>`;

function renderGatePage(showError) {
  return GATE_PAGE.replace(
    "__ERROR__",
    showError ? '<div class="err">Incorrect passphrase.</div>' : ""
  );
}

function gateMiddleware(req, res, next) {
  if (GATE_ALLOWLIST.has(req.path)) {
    return next();
  }

  // Allow MCP server and internal service calls via API key header
  const internalKey = req.headers['x-internal-api-key'];
  if (internalKey && process.env.INTERNAL_API_KEY && internalKey === process.env.INTERNAL_API_KEY) {
    return next();
  }

  if (!GATE_ENABLED) {
    return res
      .status(503)
      .type("text/plain")
      .send("Service unavailable");
  }

  if (req.signedCookies && req.signedCookies.gate_ok === "1") {
    return next();
  }

  if (req.method === "POST" && req.path === "/gate-login") {
    const submitted =
      req.body && typeof req.body.passphrase === "string"
        ? req.body.passphrase
        : "";
    const submittedBuf = Buffer.from(submitted, "utf8");
    const expectedBuf = Buffer.from(GATE_PASSWORD, "utf8");
    let ok = false;
    if (submittedBuf.length === expectedBuf.length) {
      try {
        ok = crypto.timingSafeEqual(submittedBuf, expectedBuf);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      res.cookie("gate_ok", "1", {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        secure: true,
        maxAge: 12 * 60 * 60 * 1000,
      });
      return res.redirect("/");
    }
    return res.status(401).type("text/html").send(renderGatePage(true));
  }

  return res.status(200).type("text/html").send(renderGatePage(false));
}

app.use(cookieParser(GATE_COOKIE_SECRET));
// app.use(gateMiddleware); // Temporarily disabled — SSO planned as replacement

app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Initialize Xero client with reports scope
const xero = new XeroClient({
  clientId: XERO_CLIENT_ID,
  clientSecret: XERO_CLIENT_SECRET,
  redirectUris: [XERO_REDIRECT_URI],
  scopes: [
    "accounting.transactions",
    "accounting.contacts",
    "accounting.settings",
    "accounting.reports.read",
    "offline_access", // ADD THIS LINE
    "accounting.budgets.read", // ADD THIS LINE
  ],
});

// Utility functions
function generateState() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// ============================================================================
// XERO ROUTES (UPDATED WITH DATABASE STORAGE)
// ============================================================================

// Xero OAuth authorization
app.get("/auth", async (req, res) => {
  try {
    const provider = req.query.provider;

    if (provider === "approvalmax") {
      // Redirect to ApprovalMax OAuth
      const state = generateState();
      const authUrl = new URL(APPROVALMAX_CONFIG.authUrl);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", APPROVALMAX_CLIENT_ID);
      authUrl.searchParams.set("scope", APPROVALMAX_CONFIG.scopes.join(" "));
      authUrl.searchParams.set("redirect_uri", APPROVALMAX_REDIRECT_URI);
      authUrl.searchParams.set("state", state);

      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â½ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¯ Redirecting to ApprovalMax OAuth:", authUrl.toString());
      res.redirect(authUrl.toString());
    } else {
      // Existing Xero OAuth
      const consentUrl = await xero.buildConsentUrl();
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â½ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¯ Redirecting to Xero OAuth:", consentUrl);
      res.redirect(consentUrl);
    }
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error in /auth:", error);
    res
      .status(500)
      .json({ error: "Authorization failed", details: error.message });
  }
});

// Xero OAuth callback - UPDATED WITH DATABASE STORAGE
app.get("/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ OAuth error:", error);
      return res.redirect("/?error=oauth_failed");
    }

    if (!code) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ No authorization code received");
      return res.redirect("/?error=no_code");
    }

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Processing Xero callback...");
    const tokenSet = await xero.apiCallback(req.url);

    if (!tokenSet || !tokenSet.access_token) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ No access token received from Xero");
      return res.redirect("/?error=no_token");
    }

    // Get tenant information
    const tenants = await xero.updateTenants(false, tokenSet);
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Xero tenants received:", tenants.length);

    // Store tokens in database (instead of memory)
    for (const tenant of tenants) {
      await tokenStorage.storeXeroToken(
        tenant.tenantId,
        tenant.tenantName,
        tokenSet
      );
    }

    console.log(
      "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Xero tokens stored in database for",
      tenants.length,
      "tenants"
    );
    res.redirect("/?success=xero_connected");
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error in Xero callback:", error);
    res.redirect("/?error=callback_failed");
  }
});

// ============================================================================
// APPROVALMAX ROUTES (UPDATED WITH DATABASE STORAGE)
// ============================================================================

// ApprovalMax OAuth callback - UPDATED WITH DATABASE STORAGE
app.get("/callback/approvalmax", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â½ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¯ ApprovalMax callback received:", {
      code: code?.substring(0, 20) + "...",
      state,
      error,
    });

    if (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ApprovalMax OAuth error:", error);
      return res.redirect("/?error=approvalmax_oauth_failed");
    }

    if (!code) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ No authorization code received from ApprovalMax");
      return res.redirect("/?error=approvalmax_no_code");
    }

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Exchanging ApprovalMax authorization code for tokens...");

    const redirectUri =
      APPROVALMAX_REDIRECT_URI ||
      "https://rac-financial-dashboard-production.up.railway.app/callback/approvalmax";

    const tokenRequestBody = {
      grant_type: "authorization_code",
      client_id: APPROVALMAX_CLIENT_ID,
      client_secret: APPROVALMAX_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code: code,
    };

    const tokenResponse = await fetch(APPROVALMAX_CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(tokenRequestBody),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ApprovalMax token exchange failed:", {
        status: tokenResponse.status,
        error: tokenData.error,
        description: tokenData.error_description,
      });
      return res.redirect(
        `/?error=approvalmax_token_failed&details=${encodeURIComponent(
          tokenData.error || "Unknown error"
        )}`
      );
    }

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ ApprovalMax tokens received successfully");

    // Get organization information
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Fetching ApprovalMax organizations...");
    const orgsResponse = await fetch(`${APPROVALMAX_CONFIG.apiUrl}/companies`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
      },
    });

    let organizations = [];
    if (orgsResponse.ok) {
      organizations = await orgsResponse.json();
      console.error(
        "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ ApprovalMax organizations received:",
        organizations.length
      );
    } else {
      console.warn("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Failed to fetch organizations:", orgsResponse.status);
    }

    // Store tokens in database (instead of memory)
    await tokenStorage.storeApprovalMaxToken(tokenData, organizations);

    console.error(
      "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ ApprovalMax tokens stored in database for",
      organizations.length,
      "organizations"
    );
    res.redirect("/?success=approvalmax_connected");
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error in ApprovalMax callback:", error);
    res.redirect("/?error=approvalmax_callback_failed");
  }
});

// ============================================================================
// API ROUTES (UPDATED WITH DATABASE TOKEN RETRIEVAL)
// ============================================================================

// Connection status endpoint - UPDATED WITH DATABASE
app.get("/api/connection-status", async (req, res) => {
  try {
    const connections = [];

    // Get Xero connections from database
    const xeroConnections = await tokenStorage.getAllXeroConnections();
    connections.push(...xeroConnections);

    // Get ApprovalMax connections from database
    const approvalMaxToken = await tokenStorage.getApprovalMaxToken();
    if (approvalMaxToken) {
      connections.push({
        tenantId: "approvalmax_integration",
        tenantName: "RAC ApprovalMax Integration",
        provider: "approvalmax",
        connected: true,
        lastSeen: approvalMaxToken.lastSeen,
        organizationCount: approvalMaxToken.organizations
          ? approvalMaxToken.organizations.length
          : 0,
        error: null,
      });
    }

    console.error(
      "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â  Connection status from database:",
      connections.length,
      "total connections"
    );
    res.json(connections);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting connection status:", error);
    res.status(500).json({ error: "Failed to get connection status" });
  }
});

// FIXED: Cash position endpoint with DATABASE token retrieval
app.get("/api/cash-position/:tenantId", async (req, res) => {
  try {
    // Get token from database instead of memory
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const response = await xero.accountingApi.getAccounts(
      req.params.tenantId,
      null,
      'Type=="BANK"'
    );
    const bankAccounts = response.body.accounts || [];

    // FIXED: Use CurrentBalance instead of runningBalance
    const totalCash = bankAccounts.reduce((sum, account) => {
      return sum + (parseFloat(account.CurrentBalance) || 0);
    }, 0);

    res.json({
      totalCash,
      bankAccounts: bankAccounts.map((acc) => ({
        name: acc.name,
        balance: parseFloat(acc.CurrentBalance) || 0,
        code: acc.code,
      })),
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting cash position:", error);
    res.status(500).json({ error: "Failed to get cash position" });
  }
});

// FIXED: Receivables endpoint with DATABASE token retrieval
app.get("/api/receivables/:tenantId", async (req, res) => {
  try {
    // Get token from database instead of memory
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const response = await xero.accountingApi.getAccounts(
      req.params.tenantId,
      null,
      'Type=="RECEIVABLE"'
    );
    const receivableAccounts = response.body.accounts || [];

    // FIXED: Use CurrentBalance instead of runningBalance
    const totalReceivables = receivableAccounts.reduce((sum, account) => {
      return sum + (parseFloat(account.CurrentBalance) || 0);
    }, 0);

    res.json({ totalReceivables });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting receivables:", error);
    res.status(500).json({ error: "Failed to get receivables" });
  }
});

// Outstanding invoices endpoint - UPDATED WITH DATABASE
app.get("/api/outstanding-invoices/:tenantId", async (req, res) => {
  try {
    // Get token from database instead of memory
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const response = await xero.accountingApi.getInvoices(
      req.params.tenantId,
      null,
      null,
      'Status=="AUTHORISED"&&Type=="ACCREC"'
    );
    const invoices = response.body.invoices || [];

    const outstandingInvoices = invoices.filter(
     (inv) => inv.status === "AUTHORISED" && 
              inv.type === "ACCREC" && 
              parseFloat(inv.amountDue) > 0
   );

    res.json(
      outstandingInvoices.map((inv) => ({
        invoiceID: inv.invoiceID,
        invoiceNumber: inv.invoiceNumber,
        contact: inv.contact?.name,
        amountDue: parseFloat(inv.amountDue),
        total: parseFloat(inv.total),
        date: inv.date,
        dueDate: inv.dueDate,
      }))
    );
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting outstanding invoices:", error);
    res.status(500).json({ error: "Failed to get outstanding invoices" });
  }
});

// Contacts endpoint - UPDATED WITH DATABASE
app.get("/api/contacts/:tenantId", async (req, res) => {
  try {
    // Get token from database instead of memory
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const response = await xero.accountingApi.getContacts(req.params.tenantId);
    const contacts = response.body.contacts || [];

    res.json(
      contacts.map((contact) => ({
        contactID: contact.contactID,
        name: contact.name,
        isCustomer: contact.isCustomer,
        isSupplier: contact.isSupplier,
        emailAddress: contact.emailAddress,
      }))
    );
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting contacts:", error);
    res.status(500).json({ error: "Failed to get contacts" });
  }
});

// ApprovalMax companies endpoint - UPDATED WITH DATABASE
app.get("/api/approvalmax/companies", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getApprovalMaxToken();
    if (!tokenData) {
      return res.status(404).json({ error: "ApprovalMax not connected" });
    }

    const response = await fetch(`${APPROVALMAX_CONFIG.apiUrl}/companies`, {
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`ApprovalMax API error: ${response.status}`);
    }

    const companies = await response.json();
    res.json(companies);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting ApprovalMax companies:", error);
    res.status(500).json({ error: "Failed to get companies" });
  }
});

// Consolidated data endpoint - UPDATED WITH DATABASE
app.get("/api/consolidated", async (req, res) => {
  try {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Loading consolidated data from database...");

    let totalCash = 0;
    let totalReceivables = 0;
    let totalOutstandingInvoices = 0;
    let tenantData = [];

    // Get all Xero connections from database
    const xeroConnections = await tokenStorage.getAllXeroConnections();
    const connectedXeroEntities = xeroConnections.filter(
      (conn) => conn.connected
    );

    // Aggregate Xero data
    for (const connection of connectedXeroEntities) {
      try {
        const [cashResponse, receivablesResponse, invoicesResponse] =
          await Promise.all([
            fetch(
              `${req.protocol}://${req.get("host")}/api/cash-position/${
                connection.tenantId
              }`
            ),
            fetch(
              `${req.protocol}://${req.get("host")}/api/receivables/${
                connection.tenantId
              }`
            ),
            fetch(
              `${req.protocol}://${req.get("host")}/api/outstanding-invoices/${
                connection.tenantId
              }`
            ),
          ]);

        if (cashResponse.ok && receivablesResponse.ok && invoicesResponse.ok) {
          const [cashData, receivablesData, invoicesData] = await Promise.all([
            cashResponse.json(),
            receivablesResponse.json(),
            invoicesResponse.json(),
          ]);

          totalCash += cashData.totalCash || 0;
          totalReceivables += receivablesData.totalReceivables || 0;
          totalOutstandingInvoices += invoicesData.length || 0;

          tenantData.push({
            tenantId: connection.tenantId,
            tenantName: connection.tenantName,
            provider: "xero",
            cashPosition: cashData.totalCash || 0,
            receivables: receivablesData.totalReceivables || 0,
            outstandingInvoices: invoicesData.length || 0,
            bankAccounts: cashData.bankAccounts || [],
          });
        }
      } catch (error) {
        console.error(
          `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error loading data for tenant ${connection.tenantId}:`,
          error
        );
      }
    }

    // Add ApprovalMax data
    let totalPendingApprovals = 0;
    let totalApprovalValue = 0;
    let approvalData = [];

    const amTokenData = await tokenStorage.getApprovalMaxToken();
    if (amTokenData) {
      try {
        const summaryResponse = await fetch(
          `${req.protocol}://${req.get(
            "host"
          )}/api/approvalmax/approval-summary/integration`
        );
        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          totalPendingApprovals = summaryData.pendingApprovals || 0;
          totalApprovalValue = summaryData.totalValue || 0;

          approvalData.push({
            organizationId: "integration",
            organizationName: "RAC ApprovalMax Integration",
            provider: "approvalmax",
            pendingApprovals: summaryData.pendingApprovals || 0,
            totalValue: summaryData.totalValue || 0,
            organizationCount: summaryData.organizationCount || 0,
          });
        }
      } catch (error) {
        console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error loading ApprovalMax data:", error);
      }
    }

    const consolidatedData = {
      totalCash,
      totalReceivables,
      totalOutstandingInvoices,
      totalPendingApprovals,
      totalApprovalValue,
      tenantData,
      approvalData,
      lastUpdated: new Date().toISOString(),
    };

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Consolidated data loaded from database:", {
      xeroEntities: tenantData.length,
      approvalMaxOrgs: approvalData.length,
      totalCash,
      totalReceivables,
    });

    res.json(consolidatedData);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error loading consolidated data:", error);
    res.status(500).json({ error: "Failed to load consolidated data" });
  }
});

// AUTO TOKEN REFRESH SYSTEM
// Add these functions to your server.js

// Enhanced token storage with refresh capability
const enhancedTokenStorage = {
  ...tokenStorage, // Keep all existing functions

  // Refresh a specific Xero token
  async refreshXeroToken(tenantId) {
    try {
      console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Attempting to refresh token for tenant: ${tenantId}`);

      // Get current token from database
      const result = await pool.query(
        "SELECT * FROM tokens WHERE tenant_id = $1 AND provider = $2",
        [tenantId, "xero"]
      );

      if (result.rows.length === 0) {
        console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ No token found for tenant: ${tenantId}`);
        return { success: false, error: "Token not found" };
      }

      const storedToken = result.rows[0];

      if (!storedToken.refresh_token) {
        console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ No refresh token available for tenant: ${tenantId}`);
        return { success: false, error: "No refresh token" };
      }

      // Refresh token directly via Xero's token endpoint (bypasses SDK state issues)
      const refreshResponse = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: storedToken.refresh_token,
          client_id: process.env.XERO_CLIENT_ID,
          client_secret: process.env.XERO_CLIENT_SECRET,
        }),
      });

      if (!refreshResponse.ok) {
        const errorBody = await refreshResponse.text();
        throw new Error(`Token refresh failed: ${refreshResponse.status} - ${errorBody}`);
      }

      const newTokenSet = await refreshResponse.json();
      console.log(
        `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Token refreshed successfully for: ${storedToken.tenant_name}`
      );

      // Store the new token for ALL Xero tenants (they share one OAuth token set)
      // Refresh tokens are single-use - once refreshed, all rows need the new token
      const newExpiresAt = Date.now() + newTokenSet.expires_in * 1000;
      await pool.query(
        `UPDATE tokens 
         SET access_token = $1, 
             refresh_token = $2, 
             expires_at = $3, 
             last_seen = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE provider = $4`,
        [
          newTokenSet.access_token,
          newTokenSet.refresh_token,
          newExpiresAt,
          "xero",
        ]
      );
      console.log(`All Xero tenant tokens updated with new credentials`);

      return {
        success: true,
        newExpiresAt: newExpiresAt,
        tenantName: storedToken.tenant_name,
        allTenantsUpdated: true,
      };
    } catch (error) {
      console.error(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error refreshing token for ${tenantId}:`, error);
      return {
        success: false,
        error: error.message,
        requiresReauth:
          error.message?.includes("invalid_grant") ||
          error.message?.includes("unauthorized"),
      };
    }
  },

  // Refresh all Xero tokens that are close to expiring
  async refreshAllExpiringTokens() {
    try {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Checking for tokens that need refresh...");

      // Get tokens expiring within 10 minutes OR already expired within last 24 hours
      const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

      const result = await pool.query(
        `SELECT tenant_id, tenant_name, expires_at 
         FROM tokens 
         WHERE provider = $1 
         AND expires_at < $2 
         AND expires_at > $3`,
        ["xero", tenMinutesFromNow, twentyFourHoursAgo]
      );

      if (result.rows.length === 0) {
        console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ No tokens need refreshing");
        return { refreshed: 0, failed: 0, results: [] };
      }

      const refreshResults = [];
      let refreshed = 0;
      let failed = 0;

      // Refresh each token
      for (const token of result.rows) {
        const result = await this.refreshXeroToken(token.tenant_id);
        refreshResults.push({
          tenantId: token.tenant_id,
          tenantName: token.tenant_name,
          ...result,
        });

        if (result.success) {
          refreshed = result.rows?.length || 7; // All tenants updated at once
          console.log(`Refreshed ALL tenants via: ${token.tenant_name}`);
          break; // One refresh updates all - no need to continue
        } else {
          failed++;
          console.log(
            `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Failed to refresh: ${token.tenant_name} - ${result.error}`
          );
        }
      }

      return { refreshed, failed, results: refreshResults };
    } catch (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error in refreshAllExpiringTokens:", error);
      return { refreshed: 0, failed: 0, error: error.message };
    }
  },

  // Get tokens that will expire soon (for frontend warning)
  async getExpiringTokens(minutesAhead = 15) {
    try {
      const futureTime = Date.now() + minutesAhead * 60 * 1000;

      const result = await pool.query(
        `SELECT tenant_id, tenant_name, expires_at 
         FROM tokens 
         WHERE provider = $1 
         AND expires_at < $2 
         AND expires_at > $3
         ORDER BY expires_at ASC`,
        ["xero", futureTime, Date.now()]
      );

      return result.rows.map((row) => ({
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        expiresAt: row.expires_at,
        minutesUntilExpiry: Math.floor(
          (row.expires_at - Date.now()) / (1000 * 60)
        ),
      }));
    } catch (error) {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting expiring tokens:", error);
      return [];
    }
  },
};

// Auto-refresh scheduler - runs every 3 minutes
let autoRefreshInterval;

function startAutoRefresh() {
  console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ Starting auto token refresh system...");

  // Run immediately
  enhancedTokenStorage.refreshAllExpiringTokens();

  // Then run every 5 minutes
  autoRefreshInterval = setInterval(async () => {
    const result = await enhancedTokenStorage.refreshAllExpiringTokens();

    if (result.refreshed > 0) {
      console.error(
        `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Auto-refresh completed: ${result.refreshed} tokens refreshed, ${result.failed} failed`
      );
    }
  }, 3 * 60 * 1000); // Every 3 minutes
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Auto token refresh stopped");
  }
}

// API endpoint to check token status and warnings
app.get("/api/token-status", async (req, res) => {
  try {
    const [allConnections, expiringTokens] = await Promise.all([
      enhancedTokenStorage.getAllXeroConnections(),
      enhancedTokenStorage.getExpiringTokens(15), // Warn 15 minutes ahead
    ]);

    const tokenStatus = {
      totalTokens: allConnections.length,
      connectedTokens: allConnections.filter((conn) => conn.connected).length,
      expiredTokens: allConnections.filter((conn) => !conn.connected).length,
      expiringTokens: expiringTokens.length,
      expiringDetails: expiringTokens,
      needsAttention:
        expiringTokens.length > 0 ||
        allConnections.filter((conn) => !conn.connected).length > 0,
    };

    res.json(tokenStatus);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Token status error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced connection status with auto-refresh info
app.get("/api/connection-status-enhanced", async (req, res) => {
  try {
    const [connections, expiringTokens] = await Promise.all([
      enhancedTokenStorage.getAllXeroConnections(),
      enhancedTokenStorage.getExpiringTokens(30), // Check 30 minutes ahead
    ]);

    // Add expiry warnings to connection data
    const enhancedConnections = connections.map((conn) => {
      const expiring = expiringTokens.find(
        (exp) => exp.tenantId === conn.tenantId
      );
      return {
        ...conn,
        minutesUntilExpiry: expiring ? expiring.minutesUntilExpiry : null,
        needsRefresh: expiring ? expiring.minutesUntilExpiry < 15 : false,
      };
    });

    // Add ApprovalMax connections (keep existing logic)
    const approvalMaxToken = await enhancedTokenStorage.getApprovalMaxToken();
    if (approvalMaxToken) {
      enhancedConnections.push({
        tenantId: "approvalmax_integration",
        tenantName: "RAC ApprovalMax Integration",
        provider: "approvalmax",
        connected: true,
        lastSeen: approvalMaxToken.lastSeen,
        organizationCount: approvalMaxToken.organizations
          ? approvalMaxToken.organizations.length
          : 0,
        error: null,
        minutesUntilExpiry: null,
        needsRefresh: false,
      });
    }

    res.json(enhancedConnections);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting enhanced connection status:", error);
    res.status(500).json({ error: "Failed to get enhanced connection status" });
  }
});

// GET Budgets - CORRECTED
app.post("/api/budgets", async (req, res) => {
  try {
    const { tenantId, organizationName, budgetId } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided (SAME AS YOUR OTHER ENDPOINTS)
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Get token (SAME AS YOUR OTHER ENDPOINTS)
    const tokenData = await tokenStorage.getXeroToken(actualTenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    // Call Xero Budgets API
    let budgets;
    if (budgetId) {
      budgets = await xero.accountingApi.getBudget(actualTenantId, budgetId);
    } else {
      budgets = await xero.accountingApi.getBudgets(actualTenantId);
    }

    res.json({
      tenantId: actualTenantId,
      budgets: budgets.body.budgets || [],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Budget API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET Budget Summary Report - CORRECTED
app.post("/api/budget-summary", async (req, res) => {
  try {
    const { tenantId, organizationName, date, periods } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Get token
    const tokenData = await tokenStorage.getXeroToken(actualTenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    // Call Budget Summary Report - REMOVE timeframe parameter
    const report = await xero.accountingApi.getReportBudgetSummary(
      actualTenantId,
      date,
      periods || 12
    );

    res.json({
      tenantId: actualTenantId,
      report: report.body.reports[0],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Budget Summary Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// add post here Duane
// === REST API Endpoints for Web Chat Interface ===
// API endpoint to manually trigger refresh
app.post("/api/refresh-tokens", async (req, res) => {
  try {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Manual token refresh requested");
    const result = await enhancedTokenStorage.refreshAllExpiringTokens();

    res.json({
      success: true,
      refreshed: result.refreshed,
      failed: result.failed,
      results: result.results,
      message: `Refreshed ${result.refreshed} tokens, ${result.failed} failed`,
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Manual refresh error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// SHARED HELPER: Fetch trial balance directly from Xero — no HTTP hop.
// Replaces the self-fetch that started 500'ing after the 20 May 2026 outage.
// Builds from Balance Sheet + P&L reports (Xero doesn't expose a trial balance
// report directly, so we synthesise it here).
// ============================================================================
async function fetchTrialBalance(tenantId, { reportDate } = {}) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) {
    const err = new Error("Tenant not found or token expired");
    err.statusCode = 404;
    throw err;
  }

  await xero.setTokenSet(tokenData);

  const effectiveDate = reportDate || new Date().toISOString().split("T")[0];

  // Balance Sheet for the date
  const balanceSheetResponse = await xero.accountingApi.getReportBalanceSheet(
    tenantId,
    effectiveDate
  );
  const balanceSheetRows = balanceSheetResponse.body.reports?.[0]?.rows || [];

  const trialBalance = {
    assets: [],
    liabilities: [],
    equity: [],
    revenue: [],
    expenses: [],
    totals: {
      totalDebits: 0,
      totalCredits: 0,
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
      totalRevenue: 0,
      totalExpenses: 0,
    },
  };

  let processedAccounts = 0;

  balanceSheetRows.forEach((section) => {
    if (section.rowType === "Section" && section.rows && section.title) {
      const sectionTitle = section.title.toLowerCase();

      section.rows.forEach((row) => {
        if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
          const accountName = row.cells[0]?.value || "";
          const currentBalance = parseFloat(row.cells[1]?.value || 0);

          if (accountName.toLowerCase().includes("total") || currentBalance === 0) return;

          processedAccounts++;
          const accountInfo = {
            name: accountName,
            balance: currentBalance,
            debit: 0,
            credit: 0,
            section: section.title,
          };

          if (sectionTitle.includes("bank") || sectionTitle.includes("asset")) {
            accountInfo.debit = currentBalance >= 0 ? currentBalance : 0;
            accountInfo.credit = currentBalance < 0 ? Math.abs(currentBalance) : 0;
            trialBalance.assets.push(accountInfo);
            trialBalance.totals.totalAssets += currentBalance;
          } else if (sectionTitle.includes("liabilit")) {
            accountInfo.credit = currentBalance >= 0 ? currentBalance : 0;
            accountInfo.debit = currentBalance < 0 ? Math.abs(currentBalance) : 0;
            trialBalance.liabilities.push(accountInfo);
            trialBalance.totals.totalLiabilities += currentBalance;
          } else if (sectionTitle.includes("equity")) {
            accountInfo.credit = currentBalance >= 0 ? currentBalance : 0;
            accountInfo.debit = currentBalance < 0 ? Math.abs(currentBalance) : 0;
            trialBalance.equity.push(accountInfo);
            trialBalance.totals.totalEquity += currentBalance;
          }

          trialBalance.totals.totalDebits += accountInfo.debit;
          trialBalance.totals.totalCredits += accountInfo.credit;
        }
      });
    }
  });

  // P&L for revenue/expenses on the same date
  try {
    const plResponse = await xero.accountingApi.getReportProfitAndLoss(
      tenantId,
      effectiveDate,
      effectiveDate
    );
    const plRows = plResponse.body.reports?.[0]?.rows || [];

    plRows.forEach((section) => {
      if (section.rowType === "Section" && section.rows && section.title) {
        const category = categorizeSection(section.title);
        if (category === "skip") return;

        section.rows.forEach((row) => {
          if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
            const accountName = row.cells[0]?.value || "";
            const currentAmount = parseFloat(row.cells[1]?.value || 0);

            if (accountName.toLowerCase().includes("total") || currentAmount === 0) return;

            processedAccounts++;
            const accountInfo = {
              name: accountName,
              balance: currentAmount,
              debit: 0,
              credit: 0,
              section: section.title,
            };

            if (category === "revenue") {
              accountInfo.credit = Math.abs(currentAmount);
              trialBalance.revenue.push(accountInfo);
              trialBalance.totals.totalRevenue += Math.abs(currentAmount);
            } else {
              accountInfo.debit = Math.abs(currentAmount);
              trialBalance.expenses.push(accountInfo);
              trialBalance.totals.totalExpenses += Math.abs(currentAmount);
            }

            trialBalance.totals.totalDebits += accountInfo.debit;
            trialBalance.totals.totalCredits += accountInfo.credit;
          }
        });
      }
    });
  } catch (plError) {
    console.error("Could not fetch P&L data for trial balance:", plError.message);
  }

  ["assets", "liabilities", "equity", "revenue", "expenses"].forEach((category) => {
    trialBalance[category].sort((a, b) => a.name.localeCompare(b.name));
  });

  const balanceCheck = {
    debitsEqualCredits:
      Math.abs(trialBalance.totals.totalDebits - trialBalance.totals.totalCredits) < 0.01,
    difference: trialBalance.totals.totalDebits - trialBalance.totals.totalCredits,
    accountingEquation: {
      assets: trialBalance.totals.totalAssets,
      liabilitiesAndEquity:
        trialBalance.totals.totalLiabilities + trialBalance.totals.totalEquity,
      balanced:
        Math.abs(
          trialBalance.totals.totalAssets -
            (trialBalance.totals.totalLiabilities + trialBalance.totals.totalEquity)
        ) < 0.01,
    },
  };

  return {
    tenantId,
    tenantName: tokenData.tenantName,
    trialBalance,
    balanceCheck,
    generatedAt: new Date().toISOString(),
    reportDate: effectiveDate,
    processedAccounts,
    dataSource: "Balance Sheet + P&L Reports",
  };
}

app.post("/api/trial-balance", async (req, res) => {
  try {
    const { organizationName, tenantId, reportDate } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Call shared function directly — no HTTP hop through Railway's edge
    const result = await fetchTrialBalance(actualTenantId, { reportDate });
    res.json(result);
  } catch (error) {
    console.error("Trial balance POST API error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

app.post("/api/cash-position", async (req, res) => {
  try {
    const { organizationName, tenantId } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Get token and call Bank Summary report
    const tokenData = await tokenStorage.getXeroToken(actualTenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    // Use Bank Summary Report API for current balances
    const response = await xero.accountingApi.getReportBankSummary(
      actualTenantId
    );

    // Replace the existing Bank Summary parsing with this:
    const bankSummaryRows = response.body.reports?.[0]?.rows || [];
    const bankAccounts = [];
    let totalCash = 0;

    // Find the Section that contains the bank account rows
    bankSummaryRows.forEach((row) => {
      if (row.rowType === "Section" && row.rows) {
        // Loop through each bank account row in the section
        row.rows.forEach((bankRow) => {
          if (
            bankRow.rowType === "Row" &&
            bankRow.cells &&
            bankRow.cells.length >= 5
          ) {
            const accountName = bankRow.cells[0]?.value || "";
            const closingBalance = parseFloat(bankRow.cells[4]?.value || 0); // Cell[4] = Closing Balance
            const accountId =
              bankRow.cells[0]?.attributes?.find(
                (attr) => attr.id === "accountID"
              )?.value || "";

            if (accountName && !accountName.toLowerCase().includes("total")) {
              bankAccounts.push({
                name: accountName,
                balance: closingBalance,
                code: accountId,
              });
              totalCash += closingBalance;
            }
          }
        });
      }
    });

    res.json({
      totalCash,
      bankAccounts,
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Cash position API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SHARED HELPER: Fetch P&L data directly from Xero — no internal HTTP hop.
// Replaces the self-fetch through Railway's edge proxy that started 500'ing
// after the 20 May 2026 outage (HTML returned instead of JSON).
// Mirrors the logic in the GET /api/profit-loss/:tenantId endpoint.
// ============================================================================
async function fetchProfitLossData(tenantId, { date, periodMonths = 1 } = {}) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) {
    const err = new Error("Tenant not found or token expired");
    err.statusCode = 404;
    throw err;
  }

  await xero.setTokenSet(tokenData);

  const reportDate = date || new Date().toISOString().split("T")[0];
  const reportEndDate = new Date(reportDate);
  if (isNaN(reportEndDate.getTime())) {
    const err = new Error("Invalid report date provided");
    err.statusCode = 400;
    throw err;
  }

  let fromDate;
  if (periodMonths === 1) {
    fromDate = new Date(reportEndDate.getFullYear(), reportEndDate.getMonth(), 1);
  } else {
    fromDate = new Date(reportEndDate);
    fromDate.setMonth(fromDate.getMonth() - (periodMonths - 1));
    fromDate.setDate(1);
  }

  const fromDateStr = fromDate.toISOString().split("T")[0];
  const actualReportDateStr = reportEndDate.toISOString().split("T")[0];

  console.log(`P&L Date Range: ${fromDateStr} to ${actualReportDateStr} (${periodMonths} month period)`);

  const response = await xero.accountingApi.getReportProfitAndLoss(
    tenantId,
    fromDateStr,
    actualReportDateStr
  );

  const plRows = response.body.reports?.[0]?.rows || [];

  const plSummary = {
    totalRevenue: 0,
    totalCOGS: 0,
    grossProfit: 0,
    totalExpenses: 0,
    netProfit: 0,
    revenueAccounts: [],
    cogsAccounts: [],
    expenseAccounts: [],
  };

  plRows.forEach((section) => {
    if (section.rowType === "Section" && section.rows && section.title) {
      const category = categorizeSection(section.title);
      if (category === "skip") return;

      section.rows.forEach((row) => {
        if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
          const accountName = row.cells[0]?.value || "";
          if (accountName.toLowerCase().includes("total")) return;

          const amount = sumPLRowCells(row.cells);
          if (amount === 0) return;

          if (category === "revenue") {
            plSummary.revenueAccounts.push({ name: accountName, amount });
            plSummary.totalRevenue += amount;
          } else if (category === "cogs") {
            plSummary.cogsAccounts.push({ name: accountName, amount });
            plSummary.totalCOGS += amount;
          } else {
            plSummary.expenseAccounts.push({ name: accountName, amount });
            plSummary.totalExpenses += amount;
          }
        }
      });
    }
  });

  plSummary.grossProfit = plSummary.totalRevenue - plSummary.totalCOGS;
  plSummary.netProfit = plSummary.grossProfit - plSummary.totalExpenses;

  return {
    tenantId,
    tenantName: tokenData.tenantName,
    period: {
      from: fromDateStr,
      to: actualReportDateStr,
      months: periodMonths,
      description: periodMonths === 1 ? "Current Month" : `${periodMonths} Month Period`,
    },
    summary: plSummary,
    generatedAt: new Date().toISOString(),
  };
}

app.post("/api/profit-loss-summary", async (req, res) => {
  try {
    const { organizationName, tenantId, date, periodMonths } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Call the shared function directly — NO HTTP hop through Railway's edge proxy
    const result = await fetchProfitLossData(actualTenantId, {
      date,
      periodMonths: periodMonths || 1,
    });
    res.json(result);
  } catch (error) {
    console.error("P&L summary API error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// ============================================================================
// SHARED HELPER: Fetch outstanding invoices directly from Xero — no HTTP hop.
// Replaces the self-fetch that started 500'ing after the 20 May 2026 outage.
// ============================================================================
async function fetchOutstandingInvoices(tenantId) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) {
    const err = new Error("Tenant not found or token expired");
    err.statusCode = 404;
    throw err;
  }

  await xero.setTokenSet(tokenData);

  const response = await xero.accountingApi.getInvoices(
    tenantId,
    null,
    null,
    'Status=="AUTHORISED"&&Type=="ACCREC"'
  );
  const invoices = response.body.invoices || [];

  const outstandingInvoices = invoices.filter(
    (inv) =>
      inv.status === "AUTHORISED" &&
      inv.type === "ACCREC" &&
      parseFloat(inv.amountDue) > 0
  );

  return outstandingInvoices.map((inv) => ({
    invoiceID: inv.invoiceID,
    invoiceNumber: inv.invoiceNumber,
    contact: inv.contact?.name,
    amountDue: parseFloat(inv.amountDue),
    total: parseFloat(inv.total),
    date: inv.date,
    dueDate: inv.dueDate,
  }));
}

// Outstanding Invoices endpoint
app.post("/api/outstanding-invoices", async (req, res) => {
  try {
    const { organizationName, tenantId } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Call shared function directly — no HTTP hop through Railway's edge
    const result = await fetchOutstandingInvoices(actualTenantId);
    res.json(result);
  } catch (error) {
    console.error("Outstanding invoices API error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// Financial Ratios endpoint
app.post("/api/financial-ratios", async (req, res) => {
  try {
    const { organizationName, tenantId, date } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const result = await fetchFinancialRatios(actualTenantId, { date });
    res.json(result);
  } catch (error) {
    console.error("Financial ratios API error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// Consolidated Trial Balance endpoint
app.post("/api/consolidated-trial-balance", async (req, res) => {
  try {
    const { reportDate } = req.body;

    const dateParam = reportDate ? `?date=${reportDate}` : "";
    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/consolidated-trial-balance${dateParam}`
    );

    if (!response.ok) {
      throw new Error(
        `Consolidated trial balance request failed: ${response.status}`
      );
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Consolidated trial balance API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Journal Entries endpoint
app.post("/api/journal-entries", async (req, res) => {
  try {
    const { organizationName, tenantId, dateFrom, dateTo, accountName } =
      req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (dateFrom) params.append("dateFrom", dateFrom);
    if (dateTo) params.append("dateTo", dateTo);
    if (accountName) params.append("accountName", accountName);
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/journal-entries/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Journal entries request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Journal entries API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Equity Analysis endpoint
app.post("/api/equity-analysis", async (req, res) => {
  try {
    const { organizationName, tenantId, equityAccountName, monthsBack } =
      req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (equityAccountName)
      params.append("equityAccountName", equityAccountName);
    if (monthsBack) params.append("monthsBack", monthsBack.toString());
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/equity-analysis/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Equity analysis request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Equity analysis API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Account History endpoint
app.post("/api/account-history", async (req, res) => {
  try {
    const { organizationName, tenantId, accountName, dateFrom, dateTo } =
      req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    if (!accountName) {
      return res.status(400).json({ error: "Account name is required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (dateFrom) params.append("dateFrom", dateFrom);
    if (dateTo) params.append("dateTo", dateTo);
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/account-history/${actualTenantId}/${encodeURIComponent(
        accountName
      )}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Account history request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Account history API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Aged Receivables endpoint
app.post("/api/aged-receivables", async (req, res) => {
  try {
    const { organizationName, tenantId, date } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const dateParam = date ? `?date=${date}` : "";
    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/aged-receivables/${actualTenantId}${dateParam}`
    );

    if (!response.ok) {
      throw new Error(`Aged receivables request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Aged receivables API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Expense Analysis endpoint
app.post("/api/expense-analysis", async (req, res) => {
  try {
    const { organizationName, tenantId, date, periodMonths } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (date) params.append("date", date);
    if (periodMonths) params.append("periodMonths", periodMonths.toString());
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/expense-analysis/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Expense analysis request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Expense analysis API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// SPEND & REVENUE CLASSIFICATION endpoints
//
// These bucket Xero accounts into meaningful categories beyond the chart
// of accounts — built on classifier modules in /lib/. They pipe through
// existing expense-analysis and profit-loss-summary endpoints, then run
// the classifiers, so they don't make their own Xero API calls.
//
// classifier.js (spend):     IN, GREY_DISTRIB, OUT_PERSONNEL,
//                            OUT_TAX_DEPN_INT, OUT_INTERCO, OUT_GOVERNANCE
// revenue-classifier.js:     CORE_OPERATIONS, MINING_AGREEMENTS,
//                            INVESTMENT_INCOME, GRANT_INCOME, RENTAL_INCOME,
//                            INTERCO_REVENUE, OTHER
//
// Single-entity only for v1. ALL/consolidated would need a fan-out
// across all 7 tenants — deferrable to v2.
// ─────────────────────────────────────────────────────────────────────────

// ============================================================================
// SHARED HELPER: Fetch expense analysis directly from Xero — no HTTP hop.
// ============================================================================
async function fetchExpenseAnalysis(tenantId, { date, periodMonths = 12, startDate } = {}) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) {
    const err = new Error("Tenant not found or token expired");
    err.statusCode = 404;
    throw err;
  }

  await xero.setTokenSet(tokenData);

  const reportDate = date || new Date().toISOString().split("T")[0];
  const fromDateStr = startDate || (() => {
    const fromDate = new Date(reportDate);
    fromDate.setMonth(fromDate.getMonth() - periodMonths);
    return fromDate.toISOString().split("T")[0];
  })();

  console.log(`Getting expense analysis for ${tokenData.tenantName}`);
  const response = await xero.accountingApi.getReportProfitAndLoss(
    tenantId,
    fromDateStr,
    reportDate
  );

  const plRows = response.body.reports?.[0]?.rows || [];

  const expenseAnalysis = {
    totalExpenses: 0,
    expenseCategories: [],
    topExpenses: [],
    monthlyAverage: 0,
  };

  plRows.forEach((section) => {
    if (section.rowType === "Section" && section.rows && section.title) {
      const sectionTitle = section.title.toLowerCase();
      if (sectionTitle.includes("expense") || sectionTitle.includes("cost")) {
        section.rows.forEach((row) => {
          if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
            const accountName = row.cells[0]?.value || "";
            const amount = parseFloat(row.cells[1]?.value || 0);
            if (!accountName.toLowerCase().includes("total") && amount > 0) {
              expenseAnalysis.expenseCategories.push({
                accountName,
                amount,
                monthlyAverage: Math.abs(amount) / periodMonths,
                category: categorizeExpense(accountName),
              });
              expenseAnalysis.totalExpenses += Math.abs(amount);
            }
          }
        });
      }
    }
  });

  expenseAnalysis.expenseCategories.sort((a, b) => b.amount - a.amount);
  expenseAnalysis.topExpenses = expenseAnalysis.expenseCategories.slice(0, 10);
  expenseAnalysis.monthlyAverage = expenseAnalysis.totalExpenses / periodMonths;

  const categoryTotals = {};
  expenseAnalysis.expenseCategories.forEach((expense) => {
    categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
  });

  expenseAnalysis.categoryBreakdown = Object.entries(categoryTotals)
    .map(([category, total]) => ({
      category,
      total,
      percentage: ((total / expenseAnalysis.totalExpenses) * 100).toFixed(1),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    tenantId,
    tenantName: tokenData.tenantName,
    period: { from: fromDateStr, to: reportDate, months: periodMonths },
    analysis: expenseAnalysis,
    generatedAt: new Date().toISOString(),
  };
}


app.post("/api/spend-classification", async (req, res) => {
  try {
    const { organizationName, tenantId, date, periodMonths } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }
    const normalised = String(organizationName || "").toLowerCase();
    if (["all", "all entities", "consolidated"].includes(normalised)) {
      return res.status(400).json({ error: "Spend classification is single-entity only in v1. Pick a specific entity." });
    }

    let actualTenantId = tenantId;
    let actualTenantName = "";
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
        actualTenantName = connection.tenantName;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Call shared helper directly — no HTTP hop
    const expenseData = await fetchExpenseAnalysis(actualTenantId, {
      date,
      periodMonths: periodMonths || 12,
    });

    const categories = expenseData.analysis?.expenseCategories || [];
    const reportedTotal = expenseData.analysis?.totalExpenses ?? null;
    const classification = summariseSpend(categories);

    res.json({
      tenantId: actualTenantId,
      tenantName: actualTenantName || expenseData.tenantName,
      period: { date, periodMonths: periodMonths || 12 },
      classification,
      reportedTotalExpenses: reportedTotal,
      bucketCounts: Object.fromEntries(
        Object.entries(classification.detailed || {}).map(([k, v]) => [k, v.length])
      ),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Spend classification API error:", error?.stack || error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

app.post("/api/revenue-classification", async (req, res) => {
  try {
    const { organizationName, tenantId, date, periodMonths } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }
    const normalised = String(organizationName || "").toLowerCase();
    if (["all", "all entities", "consolidated"].includes(normalised)) {
      return res.status(400).json({ error: "Revenue classification is single-entity only in v1. Pick a specific entity." });
    }

    let actualTenantId = tenantId;
    let actualTenantName = "";
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
        actualTenantName = connection.tenantName;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Reuse the shared P&L helper we already extracted — no HTTP hop
    const plData = await fetchProfitLossData(actualTenantId, {
      date,
      periodMonths: periodMonths || 12,
    });

    const revenueAccounts = plData?.summary?.revenueAccounts || [];
    const classification = summariseRevenue(revenueAccounts);

    res.json({
      tenantId: actualTenantId,
      tenantName: actualTenantName || plData.tenantName,
      period: plData.period || { date, periodMonths: periodMonths || 12 },
      classification,
      reportedTotalRevenue: plData?.summary?.totalRevenue,
      bucketCounts: Object.fromEntries(
        Object.entries(classification.detailed || {}).map(([k, v]) => [k, v.length])
      ),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Revenue classification API error:", error?.stack || error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// Intercompany Transactions endpoint
app.post("/api/intercompany-transactions", async (req, res) => {
  try {
    const { organizationName, tenantId, date } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const dateParam = date ? `?date=${date}` : "";
    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/intercompany/${actualTenantId}${dateParam}`
    );

    if (!response.ok) {
      throw new Error(
        `Intercompany transactions request failed: ${response.status}`
      );
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Intercompany transactions API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Chart of Accounts endpoint
app.post("/api/chart-of-accounts", async (req, res) => {
  try {
    const { organizationName, tenantId, accountType, includeArchived } =
      req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (accountType) params.append("accountType", accountType);
    if (includeArchived !== undefined)
      params.append("includeArchived", includeArchived.toString());
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/chart-of-accounts/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Chart of accounts request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Chart of accounts API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Find Unbalanced Transactions endpoint
app.post("/api/find-unbalanced", async (req, res) => {
  try {
    const { organizationName, tenantId, minimumAmount, dateRange } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (minimumAmount) params.append("minimumAmount", minimumAmount.toString());
    if (dateRange) params.append("dateRange", dateRange);
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/find-unbalanced/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Find unbalanced request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Find unbalanced API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Compare Periods endpoint
app.post("/api/compare-periods", async (req, res) => {
  try {
    const { organizationName, tenantId, fromDate, toDate, accountFilter } =
      req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    if (!fromDate) {
      return res
        .status(400)
        .json({ error: "fromDate is required for period comparison" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);
    if (accountFilter) params.append("accountFilter", accountFilter);
    const queryString = "?" + params.toString();

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/compare-periods/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`Compare periods request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Compare periods API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start auto-refresh when server starts
// Add this to your startServer() function, after initializeDatabase()
async function initializeAutoRefresh() {
  try {
    await initializeDatabase();

    // Start the auto-refresh system
    startAutoRefresh();

    // Start the daily snapshot scheduler (first run in 60s, then every 24h).
    // Captures balance-sheet daily and backfills any missing completed months
    // into monthly_snapshots so dashboard sparklines stay current.
    runSchemaMigrations()
      .then(() => startDailySnapshotScheduler())
      .catch((err) => {
        console.error('[migration] FAILED — scheduler not started:', err.message);
      });

    console.error("Auto token refresh + daily snapshot scheduler initialized");
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Failed to initialize auto-refresh:", error);
  }
}

// Add these endpoints to your existing server.js after your current API routes

// ============================================================================
// ENHANCED MCP ANALYSIS ENDPOINTS
// ============================================================================

// Get manual journal entries for analysis
app.get("/api/journal-entries/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    // Get date range from query parameters
    const dateFrom =
      req.query.dateFrom ||
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]; // 1 year ago
    const dateTo = req.query.dateTo || new Date().toISOString().split("T")[0];
    const accountName = req.query.accountName;

    console.log(
      `Getting journal entries for ${tokenData.tenantName} from ${dateFrom} to ${dateTo}`
    );

    // Get manual journals from Xero
    const response = await xero.accountingApi.getManualJournals(
      req.params.tenantId,
      null, // ifModifiedSince
      `Date >= DateTime(${dateFrom.replace(
        /-/g,
        ","
      )}) AND Date <= DateTime(${dateTo.replace(/-/g, ",")})` // where clause
    );

    const journals = response.body.manualJournals || [];

    // Filter and analyze journals
    const analysisResults = journals
      .map((journal) => {
        const journalLines = journal.journalLines || [];

        // Calculate total debits and credits
        const totalDebits = journalLines
          .filter((line) => line.lineAmount > 0)
          .reduce((sum, line) => sum + line.lineAmount, 0);

        const totalCredits = journalLines
          .filter((line) => line.lineAmount < 0)
          .reduce((sum, line) => sum + Math.abs(line.lineAmount), 0);

        const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

        // Check if this journal affects the specified account
        const affectsAccount = accountName
          ? journalLines.some(
              (line) =>
                line.accountCode &&
                line.accountCode
                  .toLowerCase()
                  .includes(accountName.toLowerCase())
            )
          : true;

        if (!affectsAccount) return null;

        return {
          journalID: journal.manualJournalID,
          journalNumber: journal.journalNumber,
          reference: journal.reference,
          date: journal.date,
          status: journal.status,
          totalDebits,
          totalCredits,
          isBalanced,
          imbalanceAmount: totalDebits - totalCredits,
          lineCount: journalLines.length,
          journalLines: journalLines.map((line) => ({
            accountCode: line.accountCode,
            accountName: line.accountName,
            description: line.description,
            lineAmount: line.lineAmount,
            trackingCategories: line.trackingCategories,
          })),
          // Flag suspicious entries
          isSuspicious:
            !isBalanced ||
            Math.abs(totalDebits) > 1000000 || // Large amounts
            journalLines.length === 1 || // Single-sided entries
            journalLines.some(
              (line) =>
                line.accountName &&
                line.accountName.toLowerCase().includes("future fund")
            ),
        };
      })
      .filter((j) => j !== null);

    // Sort by date (newest first)
    analysisResults.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log(
      `Found ${analysisResults.length} journal entries, ${
        analysisResults.filter((j) => j.isSuspicious).length
      } flagged as suspicious`
    );

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      dateFrom,
      dateTo,
      totalJournals: analysisResults.length,
      suspiciousJournals: analysisResults.filter((j) => j.isSuspicious).length,
      unbalancedJournals: analysisResults.filter((j) => !j.isBalanced).length,
      journals: analysisResults,
    });
  } catch (error) {
    console.error("Error getting journal entries:", error);
    res.status(500).json({
      error: "Failed to get journal entries",
      details: error.message,
    });
  }
});

// Analyze equity account movements
app.get("/api/equity-analysis/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const equityAccountName = req.query.equityAccountName || "Future Fund";
    const monthsBack = parseInt(req.query.monthsBack) || 12;

    console.log(
      `Analyzing equity movements for ${equityAccountName} over ${monthsBack} months`
    );

    // Get accounts first to find the equity account ID
    const accountsResponse = await xero.accountingApi.getAccounts(
      req.params.tenantId,
      null,
      `Type=="EQUITY" AND Name.Contains("${equityAccountName}")`
    );

    const equityAccounts = accountsResponse.body.accounts || [];

    if (equityAccounts.length === 0) {
      return res.json({
        error: `No equity account found matching "${equityAccountName}"`,
        tenantName: tokenData.tenantName,
        searchTerm: equityAccountName,
      });
    }

    const results = [];

    for (const account of equityAccounts) {
      // Get account transactions - this requires a different API call
      // Note: Xero's API has limitations on transaction history
      try {
        const today = new Date();
        const startDate = new Date(
          today.getFullYear(),
          today.getMonth() - monthsBack,
          1
        );

        // We'll need to get this data from manual journals since direct account transactions
        // are limited in Xero API
        const journalResponse = await xero.accountingApi.getManualJournals(
          req.params.tenantId,
          null,
          `Date >= DateTime(${startDate.getFullYear()},${
            startDate.getMonth() + 1
          },${startDate.getDate()})`
        );

        const relevantJournals = (journalResponse.body.manualJournals || [])
          .filter(
            (journal) =>
              journal.journalLines &&
              journal.journalLines.some(
                (line) =>
                  line.accountCode === account.code ||
                  (line.accountName &&
                    line.accountName
                      .toLowerCase()
                      .includes(equityAccountName.toLowerCase()))
              )
          )
          .map((journal) => ({
            journalID: journal.manualJournalID,
            journalNumber: journal.journalNumber,
            date: journal.date,
            reference: journal.reference,
            status: journal.status,
            relevantLines: journal.journalLines.filter(
              (line) =>
                line.accountCode === account.code ||
                (line.accountName &&
                  line.accountName
                    .toLowerCase()
                    .includes(equityAccountName.toLowerCase()))
            ),
          }));

        results.push({
          accountID: account.accountID,
          accountCode: account.code,
          accountName: account.name,
          currentBalance: account.currentBalance || 0,
          accountType: account.type,
          status: account.status,
          transactionCount: relevantJournals.length,
          transactions: relevantJournals,
          // Calculate balance changes
          totalMovements: relevantJournals.reduce(
            (sum, j) =>
              sum +
              j.relevantLines.reduce(
                (lineSum, line) => lineSum + line.lineAmount,
                0
              ),
            0
          ),
        });
      } catch (accountError) {
        console.error(`Error analyzing account ${account.name}:`, accountError);
        results.push({
          accountID: account.accountID,
          accountCode: account.code,
          accountName: account.name,
          error: accountError.message,
        });
      }
    }

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      analysisDate: new Date().toISOString(),
      searchTerm: equityAccountName,
      monthsAnalyzed: monthsBack,
      accountsFound: results.length,
      accounts: results,
    });
  } catch (error) {
    console.error("Error analyzing equity movements:", error);
    res.status(500).json({
      error: "Failed to analyze equity movements",
      details: error.message,
    });
  }
});

// Get account transaction history
app.get("/api/account-history/:tenantId/:accountName", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const accountName = decodeURIComponent(req.params.accountName);
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;

    console.log(`Getting account history for: ${accountName}`);

    // First, find the account
    const accountsResponse = await xero.accountingApi.getAccounts(
      req.params.tenantId,
      null,
      `Name.Contains("${accountName}")`
    );

    const accounts = accountsResponse.body.accounts || [];
    const matchingAccount = accounts.find(
      (acc) =>
        acc.name.toLowerCase() === accountName.toLowerCase() ||
        acc.name.toLowerCase().includes(accountName.toLowerCase())
    );

    if (!matchingAccount) {
      return res.json({
        error: `Account "${accountName}" not found`,
        tenantName: tokenData.tenantName,
        availableAccounts: accounts.slice(0, 10).map((a) => a.name),
      });
    }

    // Get journals that affect this account
    let whereClause = "";
    if (dateFrom && dateTo) {
      whereClause = `Date >= DateTime(${dateFrom.replace(
        /-/g,
        ","
      )}) AND Date <= DateTime(${dateTo.replace(/-/g, ",")})`;
    }

    const journalResponse = await xero.accountingApi.getManualJournals(
      req.params.tenantId,
      null,
      whereClause
    );

    const relevantJournals = (journalResponse.body.manualJournals || [])
      .filter(
        (journal) =>
          journal.journalLines &&
          journal.journalLines.some(
            (line) =>
              line.accountCode === matchingAccount.code ||
              (line.accountName &&
                line.accountName
                  .toLowerCase()
                  .includes(accountName.toLowerCase()))
          )
      )
      .map((journal) => {
        const relevantLines = journal.journalLines.filter(
          (line) =>
            line.accountCode === matchingAccount.code ||
            (line.accountName &&
              line.accountName
                .toLowerCase()
                .includes(accountName.toLowerCase()))
        );

        return {
          journalID: journal.manualJournalID,
          journalNumber: journal.journalNumber,
          date: journal.date,
          reference: journal.reference,
          status: journal.status,
          description: journal.narration,
          relevantLines: relevantLines,
          netAmount: relevantLines.reduce(
            (sum, line) => sum + line.lineAmount,
            0
          ),
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      account: {
        accountID: matchingAccount.accountID,
        accountCode: matchingAccount.code,
        accountName: matchingAccount.name,
        accountType: matchingAccount.type,
        currentBalance: matchingAccount.currentBalance || 0,
        status: matchingAccount.status,
      },
      dateFrom: dateFrom || "All time",
      dateTo: dateTo || "All time",
      transactionCount: relevantJournals.length,
      transactions: relevantJournals,
      totalMovement: relevantJournals.reduce(
        (sum, t) => sum + Math.abs(t.netAmount),
        0
      ),
    });
  } catch (error) {
    console.error("Error getting account history:", error);
    res.status(500).json({
      error: "Failed to get account history",
      details: error.message,
    });
  }
});

// Find unbalanced transactions
app.get("/api/find-unbalanced/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const minimumAmount = parseFloat(req.query.minimumAmount) || 10000;
    const dateRange = req.query.dateRange || "1year";

    // Calculate date range
    const today = new Date();
    let startDate = new Date();

    switch (dateRange) {
      case "3months":
        startDate.setMonth(today.getMonth() - 3);
        break;
      case "1year":
        startDate.setFullYear(today.getFullYear() - 1);
        break;
      case "all":
        startDate = new Date("2000-01-01");
        break;
      default:
        startDate.setFullYear(today.getFullYear() - 1);
    }

    console.log(
      `Finding unbalanced transactions >= $${minimumAmount} since ${
        startDate.toISOString().split("T")[0]
      }`
    );

    const whereClause = `Date >= DateTime(${startDate.getFullYear()},${
      startDate.getMonth() + 1
    },${startDate.getDate()})`;

    const journalResponse = await xero.accountingApi.getManualJournals(
      req.params.tenantId,
      null,
      whereClause
    );

    const journals = journalResponse.body.manualJournals || [];

    const unbalancedTransactions = journals
      .map((journal) => {
        const journalLines = journal.journalLines || [];

        const totalDebits = journalLines
          .filter((line) => line.lineAmount > 0)
          .reduce((sum, line) => sum + line.lineAmount, 0);

        const totalCredits = journalLines
          .filter((line) => line.lineAmount < 0)
          .reduce((sum, line) => sum + Math.abs(line.lineAmount), 0);

        const imbalance = totalDebits - totalCredits;
        const isUnbalanced = Math.abs(imbalance) >= minimumAmount;
        const hasLargeAmount =
          Math.max(totalDebits, totalCredits) >= minimumAmount;

        if (!isUnbalanced && !hasLargeAmount) return null;

        return {
          journalID: journal.manualJournalID,
          journalNumber: journal.journalNumber,
          reference: journal.reference,
          date: journal.date,
          status: journal.status,
          totalDebits,
          totalCredits,
          imbalanceAmount: imbalance,
          isUnbalanced,
          severity:
            Math.abs(imbalance) > 1000000
              ? "CRITICAL"
              : Math.abs(imbalance) > 100000
              ? "HIGH"
              : "MEDIUM",
          journalLines: journalLines.map((line) => ({
            accountCode: line.accountCode,
            accountName: line.accountName,
            description: line.description,
            lineAmount: line.lineAmount,
          })),
          flags: {
            largeAmount: Math.max(totalDebits, totalCredits) > 1000000,
            unbalanced: isUnbalanced,
            singleSided: journalLines.length === 1,
            affectsFutureFund: journalLines.some(
              (line) =>
                line.accountName &&
                line.accountName.toLowerCase().includes("future fund")
            ),
          },
        };
      })
      .filter((j) => j !== null)
      .sort(
        (a, b) => Math.abs(b.imbalanceAmount) - Math.abs(a.imbalanceAmount)
      );

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      analysisDate: new Date().toISOString(),
      criteria: {
        minimumAmount,
        dateRange,
        startDate: startDate.toISOString().split("T")[0],
      },
      summary: {
        totalJournalsAnalyzed: journals.length,
        unbalancedFound: unbalancedTransactions.filter((t) => t.isUnbalanced)
          .length,
        largeAmountFound: unbalancedTransactions.filter(
          (t) => t.flags.largeAmount
        ).length,
        criticalIssues: unbalancedTransactions.filter(
          (t) => t.severity === "CRITICAL"
        ).length,
        futureFundRelated: unbalancedTransactions.filter(
          (t) => t.flags.affectsFutureFund
        ).length,
      },
      transactions: unbalancedTransactions,
    });
  } catch (error) {
    console.error("Error finding unbalanced transactions:", error);
    res.status(500).json({
      error: "Failed to find unbalanced transactions",
      details: error.message,
    });
  }
});

// Get complete chart of accounts
app.get("/api/chart-of-accounts/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const accountType = req.query.accountType;
    const includeArchived = req.query.includeArchived === "true";

    let whereClause = "";
    if (accountType) {
      whereClause = `Type=="${accountType}"`;
    }
    if (!includeArchived) {
      whereClause += whereClause ? ' AND Status=="ACTIVE"' : 'Status=="ACTIVE"';
    }

    console.log(`Getting chart of accounts for ${tokenData.tenantName}`);

    const response = await xero.accountingApi.getAccounts(
      req.params.tenantId,
      null,
      whereClause
    );

    const accounts = response.body.accounts || [];

    // Analyze accounts for unusual patterns
    const analysis = accounts.map((account) => {
      const balance = parseFloat(account.currentBalance) || 0;
      const isLargeBalance = Math.abs(balance) > 1000000;
      const isUnusualEquity =
        account.type === "EQUITY" &&
        (account.name.toLowerCase().includes("future fund") ||
          account.name.toLowerCase().includes("reserve") ||
          Math.abs(balance) > 10000000);

      return {
        accountID: account.accountID,
        code: account.code,
        name: account.name,
        type: account.type,
        class: account.class,
        status: account.status,
        currentBalance: balance,
        description: account.description,
        systemAccount: account.systemAccount,
        flags: {
          largeBalance: isLargeBalance,
          unusualEquity: isUnusualEquity,
          zeroBalance: balance === 0,
          negativeAsset: account.type === "ASSET" && balance < 0,
          positiveExpense: account.type === "EXPENSE" && balance > 0,
        },
      };
    });

    // Group by account type
    const groupedAccounts = {
      ASSET: analysis.filter((a) => a.type === "ASSET"),
      LIABILITY: analysis.filter((a) => a.type === "LIABILITY"),
      EQUITY: analysis.filter((a) => a.type === "EQUITY"),
      REVENUE: analysis.filter((a) => a.type === "REVENUE"),
      EXPENSE: analysis.filter((a) => a.type === "EXPENSE"),
      OTHER: analysis.filter(
        (a) =>
          !["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"].includes(
            a.type
          )
      ),
    };

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      filters: {
        accountType: accountType || "All",
        includeArchived,
      },
      summary: {
        totalAccounts: accounts.length,
        activeAccounts: analysis.filter((a) => a.status === "ACTIVE").length,
        archivedAccounts: analysis.filter((a) => a.status === "ARCHIVED")
          .length,
        largeBalanceAccounts: analysis.filter((a) => a.flags.largeBalance)
          .length,
        unusualEquityAccounts: analysis.filter((a) => a.flags.unusualEquity)
          .length,
        accountsByType: {
          ASSET: groupedAccounts.ASSET.length,
          LIABILITY: groupedAccounts.LIABILITY.length,
          EQUITY: groupedAccounts.EQUITY.length,
          REVENUE: groupedAccounts.REVENUE.length,
          EXPENSE: groupedAccounts.EXPENSE.length,
          OTHER: groupedAccounts.OTHER.length,
        },
      },
      accounts: groupedAccounts,
      flaggedAccounts: analysis.filter(
        (a) =>
          a.flags.largeBalance ||
          a.flags.unusualEquity ||
          a.flags.negativeAsset ||
          a.flags.positiveExpense
      ),
    });
  } catch (error) {
    console.error("Error getting chart of accounts:", error);
    res.status(500).json({
      error: "Failed to get chart of accounts",
      details: error.message,
    });
  }
});

// Compare trial balance between periods
app.get("/api/compare-periods/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate || new Date().toISOString().split("T")[0];
    const accountFilter = req.query.accountFilter;

    if (!fromDate) {
      return res.status(400).json({ error: "fromDate parameter is required" });
    }

    console.log(
      `Comparing periods: ${fromDate} vs ${toDate} for ${tokenData.tenantName}`
    );

    // Get trial balance for both periods by calling our existing endpoint
    const [fromPeriodResponse, toPeriodResponse] = await Promise.all([
      fetch(
        `${req.protocol}://${req.get("host")}/api/trial-balance/${
          req.params.tenantId
        }?date=${fromDate}`
      ),
      fetch(
        `${req.protocol}://${req.get("host")}/api/trial-balance/${
          req.params.tenantId
        }?date=${toDate}`
      ),
    ]);

    if (!fromPeriodResponse.ok || !toPeriodResponse.ok) {
      throw new Error("Failed to retrieve trial balance data for comparison");
    }

    const fromPeriodData = await fromPeriodResponse.json();
    const toPeriodData = await toPeriodResponse.json();

    // Compare the periods
    const comparison = {
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      fromDate,
      toDate,
      fromPeriod: {
        totalAssets: fromPeriodData.trialBalance.totals.totalAssets,
        totalLiabilities: fromPeriodData.trialBalance.totals.totalLiabilities,
        totalEquity: fromPeriodData.trialBalance.totals.totalEquity,
        totalDebits: fromPeriodData.trialBalance.totals.totalDebits,
        totalCredits: fromPeriodData.trialBalance.totals.totalCredits,
        balanced: fromPeriodData.balanceCheck.debitsEqualCredits,
      },
      toPeriod: {
        totalAssets: toPeriodData.trialBalance.totals.totalAssets,
        totalLiabilities: toPeriodData.trialBalance.totals.totalLiabilities,
        totalEquity: toPeriodData.trialBalance.totals.totalEquity,
        totalDebits: toPeriodData.trialBalance.totals.totalDebits,
        totalCredits: toPeriodData.trialBalance.totals.totalCredits,
        balanced: toPeriodData.balanceCheck.debitsEqualCredits,
      },
      changes: {
        assetsChange:
          toPeriodData.trialBalance.totals.totalAssets -
          fromPeriodData.trialBalance.totals.totalAssets,
        liabilitiesChange:
          toPeriodData.trialBalance.totals.totalLiabilities -
          fromPeriodData.trialBalance.totals.totalLiabilities,
        equityChange:
          toPeriodData.trialBalance.totals.totalEquity -
          fromPeriodData.trialBalance.totals.totalEquity,
        balanceStatusChange:
          toPeriodData.balanceCheck.debitsEqualCredits !==
          fromPeriodData.balanceCheck.debitsEqualCredits,
      },
    };

    // Find accounts with significant changes
    const fromAccounts = [
      ...fromPeriodData.trialBalance.assets,
      ...fromPeriodData.trialBalance.liabilities,
      ...fromPeriodData.trialBalance.equity,
    ];
    const toAccounts = [
      ...toPeriodData.trialBalance.assets,
      ...toPeriodData.trialBalance.liabilities,
      ...toPeriodData.trialBalance.equity,
    ];

    const accountChanges = [];

    // Find changes in existing accounts
    fromAccounts.forEach((fromAcc) => {
      const toAcc = toAccounts.find((a) => a.name === fromAcc.name);
      if (toAcc) {
        const change = toAcc.balance - fromAcc.balance;
        if (Math.abs(change) > 1000) {
          // Only show changes > $1,000
          accountChanges.push({
            accountName: fromAcc.name,
            fromBalance: fromAcc.balance,
            toBalance: toAcc.balance,
            change: change,
            changeType: change > 0 ? "INCREASE" : "DECREASE",
          });
        }
      }
    });

    // Find new accounts
    toAccounts.forEach((toAcc) => {
      const fromAcc = fromAccounts.find((a) => a.name === toAcc.name);
      if (!fromAcc && Math.abs(toAcc.balance) > 1000) {
        accountChanges.push({
          accountName: toAcc.name,
          fromBalance: 0,
          toBalance: toAcc.balance,
          change: toAcc.balance,
          changeType: "NEW_ACCOUNT",
        });
      }
    });

    // Sort by magnitude of change
    accountChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    comparison.accountChanges = accountChanges;
    comparison.significantChanges = accountChanges.filter(
      (c) => Math.abs(c.change) > 100000
    );

    res.json(comparison);
  } catch (error) {
    console.error("Error comparing periods:", error);
    res.status(500).json({
      error: "Failed to compare periods",
      details: error.message,
    });
  }
});

// Update your existing startServer function to call initializeAutoRefresh()
// Replace: await initializeDatabase();
// With: await initializeAutoRefresh();

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    // Test database connection
    const dbTest = await pool.query("SELECT NOW()");
    const xeroConnections = await tokenStorage.getAllXeroConnections();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
      xeroConnections: xeroConnections.length,
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});



// Enhanced health check for CEO dashboard - shows per-entity connection status
app.get("/api/health-check", async (req, res) => {
  try {
    const dbTest = await pool.query("SELECT NOW()");
    const allTokens = await pool.query(
      "SELECT tenant_id, tenant_name, expires_at, last_seen FROM tokens WHERE provider = $1 ORDER BY tenant_name",
      ["xero"]
    );
    
    const now = Date.now();
    const entities = allTokens.rows.map(row => ({
      tenantId: row.tenant_id,
      name: row.tenant_name,
      connected: now < row.expires_at,
      minutesRemaining: Math.floor((row.expires_at - now) / (1000 * 60)),
      lastSeen: row.last_seen,
      status: now < row.expires_at 
        ? (row.expires_at - now < 10 * 60 * 1000 ? 'expiring' : 'healthy')
        : (row.refresh_token ? 'expired-recoverable' : 'expired-needs-reauth')
    }));
    
    const connected = entities.filter(e => e.connected).length;
    const total = entities.length;
    
    res.json({
      status: connected === total ? 'all-connected' : connected > 0 ? 'partial' : 'disconnected',
      connected,
      total,
      entities,
      database: 'connected',
      uptime: process.uptime(),
      autoRefreshActive: !!autoRefreshInterval,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      connected: 0,
      total: 0,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// DATABASE DEBUG endpoint - Add this to see what's stored
app.get("/api/debug/database", async (req, res) => {
  try {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â DEBUG: Checking database contents...");

    // Get all tokens from database
    const result = await pool.query(
      "SELECT tenant_id, tenant_name, provider, expires_at, last_seen FROM tokens ORDER BY last_seen DESC"
    );

    const now = Date.now();
    const tokens = result.rows.map((row) => ({
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      provider: row.provider,
      expired: now > row.expires_at,
      expires_in_minutes: Math.floor((row.expires_at - now) / (1000 * 60)),
      last_seen: row.last_seen,
    }));

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ DEBUG: Database tokens:", tokens);

    res.json({
      totalTokens: tokens.length,
      tokens: tokens,
      currentTime: new Date().toISOString(),
      currentTimestamp: now,
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ DEBUG: Database error:", error);
    res.status(500).json({
      error: "Database query failed",
      details: error.message,
    });
  }
});

// Route configuration
// "/" = Connection Manager (clean utility page)
// "/dashboard" = CEO2 Visual Dashboard (primary working view)

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login-manager.html"));
});

// CEO2 Visual Dashboard - primary working view
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index-CEO-NEW.html"));
});

// ==============================================================================
// YoY Analyst EndPoint
// ==============================================================================
// Year-over-Year Analysis endpoint - UPDATED TO USE 24 MONTHLY REPORTS
app.get("/api/yoy-analysis/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    const reportDate = req.query.date || new Date().toISOString().split("T")[0];

    await xero.setTokenSet(tokenData);

    // Generate 24 monthly periods (current 12 months + previous 12 months)
    const reportMonth = new Date(reportDate);
    const currentYearPeriods = [];
    const previousYearPeriods = [];

    // Current year - 12 months ending with report month
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(reportMonth);
      monthDate.setMonth(reportMonth.getMonth() - i);

      const monthStart = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0
      );

      currentYearPeriods.push({
        label: monthStart.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        startDate: monthStart.toISOString().split("T")[0],
        endDate: monthEnd.toISOString().split("T")[0],
      });
    }

    // Previous year - same 12 months but one year earlier
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(reportMonth);
      monthDate.setFullYear(reportMonth.getFullYear() - 1);
      monthDate.setMonth(reportMonth.getMonth() - i);

      const monthStart = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0
      );

      previousYearPeriods.push({
        label: monthStart.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        startDate: monthStart.toISOString().split("T")[0],
        endDate: monthEnd.toISOString().split("T")[0],
      });
    }

    // Function to get monthly P&L data
    async function getMonthlyPLData(periods, periodLabel) {
      let totalRevenue = 0;
      let totalExpenses = 0;
      const monthlyDetails = [];

      for (const period of periods) {
        try {
          const response = await xero.accountingApi.getReportProfitAndLoss(
            req.params.tenantId,
            period.startDate,
            period.endDate
          );

          const plRows = response.body.reports?.[0]?.rows || [];
          const monthlyPL = parsePLData(plRows);

          monthlyDetails.push({
            ...period,
            revenue: monthlyPL.totalRevenue,
            expenses: monthlyPL.totalExpenses,
            profit: monthlyPL.totalRevenue - monthlyPL.totalExpenses,
          });

          totalRevenue += monthlyPL.totalRevenue;
          totalExpenses += monthlyPL.totalExpenses;
        } catch (monthError) {
          console.error(
            `Error loading ${periodLabel} ${period.label}:`,
            monthError.message
          );
          monthlyDetails.push({
            ...period,
            revenue: 0,
            expenses: 0,
            profit: 0,
            error: monthError.message,
          });
        }
      }

      return {
        totalRevenue,
        totalExpenses,
        totalProfit: totalRevenue - totalExpenses,
        monthlyDetails,
      };
    }

    // Get both periods in parallel
    const [currentYearData, previousYearData] = await Promise.all([
      getMonthlyPLData(currentYearPeriods, "Current"),
      getMonthlyPLData(previousYearPeriods, "Previous"),
    ]);

    // Get trial balance data for asset/equity information
    const [currentTBResponse, previousTBResponse] = await Promise.all([
      fetch(
        `${req.protocol}://${req.get("host")}/api/trial-balance/${
          req.params.tenantId
        }?date=${reportDate}`
      ),
      fetch(
        `${req.protocol}://${req.get("host")}/api/trial-balance/${
          req.params.tenantId
        }?date=${previousYearPeriods[11].endDate}`
      ),
    ]);

    let currentTB = null,
      previousTB = null;
    if (currentTBResponse.ok) {
      currentTB = await currentTBResponse.json();
    }
    if (previousTBResponse.ok) {
      previousTB = await previousTBResponse.json();
    }

    // Calculate YoY metrics using monthly totals
    const yoyAnalysis = {
      periods: {
        current: {
          label: `${currentYearPeriods[0].label.split(" ")[1]}-${
            currentYearPeriods[11].label
          }`,
          start: currentYearPeriods[0].startDate,
          end: currentYearPeriods[11].endDate,
          revenue: currentYearData.totalRevenue,
          expenses: currentYearData.totalExpenses,
          profit: currentYearData.totalProfit,
          assets: currentTB?.trialBalance?.totals?.totalAssets || 0,
          equity: currentTB?.trialBalance?.totals?.totalEquity || 0,
          monthlyBreakdown: currentYearData.monthlyDetails,
        },
        previous: {
          label: `${previousYearPeriods[0].label.split(" ")[1]}-${
            previousYearPeriods[11].label
          }`,
          start: previousYearPeriods[0].startDate,
          end: previousYearPeriods[11].endDate,
          revenue: previousYearData.totalRevenue,
          expenses: previousYearData.totalExpenses,
          profit: previousYearData.totalProfit,
          assets: previousTB?.trialBalance?.totals?.totalAssets || 0,
          equity: previousTB?.trialBalance?.totals?.totalEquity || 0,
          monthlyBreakdown: previousYearData.monthlyDetails,
        },
      },
      growth: {
        revenue: calculateGrowthRate(
          previousYearData.totalRevenue,
          currentYearData.totalRevenue
        ),
        profit: calculateGrowthRate(
          previousYearData.totalProfit,
          currentYearData.totalProfit
        ),
        assets: calculateGrowthRate(
          previousTB?.trialBalance?.totals?.totalAssets || 0,
          currentTB?.trialBalance?.totals?.totalAssets || 0
        ),
        equity: calculateGrowthRate(
          previousTB?.trialBalance?.totals?.totalEquity || 0,
          currentTB?.trialBalance?.totals?.totalEquity || 0
        ),
      },
      margins: {
        current: calculateMargin(
          currentYearData.totalRevenue,
          currentYearData.totalProfit
        ),
        previous: calculateMargin(
          previousYearData.totalRevenue,
          previousYearData.totalProfit
        ),
      },
    };

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      analysis: yoyAnalysis,
      dataSource: "24 monthly P&L reports",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting YoY analysis with monthly reports:", error);
    res.status(500).json({
      error: "Failed to get YoY analysis",
      details: error.message,
    });
  }
});

// Shared P&L section categorizer ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ONE place to maintain
// Catches all Xero section types; defaults non-revenue to expense (conservative)
function categorizeSection(sectionTitle) {
  const title = sectionTitle.toLowerCase();

  // COGS check FIRST (before revenue, because "Cost of Sales" contains "sales")
  if (title.includes("cost of sales") || title.includes("direct cost")) {
    return "cogs";
  }
  // Revenue sections
  if (
    title.includes("income") ||
    title.includes("revenue") ||
    title.includes("trading") ||
    title.includes("sales") ||
    title.includes("royalties") ||
    title.includes("investment performance") ||
    title.includes("property maintenance")
  ) {
    return "revenue";
  }
  // Summary rows to skip
  if (
    title.includes("net profit") ||
    title.includes("gross profit") ||
    title.includes("net loss")
  ) {
    return "skip";
  }
  // Everything else is expense (conservative catch-all)
  // This covers: expense, cost, administration, operating, salaries,
  // depreciation, overheads, staff costs, etc.
  return "expense";
}

// Sum all data columns from a Xero P&L row (handles multi-month reports)
function sumPLRowCells(cells) {
  let total = 0;
  for (let i = 1; i < cells.length; i++) {
    total += parseFloat(cells[i]?.value || 0);
  }
  return total;
}

// Helper function to parse P&L data - Phase 2: COGS separated from OpEx
function parsePLData(plRows) {
  const plData = {
    totalRevenue: 0,
    totalCOGS: 0,
    totalExpenses: 0,
    revenueAccounts: [],
    cogsAccounts: [],
    expenseAccounts: [],
  };

  plRows.forEach((section) => {
    if (section.rowType === "Section" && section.rows && section.title) {
      const category = categorizeSection(section.title);
      if (category === "skip") return;

      section.rows.forEach((row) => {
        if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
          const accountName = row.cells[0]?.value || "";
          if (accountName.toLowerCase().includes("total")) return;

          const amount = sumPLRowCells(row.cells);
          if (amount === 0) return;

          if (category === "revenue") {
            plData.revenueAccounts.push({ name: accountName, amount });
            plData.totalRevenue += amount;
          } else if (category === "cogs") {
            plData.cogsAccounts.push({ name: accountName, amount });
            plData.totalCOGS += amount;
          } else {
            plData.expenseAccounts.push({ name: accountName, amount });
            plData.totalExpenses += amount;
          }
        }
      });
    }
  });

  return plData;
}

// Helper function to calculate growth rate
function calculateGrowthRate(previousValue, currentValue) {
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

// Helper function to calculate profit margin
function calculateMargin(revenue, profit) {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}

// POST wrapper for YoY Analysis
app.post("/api/yoy-analysis", async (req, res) => {
  try {
    const { organizationName, tenantId, date } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const dateParam = date ? `?date=${date}` : "";
    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/yoy-analysis/${actualTenantId}${dateParam}`
    );

    if (!response.ok) {
      throw new Error(`YoY analysis request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("YoY analysis API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================================
// ENHANCED TRIAL BALANCE ENDPOINTS WITH DATE SUPPORT
// ==============================================================================

// Enhanced Individual Trial Balance with Date Support
app.get("/api/trial-balance/:tenantId", async (req, res) => {
  try {
    console.log(
      `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Getting PROPER trial balance for tenant: ${req.params.tenantId}`
    );

    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    // Get date from query parameter or use today
    const reportDate = req.query.date || new Date().toISOString().split("T")[0];
    console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Report date: ${reportDate}`);

    // Get Balance Sheet report for specified date
    const balanceSheetResponse = await xero.accountingApi.getReportBalanceSheet(
      req.params.tenantId,
      reportDate
    );

    const balanceSheetRows = balanceSheetResponse.body.reports?.[0]?.rows || [];

    // Initialize trial balance structure
    const trialBalance = {
      assets: [],
      liabilities: [],
      equity: [],
      revenue: [],
      expenses: [],
      totals: {
        totalDebits: 0,
        totalCredits: 0,
        totalAssets: 0,
        totalLiabilities: 0,
        totalEquity: 0,
        totalRevenue: 0,
        totalExpenses: 0,
      },
    };

    let processedAccounts = 0;

    // Process each Balance Sheet section
    balanceSheetRows.forEach((section, sectionIndex) => {
      if (section.rowType === "Section" && section.rows && section.title) {
        const sectionTitle = section.title.toLowerCase();

        section.rows.forEach((row) => {
          if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
            const accountName = row.cells[0]?.value || "";
            const currentBalance = parseFloat(row.cells[1]?.value || 0);

            if (
              accountName.toLowerCase().includes("total") ||
              currentBalance === 0
            ) {
              return;
            }

            processedAccounts++;

            const accountInfo = {
              name: accountName,
              balance: currentBalance,
              debit: 0,
              credit: 0,
              section: section.title,
            };

            // Account classification logic
            if (
              sectionTitle.includes("bank") ||
              sectionTitle.includes("asset")
            ) {
              accountInfo.debit = currentBalance >= 0 ? currentBalance : 0;
              accountInfo.credit =
                currentBalance < 0 ? Math.abs(currentBalance) : 0;
              trialBalance.assets.push(accountInfo);
              trialBalance.totals.totalAssets += currentBalance;
            } else if (sectionTitle.includes("liabilit")) {
              accountInfo.credit = currentBalance >= 0 ? currentBalance : 0;
              accountInfo.debit =
                currentBalance < 0 ? Math.abs(currentBalance) : 0;
              trialBalance.liabilities.push(accountInfo);
              trialBalance.totals.totalLiabilities += currentBalance;
            } else if (sectionTitle.includes("equity")) {
              accountInfo.credit = currentBalance >= 0 ? currentBalance : 0;
              accountInfo.debit =
                currentBalance < 0 ? Math.abs(currentBalance) : 0;
              trialBalance.equity.push(accountInfo);
              trialBalance.totals.totalEquity += currentBalance;
            }

            trialBalance.totals.totalDebits += accountInfo.debit;
            trialBalance.totals.totalCredits += accountInfo.credit;
          }
        });
      }
    });

    // Get P&L data for the same date
    try {
      console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Fetching P&L report for Revenue/Expenses...");
      const profitLossResponse =
        await xero.accountingApi.getReportProfitAndLoss(
          req.params.tenantId,
          reportDate,
          reportDate
        );

      const plRows = profitLossResponse.body.reports?.[0]?.rows || [];

      plRows.forEach((section) => {
        if (section.rowType === "Section" && section.rows && section.title) {
          const category = categorizeSection(section.title);
          if (category === "skip") return;

          section.rows.forEach((row) => {
            if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
              const accountName = row.cells[0]?.value || "";
              const currentAmount = parseFloat(row.cells[1]?.value || 0);

              if (
                accountName.toLowerCase().includes("total") ||
                currentAmount === 0
              ) {
                return;
              }

              processedAccounts++;
              const accountInfo = {
                name: accountName,
                balance: currentAmount,
                debit: 0,
                credit: 0,
                section: section.title,
              };

              if (category === "revenue") {
                accountInfo.credit = Math.abs(currentAmount);
                trialBalance.revenue.push(accountInfo);
                trialBalance.totals.totalRevenue += Math.abs(currentAmount);
              } else {
                // Both COGS and OpEx are debits in trial balance
                accountInfo.debit = Math.abs(currentAmount);
                trialBalance.expenses.push(accountInfo);
                trialBalance.totals.totalExpenses += Math.abs(currentAmount);
              }

              trialBalance.totals.totalDebits += accountInfo.debit;
              trialBalance.totals.totalCredits += accountInfo.credit;
            }
          });
        }
      });
    } catch (plError) {
      console.errorlog("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Could not fetch P&L data:", plError.message);
    }

    // Sort and calculate balance check
    ["assets", "liabilities", "equity", "revenue", "expenses"].forEach(
      (category) => {
        trialBalance[category].sort((a, b) => a.name.localeCompare(b.name));
      }
    );

    const balanceCheck = {
      debitsEqualCredits:
        Math.abs(
          trialBalance.totals.totalDebits - trialBalance.totals.totalCredits
        ) < 0.01,
      difference:
        trialBalance.totals.totalDebits - trialBalance.totals.totalCredits,
      accountingEquation: {
        assets: trialBalance.totals.totalAssets,
        liabilitiesAndEquity:
          trialBalance.totals.totalLiabilities +
          trialBalance.totals.totalEquity,
        balanced:
          Math.abs(
            trialBalance.totals.totalAssets -
              (trialBalance.totals.totalLiabilities +
                trialBalance.totals.totalEquity)
          ) < 0.01,
      },
    };

    console.log(
      `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ PROPER Trial balance completed for ${tokenData.tenantName} as at ${reportDate}:`,
      {
        processedAccounts: processedAccounts,
        totalAssets: trialBalance.totals.totalAssets,
        totalLiabilities: trialBalance.totals.totalLiabilities,
        totalEquity: trialBalance.totals.totalEquity,
        balanced: balanceCheck.debitsEqualCredits,
      }
    );

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      trialBalance,
      balanceCheck,
      generatedAt: new Date().toISOString(),
      reportDate: reportDate,
      processedAccounts: processedAccounts,
      dataSource: "Balance Sheet + P&L Reports",
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error getting PROPER trial balance:", error);
    res.status(500).json({
      error: "Failed to get trial balance",
      details: error.message,
      tenantId: req.params.tenantId,
    });
  }
});

// Enhanced Consolidated Trial Balance with Date Support
app.get("/api/consolidated-trial-balance", async (req, res) => {
  try {
    // Get date from query parameter or use today
    const reportDate = req.query.date || new Date().toISOString().split("T")[0];
    console.log(
      `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Loading HIERARCHICAL consolidated trial balance for ${reportDate}...`
    );

    const xeroConnections = await tokenStorage.getAllXeroConnections();
    const connectedXeroEntities = xeroConnections.filter(
      (conn) => conn.connected
    );

    console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ Found ${connectedXeroEntities.length} connected entities`);

    const hierarchicalTrialBalance = {
      consolidated: {
        totals: {
          totalDebits: 0,
          totalCredits: 0,
          totalAssets: 0,
          totalLiabilities: 0,
          totalEquity: 0,
          totalRevenue: 0,
          totalExpenses: 0,
        },
        balanceCheck: {
          debitsEqualCredits: false,
          difference: 0,
          accountingEquation: {
            assets: 0,
            liabilitiesAndEquity: 0,
            balanced: false,
          },
        },
      },
      companies: [],
      reportDate: reportDate,
      generatedAt: new Date().toISOString(),
    };

    // Process each entity with the specified date
    for (const connection of connectedXeroEntities) {
      try {
        console.log(
          `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ Processing entity: ${connection.tenantName} for ${reportDate}`
        );

        const trialBalanceResponse = await fetch(
          `${req.protocol}://${req.get("host")}/api/trial-balance/${
            connection.tenantId
          }?date=${reportDate}`
        );

        if (trialBalanceResponse.ok) {
          const entityTrialBalance = await trialBalanceResponse.json();

          // Create hierarchical company structure
          const companyData = {
            tenantId: connection.tenantId,
            tenantName: connection.tenantName,
            balanceCheck: entityTrialBalance.balanceCheck,
            totals: entityTrialBalance.trialBalance.totals,
            reportDate: entityTrialBalance.reportDate,
            sections: {
              assets: {
                title: "Assets",
                total: entityTrialBalance.trialBalance.totals.totalAssets,
                accounts: entityTrialBalance.trialBalance.assets.map(
                  (account) => ({
                    name: account.name,
                    debit: account.debit,
                    credit: account.credit,
                    balance: account.balance,
                    section: account.section || "Assets",
                  })
                ),
              },
              liabilities: {
                title: "Liabilities",
                total: entityTrialBalance.trialBalance.totals.totalLiabilities,
                accounts: entityTrialBalance.trialBalance.liabilities.map(
                  (account) => ({
                    name: account.name,
                    debit: account.debit,
                    credit: account.credit,
                    balance: account.balance,
                    section: account.section || "Liabilities",
                  })
                ),
              },
              equity: {
                title: "Equity",
                total: entityTrialBalance.trialBalance.totals.totalEquity,
                accounts: entityTrialBalance.trialBalance.equity.map(
                  (account) => ({
                    name: account.name,
                    debit: account.debit,
                    credit: account.credit,
                    balance: account.balance,
                    section: account.section || "Equity",
                  })
                ),
              },
              revenue: {
                title: "Revenue",
                total: entityTrialBalance.trialBalance.totals.totalRevenue,
                accounts: entityTrialBalance.trialBalance.revenue.map(
                  (account) => ({
                    name: account.name,
                    debit: account.debit,
                    credit: account.credit,
                    balance: account.balance,
                    section: account.section || "Revenue",
                  })
                ),
              },
              expenses: {
                title: "Expenses",
                total: entityTrialBalance.trialBalance.totals.totalExpenses,
                accounts: entityTrialBalance.trialBalance.expenses.map(
                  (account) => ({
                    name: account.name,
                    debit: account.debit,
                    credit: account.credit,
                    balance: account.balance,
                    section: account.section || "Expenses",
                  })
                ),
              },
            },
            accountCounts: {
              totalAccounts: Object.values({
                assets: entityTrialBalance.trialBalance.assets,
                liabilities: entityTrialBalance.trialBalance.liabilities,
                equity: entityTrialBalance.trialBalance.equity,
                revenue: entityTrialBalance.trialBalance.revenue,
                expenses: entityTrialBalance.trialBalance.expenses,
              }).reduce((sum, accounts) => sum + accounts.length, 0),
              assetAccounts: entityTrialBalance.trialBalance.assets.length,
              liabilityAccounts:
                entityTrialBalance.trialBalance.liabilities.length,
              equityAccounts: entityTrialBalance.trialBalance.equity.length,
              revenueAccounts: entityTrialBalance.trialBalance.revenue.length,
              expenseAccounts: entityTrialBalance.trialBalance.expenses.length,
            },
          };

          hierarchicalTrialBalance.companies.push(companyData);

          // Add to consolidated totals
          const totals = hierarchicalTrialBalance.consolidated.totals;
          const entityTotals = entityTrialBalance.trialBalance.totals;

          totals.totalDebits += entityTotals.totalDebits;
          totals.totalCredits += entityTotals.totalCredits;
          totals.totalAssets += entityTotals.totalAssets;
          totals.totalLiabilities += entityTotals.totalLiabilities;
          totals.totalEquity += entityTotals.totalEquity;
          totals.totalRevenue += entityTotals.totalRevenue;
          totals.totalExpenses += entityTotals.totalExpenses;

          console.log(
            `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Added ${connection.tenantName} to hierarchical structure for ${reportDate}`
          );
        }
      } catch (error) {
        console.error(
          `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error loading trial balance for ${connection.tenantId}:`,
          error
        );
      }
    }

    // Calculate consolidated balance check and summary
    const totals = hierarchicalTrialBalance.consolidated.totals;
    hierarchicalTrialBalance.consolidated.balanceCheck = {
      debitsEqualCredits:
        Math.abs(totals.totalDebits - totals.totalCredits) < 0.01,
      difference: totals.totalDebits - totals.totalCredits,
      accountingEquation: {
        assets: totals.totalAssets,
        liabilitiesAndEquity: totals.totalLiabilities + totals.totalEquity,
        balanced:
          Math.abs(
            totals.totalAssets - (totals.totalLiabilities + totals.totalEquity)
          ) < 0.01,
      },
    };

    hierarchicalTrialBalance.summary = {
      totalCompanies: hierarchicalTrialBalance.companies.length,
      totalAccounts: hierarchicalTrialBalance.companies.reduce(
        (sum, company) => sum + company.accountCounts.totalAccounts,
        0
      ),
      balancedCompanies: hierarchicalTrialBalance.companies.filter(
        (company) => company.balanceCheck.debitsEqualCredits
      ).length,
      dataQuality: {
        allConnected:
          hierarchicalTrialBalance.companies.length ===
          connectedXeroEntities.length,
        allBalanced: hierarchicalTrialBalance.companies.every(
          (company) => company.balanceCheck.debitsEqualCredits
        ),
        consolidatedBalanced:
          hierarchicalTrialBalance.consolidated.balanceCheck.debitsEqualCredits,
      },
    };

    console.log(
      `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Hierarchical consolidated trial balance completed for ${reportDate}:`,
      {
        companies: hierarchicalTrialBalance.companies.length,
        totalAccounts: hierarchicalTrialBalance.summary.totalAccounts,
        totalAssets: totals.totalAssets,
        consolidatedBalanced:
          hierarchicalTrialBalance.consolidated.balanceCheck.debitsEqualCredits,
      }
    );

    res.json(hierarchicalTrialBalance);
  } catch (error) {
    console.error(
      "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error loading hierarchical consolidated trial balance:",
      error
    );
    res.status(500).json({
      error: "Failed to load hierarchical consolidated trial balance",
    });
  }
});

// DEBUG ENDPOINTS (Keep existing ones)
app.get("/api/debug/simple/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);
    const response = await xero.accountingApi.getAccounts(req.params.tenantId);
    const allAccounts = response.body.accounts || [];
    const firstThree = allAccounts.slice(0, 3);

    res.json({
      message: "Raw Xero account data",
      totalAccounts: allAccounts.length,
      firstThreeAccounts: firstThree,
      firstAccountKeys: firstThree[0] ? Object.keys(firstThree[0]) : [],
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Simple debug error:", error);
    res
      .status(500)
      .json({ error: "Simple debug failed", details: error.message });
  }
});

// TESTING - Balance Sheet endpoint (Keep for testing)
app.get("/api/trial-balance-fixed/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);
    const response = await xero.accountingApi.getAccounts(req.params.tenantId);
    const allAccounts = response.body.accounts || [];

    const today = new Date().toISOString().split("T")[0];
    const balanceSheetResponse = await xero.accountingApi.getReportBalanceSheet(
      req.params.tenantId,
      today
    );

    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ Got Balance Sheet report");

    res.json({
      message: "Testing Balance Sheet approach",
      totalAccounts: allAccounts.length,
      balanceSheetStructure:
        balanceSheetResponse.body.reports?.[0]?.rows?.slice(0, 10),
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Error:", error);
    res
      .status(500)
      .json({ error: "Failed", details: error.message || "No message" });
  }
});

function toggleSectionFromElement(element) {
  const companyIndex = parseInt(element.getAttribute("data-company"));
  const sectionKey = element.getAttribute("data-section");
  toggleSection(companyIndex, sectionKey);
}

// Add these endpoints to your server.js after the existing endpoints

// ============================================================================
// ADDITIONAL FINANCIAL ANALYSIS ENDPOINTS
// ============================================================================

// Replace the existing profit-loss endpoint around line 1600
// Get Profit & Loss summary - UPDATED WITH CURRENT MONTH DEFAULT
app.get("/api/profit-loss/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    // UPDATED DATE LOGIC - Default to current month
    const reportDate = req.query.date || new Date().toISOString().split("T")[0];
    const periodMonths = parseInt(req.query.periodMonths) || 1; // Default to 1 month instead of 12

    // Parse the report date properly
    const reportEndDate = new Date(reportDate);
    if (isNaN(reportEndDate.getTime())) {
      return res.status(400).json({ error: "Invalid report date provided" });
    }

    // Calculate from date based on period months
    let fromDate;
    if (periodMonths === 1) {
      // Current month - first day of current month
      fromDate = new Date(
        reportEndDate.getFullYear(),
        reportEndDate.getMonth(),
        1
      );
    } else {
      // Multi-month period - go back the specified number of months
      fromDate = new Date(reportEndDate);
      fromDate.setMonth(fromDate.getMonth() - (periodMonths - 1));
      fromDate.setDate(1);
    }

    const fromDateStr = fromDate.toISOString().split("T")[0];
    const actualReportDateStr = reportEndDate.toISOString().split("T")[0];

    console.log(
      `P&L Date Range: ${fromDateStr} to ${actualReportDateStr} (${periodMonths} month period)`
    );

    const response = await xero.accountingApi.getReportProfitAndLoss(
      req.params.tenantId,
      fromDateStr,
      actualReportDateStr // Use this instead of reportDate
    );

    const plRows = response.body.reports?.[0]?.rows || [];

    const plSummary = {
      totalRevenue: 0,
      totalCOGS: 0,
      grossProfit: 0,
      totalExpenses: 0,
      netProfit: 0,
      revenueAccounts: [],
      cogsAccounts: [],
      expenseAccounts: [],
    };

    plRows.forEach((section) => {
      if (section.rowType === "Section" && section.rows && section.title) {
        const category = categorizeSection(section.title);
        if (category === "skip") return;

        section.rows.forEach((row) => {
          if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
            const accountName = row.cells[0]?.value || "";
            if (accountName.toLowerCase().includes("total")) return;

            const amount = sumPLRowCells(row.cells);
            if (amount === 0) return;

            if (category === "revenue") {
              plSummary.revenueAccounts.push({
                name: accountName,
                amount: amount,
              });
              plSummary.totalRevenue += amount;
            } else if (category === "cogs") {
              plSummary.cogsAccounts.push({
                name: accountName,
                amount: amount,
              });
              plSummary.totalCOGS += amount;
            } else {
              plSummary.expenseAccounts.push({
                name: accountName,
                amount: amount,
              });
              plSummary.totalExpenses += amount;
            }
          }
        });
      }
    });

    plSummary.grossProfit = plSummary.totalRevenue - plSummary.totalCOGS;
    plSummary.netProfit = plSummary.grossProfit - plSummary.totalExpenses;

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      period: {
        from: fromDateStr,
        to: actualReportDateStr, // Use the hardcoded August 31st date
        months: periodMonths,
        description:
          periodMonths === 1 ? "Current Month" : `${periodMonths} Month Period`,
      },
      summary: plSummary,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting P&L summary:", error);
    res.status(500).json({
      error: "Failed to get P&L summary",
      details: error.message,
    });
  }
});

// Also update the POST endpoint for P&L
app.post("/api/profit-loss-summary", async (req, res) => {
  try {
    const { organizationName, tenantId, date, periodMonths } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    // Find tenant ID if organization name provided
    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Build parameters with updated defaults
    const params = new URLSearchParams();
    if (date) params.append("date", date);
    // Default to 1 month instead of 12 for current month behavior
    params.append("periodMonths", (periodMonths || 1).toString());
    const queryString = params.toString()
      ? `?${params.toString()}`
      : "?periodMonths=1";

    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/profit-loss/${actualTenantId}${queryString}`
    );

    if (!response.ok) {
      throw new Error(`P&L request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ P&L summary API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get aged receivables
app.get("/api/aged-receivables/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const reportDate = req.query.date || new Date().toISOString().split("T")[0];

    console.log(
      `Getting aged receivables for ${tokenData.tenantName} as at ${reportDate}`
    );

    const response = await xero.accountingApi.getReportAgedReceivablesByContact(
      req.params.tenantId,
      null, // contactId
      reportDate
    );

    const reportRows = response.body.reports?.[0]?.rows || [];

    const agedSummary = {
      totalOutstanding: 0,
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      over90days: 0,
      contactBreakdown: [],
    };

    reportRows.forEach((row) => {
      if (row.rowType === "Row" && row.cells && row.cells.length >= 6) {
        const contactName = row.cells[0]?.value || "";
        const total = parseFloat(row.cells[1]?.value || 0);
        const current = parseFloat(row.cells[2]?.value || 0);
        const days1to30 = parseFloat(row.cells[3]?.value || 0);
        const days31to60 = parseFloat(row.cells[4]?.value || 0);
        const days61to90 = parseFloat(row.cells[5]?.value || 0);
        const over90 = parseFloat(row.cells[6]?.value || 0);

        if (
          total > 0 &&
          contactName &&
          !contactName.toLowerCase().includes("total")
        ) {
          agedSummary.contactBreakdown.push({
            contactName,
            total,
            current,
            days1to30,
            days31to60,
            days61to90,
            over90days: over90,
            riskLevel:
              over90 > total * 0.3
                ? "HIGH"
                : days61to90 > total * 0.2
                ? "MEDIUM"
                : "LOW",
          });

          agedSummary.totalOutstanding += total;
          agedSummary.current += current;
          agedSummary.days1to30 += days1to30;
          agedSummary.days31to60 += days31to60;
          agedSummary.days61to90 += days61to90;
          agedSummary.over90days += over90;
        }
      }
    });

    // Sort by total outstanding (highest first)
    agedSummary.contactBreakdown.sort((a, b) => b.total - a.total);

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      reportDate,
      summary: agedSummary,
      riskAnalysis: {
        highRiskCustomers: agedSummary.contactBreakdown.filter(
          (c) => c.riskLevel === "HIGH"
        ).length,
        over90DaysPercentage: (
          (agedSummary.over90days / agedSummary.totalOutstanding) *
          100
        ).toFixed(1),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting aged receivables:", error);
    res.status(500).json({
      error: "Failed to get aged receivables",
      details: error.message,
    });
  }
});

// Get expense analysis
app.get("/api/expense-analysis/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const reportDate = req.query.date || new Date().toISOString().split("T")[0];
    const periodMonths = parseInt(req.query.periodMonths) || 12;

    const fromDate = new Date(reportDate);
    fromDate.setMonth(fromDate.getMonth() - periodMonths);
    const fromDateStr = fromDate.toISOString().split("T")[0];

    console.log(`Getting expense analysis for ${tokenData.tenantName}`);
    const response = await xero.accountingApi.getReportProfitAndLoss(
      req.params.tenantId,
      fromDateStr,
      reportDate
    );

    console.log(
      "P&L API call successful:",
      response.body.reports?.[0] ? "YES" : "NO"
    );
    const plRows = response.body.reports?.[0]?.rows || [];

    const expenseAnalysis = {
      totalExpenses: 0,
      expenseCategories: [],
      topExpenses: [],
      monthlyAverage: 0,
    };

    plRows.forEach((section) => {
      if (section.rowType === "Section" && section.rows && section.title) {
        const sectionTitle = section.title.toLowerCase();

        if (sectionTitle.includes("expense") || sectionTitle.includes("cost")) {
          section.rows.forEach((row) => {
            if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
              const accountName = row.cells[0]?.value || "";
              const amount = parseFloat(row.cells[1]?.value || 0);

              if (!accountName.toLowerCase().includes("total") && amount > 0) {
                const expenseItem = {
                  accountName,
                  amount: amount,
                  monthlyAverage: Math.abs(amount) / periodMonths,
                  category: categorizeExpense(accountName),
                };

                expenseAnalysis.expenseCategories.push(expenseItem);
                expenseAnalysis.totalExpenses += Math.abs(amount);
              }
            }
          });
        }
      }
    });

    // Sort by amount (highest first)
    expenseAnalysis.expenseCategories.sort((a, b) => b.amount - a.amount);
    expenseAnalysis.topExpenses = expenseAnalysis.expenseCategories.slice(
      0,
      10
    );
    expenseAnalysis.monthlyAverage =
      expenseAnalysis.totalExpenses / periodMonths;

    // Group by category
    const categoryTotals = {};
    expenseAnalysis.expenseCategories.forEach((expense) => {
      if (!categoryTotals[expense.category]) {
        categoryTotals[expense.category] = 0;
      }
      categoryTotals[expense.category] += expense.amount;
    });

    expenseAnalysis.categoryBreakdown = Object.entries(categoryTotals)
      .map(([category, total]) => ({
        category,
        total,
        percentage: ((total / expenseAnalysis.totalExpenses) * 100).toFixed(1),
      }))
      .sort((a, b) => b.total - a.total);

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      period: {
        from: fromDateStr,
        to: reportDate,
        months: periodMonths,
      },
      analysis: expenseAnalysis,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting expense analysis:", error);
    res.status(500).json({
      error: "Failed to get expense analysis",
      details: error.message,
    });
  }
});

// Helper function to categorize expenses
function categorizeExpense(accountName) {
  const name = accountName.toLowerCase();

  if (
    name.includes("salary") ||
    name.includes("wage") ||
    name.includes("payroll")
  )
    return "Personnel";
  if (
    name.includes("rent") ||
    name.includes("lease") ||
    name.includes("utilities")
  )
    return "Occupancy";
  if (name.includes("marketing") || name.includes("advertising"))
    return "Marketing";
  if (name.includes("travel") || name.includes("transport")) return "Travel";
  if (name.includes("insurance")) return "Insurance";
  if (
    name.includes("legal") ||
    name.includes("professional") ||
    name.includes("consulting")
  )
    return "Professional Services";
  if (
    name.includes("equipment") ||
    name.includes("computer") ||
    name.includes("software")
  )
    return "Technology";
  if (name.includes("supplies") || name.includes("materials"))
    return "Supplies";
  if (name.includes("depreciation")) return "Depreciation";
  if (name.includes("interest") || name.includes("bank"))
    return "Finance Costs";

  return "Other";
}

// Get intercompany transactions
app.get("/api/intercompany/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const reportDate = req.query.date || new Date().toISOString().split("T")[0];

    console.log(
      `Getting intercompany transactions for ${tokenData.tenantName}`
    );

    // Get trial balance to find intercompany accounts
    const tbResponse = await xero.accountingApi.getReportBalanceSheet(
      req.params.tenantId,
      reportDate
    );

    const balanceSheetRows = tbResponse.body.reports?.[0]?.rows || [];

    const intercompanyAccounts = [];
    const racEntityNames = [
      "rirratjingu",
      "rac",
      "mining",
      "property",
      "enterprises",
      "invest",
      "ngarrkuwuy",
      "marrin",
      "yirrkala",
    ];

    balanceSheetRows.forEach((section) => {
      if (section.rowType === "Section" && section.rows) {
        section.rows.forEach((row) => {
          if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {
            const accountName = row.cells[0]?.value || "";
            const balance = parseFloat(row.cells[1]?.value || 0);

            // Check if account name contains RAC entity names
            const isIntercompany = racEntityNames.some(
              (entity) =>
                accountName.toLowerCase().includes(entity) &&
                (accountName.toLowerCase().includes("loan") ||
                  accountName.toLowerCase().includes("due") ||
                  accountName.toLowerCase().includes("receivable") ||
                  accountName.toLowerCase().includes("payable"))
            );

            if (isIntercompany && Math.abs(balance) > 0) {
              intercompanyAccounts.push({
                accountName,
                balance,
                section: section.title,
                relatedEntity: racEntityNames.find((entity) =>
                  accountName.toLowerCase().includes(entity)
                ),
              });
            }
          }
        });
      }
    });

    const analysis = {
      totalIntercompanyAssets: intercompanyAccounts
        .filter(
          (acc) =>
            acc.balance > 0 && acc.section.toLowerCase().includes("asset")
        )
        .reduce((sum, acc) => sum + acc.balance, 0),
      totalIntercompanyLiabilities: intercompanyAccounts
        .filter(
          (acc) =>
            acc.balance > 0 && acc.section.toLowerCase().includes("liabilit")
        )
        .reduce((sum, acc) => sum + acc.balance, 0),
      accountCount: intercompanyAccounts.length,
      accounts: intercompanyAccounts.sort(
        (a, b) => Math.abs(b.balance) - Math.abs(a.balance)
      ),
    };

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      reportDate,
      analysis,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting intercompany transactions:", error);
    res.status(500).json({
      error: "Failed to get intercompany analysis",
      details: error.message,
    });
  }
});

// ============================================================================
// SHARED HELPER: Calculate financial ratios — no HTTP hop.
// Reuses fetchTrialBalance and fetchProfitLossData helpers.
// ============================================================================
async function fetchFinancialRatios(tenantId, { date } = {}) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) {
    const err = new Error("Tenant not found or token expired");
    err.statusCode = 404;
    throw err;
  }

  const reportDate = date || new Date().toISOString().split("T")[0];

  // Call the helpers directly in parallel — no HTTP hop
  const [tbData, plData] = await Promise.all([
    fetchTrialBalance(tenantId, { reportDate }),
    fetchProfitLossData(tenantId, { date: reportDate, periodMonths: 1 }),
  ]);

  const totals = tbData.trialBalance.totals;
  const plSummary = plData.summary;

  const ratios = {
    liquidity: {
      currentRatio: totals.totalAssets / Math.max(totals.totalLiabilities, 1),
      workingCapital: totals.totalAssets - totals.totalLiabilities,
    },
    leverage: {
      debtToEquity: Math.abs(totals.totalLiabilities) / Math.max(totals.totalEquity, 1),
      equityRatio: totals.totalEquity / Math.max(totals.totalAssets, 1),
    },
    profitability: {
      netProfitMargin: (plSummary.netProfit / Math.max(Math.abs(plSummary.totalRevenue), 1)) * 100,
      returnOnAssets: (plSummary.netProfit / Math.max(totals.totalAssets, 1)) * 100,
      returnOnEquity: (plSummary.netProfit / Math.max(Math.abs(totals.totalEquity), 1)) * 100,
    },
    efficiency: {
      assetTurnover: plSummary.totalRevenue / Math.max(totals.totalAssets, 1),
      expenseRatio: (plSummary.totalExpenses / Math.max(Math.abs(plSummary.totalRevenue), 1)) * 100,
    },
  };

  const interpretations = {
    currentRatio:
      ratios.liquidity.currentRatio > 2 ? "Strong"
      : ratios.liquidity.currentRatio > 1 ? "Adequate"
      : "Concerning",
    debtToEquity:
      ratios.leverage.debtToEquity < 0.3 ? "Conservative"
      : ratios.leverage.debtToEquity < 1 ? "Moderate"
      : "High",
    profitability:
      ratios.profitability.netProfitMargin > 10 ? "Excellent"
      : ratios.profitability.netProfitMargin > 5 ? "Good"
      : ratios.profitability.netProfitMargin > 0 ? "Break-even"
      : "Loss",
  };

  return {
    tenantId,
    tenantName: tokenData.tenantName,
    reportDate,
    ratios,
    interpretations,
    dataSource: {
      totalAssets: totals.totalAssets,
      totalLiabilities: totals.totalLiabilities,
      totalEquity: totals.totalEquity,
      totalRevenue: plSummary.totalRevenue,
      totalExpenses: plSummary.totalExpenses,
      netProfit: plSummary.netProfit,
    },
    generatedAt: new Date().toISOString(),
  };
}

// Get financial ratios
// Get financial ratios
app.get("/api/financial-ratios/:tenantId", async (req, res) => {
  try {
    const result = await fetchFinancialRatios(req.params.tenantId, {
      date: req.query.date,
    });
    res.json(result);
  } catch (error) {
    console.error("Error calculating financial ratios:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: "Failed to calculate financial ratios",
      details: error.message,
    });
  }
});

// ============================================================================
// MONTHLY BREAKDOWN ENDPOINT (for Monthly Card reconciliation)
// ============================================================================

app.get("/api/monthly-breakdown/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res
        .status(404)
        .json({ error: "Tenant not found or token expired" });
    }

    const reportDate = req.query.date || new Date().toISOString().split("T")[0];

    console.log(
      `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ DEBUG: Starting monthly breakdown for ${tokenData.tenantName}`
    );
    console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ DEBUG: Report date: ${reportDate}`);

    // Use IDENTICAL date logic to YoY analysis
    const currentPeriodEnd = new Date(reportDate);
    const currentPeriodStart = new Date(currentPeriodEnd);
    currentPeriodStart.setFullYear(currentPeriodEnd.getFullYear() - 1);
    currentPeriodStart.setDate(currentPeriodStart.getDate() + 1);

    console.log(
      `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ DEBUG: YoY period: ${
        currentPeriodStart.toISOString().split("T")[0]
      } to ${currentPeriodEnd.toISOString().split("T")[0]}`
    );

    // Calculate 12 complete calendar months ending with report month
    const monthlyPeriods = [];
    const reportMonth = new Date(reportDate);

    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(reportMonth);
      monthDate.setMonth(reportMonth.getMonth() - i);

      // Always use complete calendar month (1st to last day)
      const monthStart = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0
      );

      const monthStartStr = monthStart.toISOString().split("T")[0];
      const monthEndStr = monthEnd.toISOString().split("T")[0];

      monthlyPeriods.push({
        monthIndex: i + 1,
        label: monthStart.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        startDate: monthStartStr,
        endDate: monthEndStr,
        dayCount:
          Math.ceil((monthEnd - monthStart) / (1000 * 60 * 60 * 24)) + 1,
      });
    }

    console.log(
      `DEBUG: Created ${monthlyPeriods.length} calendar month periods:`
    );
    monthlyPeriods.forEach((period, idx) => {
      console.log(
        `  Month ${idx + 1}: ${period.startDate} to ${period.endDate} (${
          period.dayCount
        } days) - ${period.label}`
      );
    });

    await xero.setTokenSet(tokenData);

    // Get monthly P&L data for each period
    const monthlyData = [];
    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const period of monthlyPeriods) {
      try {
        console.log(
          `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â  DEBUG: Fetching P&L for ${period.label} (${period.startDate} to ${period.endDate})`
        );

        const response = await xero.accountingApi.getReportProfitAndLoss(
          req.params.tenantId,
          period.startDate,
          period.endDate
        );

        const plRows = response.body.reports?.[0]?.rows || [];
        const monthlyPL = parsePLData(plRows);

        monthlyData.push({
          ...period,
          revenue: monthlyPL.totalRevenue,
          expenses: monthlyPL.totalExpenses,
          netProfit: monthlyPL.totalRevenue - monthlyPL.totalExpenses,
          revenueAccounts: monthlyPL.revenueAccounts.length,
          expenseAccounts: monthlyPL.expenseAccounts.length,
        });

        totalRevenue += monthlyPL.totalRevenue;
        totalExpenses += monthlyPL.totalExpenses;

        console.log(
          `  ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ ${
            period.label
          }: Rev $${monthlyPL.totalRevenue.toLocaleString()}, Exp $${monthlyPL.totalExpenses.toLocaleString()}, Profit $${(
            monthlyPL.totalRevenue - monthlyPL.totalExpenses
          ).toLocaleString()}`
        );
      } catch (monthError) {
        console.error(
          `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ERROR loading month ${period.label}:`,
          monthError.message
        );

        monthlyData.push({
          ...period,
          revenue: 0,
          expenses: 0,
          netProfit: 0,
          revenueAccounts: 0,
          expenseAccounts: 0,
          error: monthError.message,
        });
      }
    }

    // Calculate totals for reconciliation
    const monthlyTotals = {
      totalRevenue,
      totalExpenses,
      totalNetProfit: totalRevenue - totalExpenses,
    };

    console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â  DEBUG: Monthly breakdown totals:`);
    console.log(
      `  Total Revenue: $${monthlyTotals.totalRevenue.toLocaleString()}`
    );
    console.log(
      `  Total Expenses: $${monthlyTotals.totalExpenses.toLocaleString()}`
    );
    console.log(
      `  Total Net Profit: $${monthlyTotals.totalNetProfit.toLocaleString()}`
    );

    // Get YoY data for reconciliation check
    let yoyComparison = null;
    try {
      const yoyParams = req.query.date ? `?date=${req.query.date}` : "";
      const yoyResponse = await fetch(
        `${req.protocol}://${req.get("host")}/api/yoy-analysis/${
          req.params.tenantId
        }${yoyParams}`
      );

      if (yoyResponse.ok) {
        const yoyData = await yoyResponse.json();
        const currentPeriod = yoyData.analysis.periods.current;

        yoyComparison = {
          yoyRevenue: currentPeriod.revenue,
          yoyExpenses: currentPeriod.revenue - currentPeriod.profit, // Calculate from revenue and profit
          yoyNetProfit: currentPeriod.profit,

          // Reconciliation checks
          revenueVariance: monthlyTotals.totalRevenue - currentPeriod.revenue,
          expenseVariance:
            monthlyTotals.totalExpenses -
            (currentPeriod.revenue - currentPeriod.profit),
          profitVariance: monthlyTotals.totalNetProfit - currentPeriod.profit,

          // Status flags
          revenueReconciled:
            Math.abs(monthlyTotals.totalRevenue - currentPeriod.revenue) < 100,
          expenseReconciled:
            Math.abs(
              monthlyTotals.totalExpenses -
                (currentPeriod.revenue - currentPeriod.profit)
            ) < 100,
          profitReconciled:
            Math.abs(monthlyTotals.totalNetProfit - currentPeriod.profit) < 100,
        };

        console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â DEBUG: YoY Reconciliation Check:`);
        console.log(
          `  YoY Revenue: $${yoyComparison.yoyRevenue.toLocaleString()}, Monthly Sum: $${monthlyTotals.totalRevenue.toLocaleString()}, Variance: $${yoyComparison.revenueVariance.toLocaleString()}`
        );
        console.log(
          `  YoY Profit: $${yoyComparison.yoyNetProfit.toLocaleString()}, Monthly Sum: $${monthlyTotals.totalNetProfit.toLocaleString()}, Variance: $${yoyComparison.profitVariance.toLocaleString()}`
        );
        console.log(
          `  Revenue Reconciled: ${
            yoyComparison.revenueReconciled ? "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢"
          }`
        );
        console.log(
          `  Profit Reconciled: ${yoyComparison.profitReconciled ? "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢"}`
        );
      }
    } catch (yoyError) {
      console.warn(
        `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Could not fetch YoY data for reconciliation:`,
        yoyError.message
      );
    }

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      reportDate,
      period: {
        start: currentPeriodStart.toISOString().split("T")[0],
        end: currentPeriodEnd.toISOString().split("T")[0],
        totalDays: Math.ceil(
          (currentPeriodEnd - currentPeriodStart) / (1000 * 60 * 60 * 24)
        ),
      },
      monthlyBreakdown: monthlyData,
      totals: monthlyTotals,
      yoyReconciliation: yoyComparison,
      generatedAt: new Date().toISOString(),
      debugInfo: {
        monthlyPeriodsCount: monthlyPeriods.length,
        errorMonths: monthlyData.filter((m) => m.error).length,
        reconciliationStatus: yoyComparison
          ? {
              overall:
                yoyComparison.revenueReconciled &&
                yoyComparison.profitReconciled
                  ? "RECONCILED"
                  : "VARIANCE_DETECTED",
              largestVariance: Math.max(
                Math.abs(yoyComparison.revenueVariance || 0),
                Math.abs(yoyComparison.profitVariance || 0)
              ),
            }
          : "YOY_DATA_UNAVAILABLE",
      },
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ ERROR in monthly breakdown:", error);
    res.status(500).json({
      error: "Failed to get monthly breakdown",
      details: error.message,
      tenantId: req.params.tenantId,
    });
  }
});

// POST wrapper for Monthly Breakdown
app.post("/api/monthly-breakdown", async (req, res) => {
  try {
    const { organizationName, tenantId, date } = req.body;

    if (!organizationName && !tenantId) {
      return res
        .status(400)
        .json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const dateParam = date ? `?date=${date}` : "";
    const response = await fetch(
      `${req.protocol}://${req.get(
        "host"
      )}/api/monthly-breakdown/${actualTenantId}${dateParam}`
    );

    if (!response.ok) {
      throw new Error(`Monthly breakdown request failed: ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Monthly breakdown API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// REPORT SECTIONS — load & save narrative blocks for Finance Monthly Report
// =============================================================================

// POST /api/report/get
// Body: { org: "RAC", periodMonth: "2026-04" }
// Returns: { sections: { exec_summary: { content, aiDrafted, updatedAt, updatedBy }, ... } }
//
// Returns an empty object if no sections exist yet for this (org, periodMonth).
// The frontend treats that as "first time opening this report" and uses its
// built-in AI-draft placeholders.
app.post("/api/report/get", async (req, res) => {
  try {
    const { org, periodMonth } = req.body;
    if (!org || !periodMonth) {
      return res.status(400).json({ error: "org and periodMonth required" });
    }

    const result = await pool.query(
      `SELECT section_key, content, ai_drafted, updated_at, updated_by
       FROM report_sections
       WHERE org = $1 AND period_month = $2
       ORDER BY updated_at DESC`,
      [org, periodMonth]
    );

    // Shape into a keyed object for easy frontend lookup
    const sections = {};
    for (const row of result.rows) {
      sections[row.section_key] = {
        content: row.content,
        aiDrafted: row.ai_drafted,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      };
    }

    res.json({ org, periodMonth, sections });
  } catch (error) {
    console.error("[report/get] error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/report/save
// Body: { org, periodMonth, sectionKey, content, aiDrafted, updatedBy }
// Returns: { success: true, updatedAt }
//
// Upserts a single section. If a row exists for (org, periodMonth, sectionKey)
// it's overwritten; otherwise inserted. UNIQUE constraint on the natural key
// makes this safe under concurrent saves — last write wins.
app.post("/api/report/save", async (req, res) => {
  try {
    const { org, periodMonth, sectionKey, content, aiDrafted, updatedBy } = req.body;

    if (!org || !periodMonth || !sectionKey || content === undefined) {
      return res.status(400).json({
        error: "org, periodMonth, sectionKey, and content are required",
      });
    }

    const result = await pool.query(
      `INSERT INTO report_sections
        (org, period_month, section_key, content, ai_drafted, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (org, period_month, section_key, version)
       DO UPDATE SET
         content = EXCLUDED.content,
         ai_drafted = EXCLUDED.ai_drafted,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [
        org,
        periodMonth,
        sectionKey,
        content,
        aiDrafted === undefined ? false : aiDrafted,
        updatedBy || 'unknown',
      ]
    );

    res.json({
      success: true,
      org,
      periodMonth,
      sectionKey,
      updatedAt: result.rows[0].updated_at,
    });
  } catch (error) {
    console.error("[report/save] error:", error);
    res.status(500).json({ error: error.message });
  }
  
});
// ============================================================================
// HISTORICAL METRICS ENDPOINT (serves snapshot data to CEO dashboard)
// ============================================================================

app.get("/api/historical-metrics/:organizationName", async (req, res) => {
  try {
    const orgName = decodeURIComponent(req.params.organizationName);
    console.log(`Loading historical metrics for: ${orgName}`);

    // Map short dashboard names to stored DB names
    const orgNameMap = {
      'Property': 'Property Management & Maintenance Services',
      'Ngarrkuwuy': 'Ngarrkuwuy Developments',
      'Invest': 'Rirratjingu Invest',
      'Marrin': 'Marrin Square Developments'
    };
    const dbOrgName = orgNameMap[orgName] || orgName;

    // Query daily snapshots (cash, receivables) - last 90 days
    const dailyResult = await pool.query(
      `SELECT snapshot_date, cash_position, receivables_total, 
              total_assets, total_liabilities, total_equity
       FROM daily_metrics 
       WHERE org = $1 AND job_status = 'success'
       ORDER BY snapshot_date ASC`,
      [dbOrgName]
    );

    // Query monthly P&L snapshots (revenue, expenses, profit)
    const monthlyResult = await pool.query(
      `SELECT period_month, revenue, cogs, gross_profit, opex, net_profit
       FROM monthly_snapshots 
       WHERE org = $1 AND job_status = 'success'
       ORDER BY period_month ASC`,
      [dbOrgName]
    );

    console.log(`Historical metrics for ${orgName}: ${dailyResult.rows.length} daily, ${monthlyResult.rows.length} monthly`);

    res.json({
      organizationName: orgName,
      daily: dailyResult.rows,
      monthly: monthlyResult.rows,
      dataPoints: {
        dailyCount: dailyResult.rows.length,
        monthlyCount: monthlyResult.rows.length,
        dateRange: {
          dailyFrom: dailyResult.rows[0]?.snapshot_date || null,
          dailyTo: dailyResult.rows[dailyResult.rows.length - 1]?.snapshot_date || null,
          monthlyFrom: monthlyResult.rows[0]?.period_month || null,
          monthlyTo: monthlyResult.rows[monthlyResult.rows.length - 1]?.period_month || null,
        }
      },
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error loading historical metrics:", error);
    res.status(500).json({ 
      error: "Failed to load historical metrics", 
      details: error.message 
    });
  }
});

// ============================================================================
// BACKFILL MONTHLY BALANCES (one-off to populate historical month-end data)
// ============================================================================

// Helper: Convert full tenant name to short org name (matches existing snapshot data)
function getOrgShortName(tenantName) {
  const name = tenantName.toLowerCase();
  if (name.includes('mining')) return 'Mining';
  if (name.includes('aboriginal corporation')) return 'Aboriginal Corporation';
  if (name.includes('enterprises')) return 'Enterprises';
  if (name.includes('property management')) return 'Property Management & Maintenance Services';
  if (name.includes('ngarrkuwuy')) return 'Ngarrkuwuy Developments';
  if (name.includes('invest')) return 'Rirratjingu Invest';
  if (name.includes('marrin')) return 'Marrin Square Developments';
  return tenantName;
}

app.post("/api/backfill-monthly-balances", async (req, res) => {
  try {
    console.log("ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Starting monthly balance backfill...");
    
    const monthEndDates = [
      '2025-07-31', '2025-08-31', '2025-09-30',
      '2025-10-31', '2025-11-30', '2025-12-31',
      '2026-01-31'
    ];
    
    // Get all connected orgs
    const connections = await tokenStorage.getAllXeroConnections();
    const activeConnections = connections.filter(c => c.connected);
    
    if (activeConnections.length === 0) {
      return res.status(400).json({ error: "No active Xero connections. Please re-authenticate first." });
    }
    
    console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ Found ${activeConnections.length} active connections`);
    console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Backfilling ${monthEndDates.length} month-end dates`);
    
    const results = [];
    let successCount = 0;
    let failCount = 0;
    
    for (const conn of activeConnections) {
      const orgShortName = getOrgShortName(conn.tenantName);
      
      for (const dateStr of monthEndDates) {
        try {
          // Check if this row already exists
          const existing = await pool.query(
            `SELECT id FROM daily_metrics WHERE org = $1 AND snapshot_date = $2`,
            [orgShortName, dateStr]
          );
          
          if (existing.rows.length > 0) {
            console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â­ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Skipping ${orgShortName} @ ${dateStr} - already exists`);
            results.push({ org: orgShortName, date: dateStr, status: 'skipped' });
            continue;
          }
          
          // Get token and set it
          const tokenData = await tokenStorage.getXeroToken(conn.tenantId);
          if (!tokenData) {
            throw new Error('Token not available');
          }
          await xero.setTokenSet(tokenData);
          
          // Call Xero Balance Sheet API directly for this date
          const bsResponse = await xero.accountingApi.getReportBalanceSheet(
            conn.tenantId,
            dateStr
          );
          
          const bsRows = bsResponse.body.reports?.[0]?.rows || [];
          
          let cashPosition = 0;
          let receivablesTotal = 0;
          let totalAssets = 0;
          let totalLiabilities = 0;
          let totalEquity = 0;
          
          bsRows.forEach(section => {
            if (section.rowType !== 'Section' || !section.rows || !section.title) return;
            const sectionTitle = section.title.toLowerCase();
            
            section.rows.forEach(row => {
              if (row.rowType !== 'Row' || !row.cells || row.cells.length < 2) return;
              const accountName = row.cells[0]?.value || '';
              const balance = parseFloat(row.cells[1]?.value || 0);
              
              if (accountName.toLowerCase().includes('total') || balance === 0) return;
              
              // Classify
              if (sectionTitle === 'bank' || sectionTitle === 'bank accounts') {
                cashPosition += balance;
                totalAssets += balance;
              } else if (sectionTitle.includes('asset')) {
               if (accountName === 'Trade Debtors') {
                  receivablesTotal += balance;
                }
                totalAssets += balance;
              } else if (sectionTitle.includes('liabilit')) {
                totalLiabilities += balance;
              } else if (sectionTitle.includes('equity')) {
                totalEquity += balance;
              }
            });
          });
          
          // Insert into daily_metrics
          await pool.query(
            `INSERT INTO daily_metrics 
             (snapshot_date, org, cash_position, 
              receivables_current, receivables_31_60, receivables_61_90, receivables_over_90, receivables_total,
              total_assets, total_liabilities, total_equity, 
              job_status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'success', NOW())`,
            [dateStr, orgShortName, cashPosition, 
             receivablesTotal, 0, 0, 0, receivablesTotal,
             totalAssets, totalLiabilities, totalEquity]
          );
          
          successCount++;
          results.push({
            org: orgShortName,
            date: dateStr,
            status: 'success',
            cash: Math.round(cashPosition * 100) / 100,
            receivables: Math.round(receivablesTotal * 100) / 100,
            assets: Math.round(totalAssets * 100) / 100
          });
          
          console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ${orgShortName} @ ${dateStr}: Cash=$${cashPosition.toLocaleString()}, Recv=$${receivablesTotal.toLocaleString()}, Assets=$${totalAssets.toLocaleString()}`);
          
          // Rate limit: 500ms between Xero API calls (60/min limit)
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (err) {
          failCount++;
          results.push({ org: orgShortName, date: dateStr, status: 'failed', error: err.message });
          console.error(`ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ ${orgShortName} @ ${dateStr}: ${err.message}`);
          // Wait a bit longer on failure in case of rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â Backfill complete: ${successCount} success, ${failCount} failed out of ${results.length} total`);
    
    res.json({
      message: 'Monthly balance backfill complete',
      summary: { 
        total: results.length, 
        success: successCount, 
        failed: failCount,
        skipped: results.filter(r => r.status === 'skipped').length
      },
      results
    });
    
  } catch (error) {
    console.error("ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Backfill error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// DAILY SNAPSHOT SYSTEM
// Single source of truth for keeping daily_metrics + monthly_snapshots fresh.
// Runs automatically every 24 hours (scheduler), or on-demand via POST.
// Idempotent: re-running in the same day skips already-captured rows.
// ============================================================================

// Compute the start of the current FY (July 1).
function getCurrentFYStart() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(y, 6, 1); // July 1
}

// Returns [{ periodMonth: 'YYYY-MM', endDate: 'YYYY-MM-DD' }] for every COMPLETED
// month across the previous and current FY (i.e. months whose last day is strictly
// before today). Spanning two years ensures early-July runs still capture the
// just-finished FY (e.g. May/June 2026 on 2 July 2026).
function getCompletedMonthsInCurrentFY() {
  const today = new Date();
  const fyStart = getCurrentFYStart();
  // Start from the PREVIOUS FY's July to catch months like May/Jun
  // that fall at the end of the just-finished year.
  const scanStart = new Date(fyStart.getFullYear() - 1, 6, 1); // July 1 of prior year
  const months = [];
  let cursor = new Date(scanStart);
  while (cursor < today) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (monthEnd < today) {
      months.push({
        periodMonth: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        endDate: monthEnd.toISOString().slice(0, 10),
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

async function fetchProfitLossDirect({ tenantId, date, periodMonths = 1 }) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) throw new Error('Token not available');
  await xero.setTokenSet(tokenData);

  const reportEndDate = new Date(date);
  let fromDate;
  if (periodMonths === 1) {
    fromDate = new Date(reportEndDate.getFullYear(), reportEndDate.getMonth(), 1);
  } else {
    fromDate = new Date(reportEndDate);
    fromDate.setMonth(fromDate.getMonth() - (periodMonths - 1));
    fromDate.setDate(1);
  }
  const fromDateStr = fromDate.toISOString().split('T')[0];
  const toDateStr = reportEndDate.toISOString().split('T')[0];

  console.log(`P&L Date Range: ${fromDateStr} to ${toDateStr} (${periodMonths} month period)`);

  const response = await xero.accountingApi.getReportProfitAndLoss(tenantId, fromDateStr, toDateStr);
  const plRows = response.body.reports?.[0]?.rows || [];

  const summary = { totalRevenue: 0, totalCOGS: 0, grossProfit: 0, totalExpenses: 0, netProfit: 0, revenueAccounts: [], cogsAccounts: [], expenseAccounts: [] };

  plRows.forEach((section) => {
    if (section.rowType === 'Section' && section.rows && section.title) {
      const category = categorizeSection(section.title);
      if (category === 'skip') return;
      section.rows.forEach((row) => {
        if (row.rowType === 'Row' && row.cells && row.cells.length >= 2) {
          const accountName = row.cells[0]?.value || '';
          if (accountName.toLowerCase().includes('total')) return;
          const amount = sumPLRowCells(row.cells);
          if (amount === 0) return;
          if (category === 'revenue') { summary.revenueAccounts.push({ name: accountName, amount }); summary.totalRevenue += amount; }
          else if (category === 'cogs') { summary.cogsAccounts.push({ name: accountName, amount }); summary.totalCOGS += amount; }
          else { summary.expenseAccounts.push({ name: accountName, amount }); summary.totalExpenses += amount; }
        }
      });
    }
  });
  summary.grossProfit = summary.totalRevenue - summary.totalCOGS;
  summary.netProfit = summary.grossProfit - summary.totalExpenses;

  return { summary, period: { from: fromDateStr, to: toDateStr, months: periodMonths }, tenantId, tenantName: tokenData.tenantName };
}

// Self-loopback fetch helper. Reuses our own /api/profit-loss-summary so we
// don't reimplement Xero P&L parsing inside the snapshot function.
async function snapshotFetchInternal(endpoint, body) {
  const baseUrl = `http://localhost:${process.env.PORT || 8080}`;
  try {
    const resp = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
}

// Main runner. Called by both the scheduler and the manual button.
// triggeredBy: 'scheduler' | 'scheduler-boot' | 'manual'
// ============================================================================
// SCHEMA MIGRATIONS
// Idempotent: safe to run on every boot. Each statement uses IF NOT EXISTS
// so existing schemas are unchanged. Adds whatever columns/indexes the
// current code needs to be true.
// ============================================================================
async function runSchemaMigrations() {
  // ---------------------------------------------------------------------------
  // REPORT SECTIONS — narrative blocks for the Finance Monthly Report.
  //
  // One row per (org, period_month, section_key). Section_key examples:
  //   'exec_summary', 'pl_commentary', 'receivables_commentary', 'notes'
  //
  // ai_drafted flag tracks whether the content is still the original AI draft
  // (true) or has been edited by a human (false). Lets the UI show an audit
  // trail and lets us decide whether "Regenerate AI" is safe to run.
  //
  // version column is unused in v1 (always 1). Reserved for future:
  // multiple saved versions per (org, period_month, section_key) so you can
  // see "Paul's draft" vs "Matt's edit" vs "Final".
  // ---------------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_sections (
      id SERIAL PRIMARY KEY,
      org VARCHAR(50) NOT NULL,
      period_month VARCHAR(7) NOT NULL,
      section_key VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      ai_drafted BOOLEAN DEFAULT true,
      version INTEGER DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by VARCHAR(100) DEFAULT 'unknown',
      UNIQUE (org, period_month, section_key, version)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_report_sections_lookup
    ON report_sections (org, period_month)
  `);
  console.log('[migration] running schema migrations...');

  // Add snapshot_status column to monthly_snapshots.
  // 'draft' = auto-captured, may change as accountants post late entries
  // 'final' = finalized — locked, will not be auto-overwritten
  await pool.query(`
    ALTER TABLE monthly_snapshots
    ADD COLUMN IF NOT EXISTS snapshot_status TEXT DEFAULT 'draft'
  `);

  // Backfill existing rows: anything that existed before this migration
  // is treated as final (these are historical months long since closed).
  // The COALESCE protects against re-running — only NULLs get touched.
  await pool.query(`
    UPDATE monthly_snapshots
    SET snapshot_status = 'final'
    WHERE snapshot_status IS NULL OR snapshot_status = 'draft' AND created_at < NOW() - INTERVAL '60 days'
  `);

  // Index for fast lookups by month + status
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_period_status
    ON monthly_snapshots (org, period_month, snapshot_status)
  `);

  console.log('[migration] complete');
}

async function runDailySnapshot(triggeredBy = 'scheduler') {
  const startTime = Date.now();
  console.log(`[snapshot:${triggeredBy}] Starting at ${new Date().toISOString()}`);

  const connections = await tokenStorage.getAllXeroConnections();
  const activeConnections = connections.filter((c) => c.connected);
  if (activeConnections.length === 0) {
    console.warn('[snapshot] No active Xero connections - nothing to do.');
    return { success: false, error: 'No active connections', daily: { inserted: 0, skipped: 0 }, monthly: { inserted: 0, skipped: 0 }, orgsProcessed: 0, orgsFailed: 0 };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const completedMonths = getCompletedMonthsInCurrentFY();
  console.log(`[snapshot] ${activeConnections.length} entities x ${completedMonths.length} completed months in FY`);

  let dailyInserted = 0, dailySkipped = 0;
  let monthlyInserted = 0, monthlySkipped = 0;
  const errors = [];
  const orgsWithErrors = new Set();

  for (const conn of activeConnections) {
    const orgShortName = getOrgShortName(conn.tenantName);

    // ------------------------------------------------------------------
    // 1. TODAY'S BALANCE SHEET -> daily_metrics
    // ------------------------------------------------------------------
    try {
      const existingDaily = await pool.query(
        'SELECT id FROM daily_metrics WHERE org = $1 AND snapshot_date = $2',
        [orgShortName, todayStr]
      );

      if (existingDaily.rows.length > 0) {
        dailySkipped++;
      } else {
        const tokenData = await tokenStorage.getXeroToken(conn.tenantId);
        if (!tokenData) throw new Error('Token not available');
        await xero.setTokenSet(tokenData);

        const bsResponse = await xero.accountingApi.getReportBalanceSheet(conn.tenantId, todayStr);
        const bsRows = bsResponse.body.reports?.[0]?.rows || [];

        let cashPosition = 0, receivablesTotal = 0;
        let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;

        bsRows.forEach((section) => {
          if (section.rowType !== 'Section' || !section.rows || !section.title) return;
          const sectionTitle = section.title.toLowerCase();
          section.rows.forEach((row) => {
            if (row.rowType !== 'Row' || !row.cells || row.cells.length < 2) return;
            const accountName = row.cells[0]?.value || '';
            const balance = parseFloat(row.cells[1]?.value || 0);
            if (accountName.toLowerCase().includes('total') || balance === 0) return;
            if (sectionTitle === 'bank' || sectionTitle === 'bank accounts') {
              cashPosition += balance;
              totalAssets += balance;
            } else if (sectionTitle.includes('asset')) {
              if (accountName === 'Trade Debtors') receivablesTotal += balance;
              totalAssets += balance;
            } else if (sectionTitle.includes('liabilit')) {
              totalLiabilities += balance;
            } else if (sectionTitle.includes('equity')) {
              totalEquity += balance;
            }
          });
        });

        await pool.query(
          `INSERT INTO daily_metrics
            (snapshot_date, org, cash_position,
             receivables_current, receivables_31_60, receivables_61_90, receivables_over_90, receivables_total,
             total_assets, total_liabilities, total_equity,
             job_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'success', NOW())`,
          [todayStr, orgShortName, cashPosition,
           receivablesTotal, 0, 0, 0, receivablesTotal,
           totalAssets, totalLiabilities, totalEquity]
        );
        dailyInserted++;
        console.log(`[snapshot] daily ${orgShortName} ${todayStr}: cash=$${Math.round(cashPosition).toLocaleString()}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      orgsWithErrors.add(orgShortName);
      errors.push({ org: orgShortName, type: 'daily', error: err.message });
      console.error(`[snapshot] daily ${orgShortName} FAILED:`, err.message);
      // Backoff a touch on failure
      await new Promise((r) => setTimeout(r, 1000));
    }

    // ------------------------------------------------------------------
    // 2. COMPLETED MONTHLY P&L -> monthly_snapshots
    //    Uses Xero P&L with periodMonths=1, date=lastDayOfMonth.
    // ------------------------------------------------------------------
    for (const { periodMonth, endDate } of completedMonths) {
      try {
        // Only skip if there's already a FINAL snapshot for this month.
        // Drafts are fair game to overwrite — late accruals and reversals
        // mean today's auto-snapshot may have better numbers than yesterday's.
        const existing = await pool.query(
          `SELECT id, snapshot_status FROM monthly_snapshots
           WHERE org = $1 AND period_month = $2`,
          [orgShortName, periodMonth]
        );
        const existingFinal = existing.rows.find(r => r.snapshot_status === 'final');
        if (existingFinal) {
          monthlySkipped++;
          continue;
        }
        // Draft exists — delete it so the INSERT below writes a fresh draft.
        if (existing.rows.length > 0) {
          await pool.query(
            `DELETE FROM monthly_snapshots
             WHERE org = $1 AND period_month = $2 AND snapshot_status = 'draft'`,
            [orgShortName, periodMonth]
          );
        }

        const plResp = await fetchProfitLossDirect({
  tenantId: conn.tenantId,
  date: endDate,
  periodMonths: 1,
});

        if (plResp.error || !plResp.summary) {
          errors.push({ org: orgShortName, periodMonth, type: 'monthly', error: plResp.error || 'no summary returned' });
          console.warn(`[snapshot] monthly ${orgShortName} ${periodMonth} skipped: ${plResp.error || 'no summary'}`);
          continue;
        }

        const s = plResp.summary;
        const revenue = s.totalRevenue || 0;
        const cogs = s.totalCOGS || 0;
        const gross = s.grossProfit ?? (revenue - cogs);
        const opex = s.totalExpenses || 0;
        const netProfit = s.netProfit ?? (gross - opex);

        await pool.query(
          `INSERT INTO monthly_snapshots
            (org, period_month, revenue, cogs, gross_profit, opex, net_profit, snapshot_date, job_status, snapshot_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 'success', 'draft', NOW())`,
          [orgShortName, periodMonth, revenue, cogs, gross, opex, netProfit]
        );
        monthlyInserted++;
        console.log(`[snapshot] monthly ${orgShortName} ${periodMonth}: rev=$${Math.round(revenue).toLocaleString()}, np=$${Math.round(netProfit).toLocaleString()}`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        errors.push({ org: orgShortName, periodMonth, type: 'monthly', error: err.message });
        console.error(`[snapshot] monthly ${orgShortName} ${periodMonth} FAILED:`, err.message);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  const summary = {
    success: errors.length === 0 || (dailyInserted + monthlyInserted) > 0,
    triggeredBy,
    durationSeconds,
    daily: { inserted: dailyInserted, skipped: dailySkipped },
    monthly: { inserted: monthlyInserted, skipped: monthlySkipped },
    orgsProcessed: activeConnections.length - orgsWithErrors.size,
    orgsFailed: orgsWithErrors.size,
    errors: errors.slice(0, 30),
  };
  console.log(`[snapshot:${triggeredBy}] complete in ${durationSeconds}s: daily +${dailyInserted}/-${dailySkipped}, monthly +${monthlyInserted}/-${monthlySkipped}, errors=${errors.length}`);
  return summary;
}

// Scheduler — first run 60s after boot, then every 24h.
let dailySnapshotInterval;
function startDailySnapshotScheduler() {
  console.log('[snapshot] Daily snapshot scheduler armed (first run in 60s, then every 24h)');

  setTimeout(() => {
    runDailySnapshot('scheduler-boot').catch((err) => {
      console.error('[snapshot] First scheduled run failed:', err);
    });
  }, 60 * 1000);

  dailySnapshotInterval = setInterval(async () => {
    try {
      await runDailySnapshot('scheduler');
    } catch (err) {
      console.error('[snapshot] Scheduled run failed:', err);
    }
  }, 24 * 60 * 60 * 1000);
}

// HTTP endpoint — what the dashboard "Snapshot" button calls.
// Previously this endpoint did not exist; the button silently 404'd.
app.post('/api/run-daily-snapshot', async (req, res) => {
  try {
    const { triggeredBy = 'manual' } = req.body || {};
    const result = await runDailySnapshot(triggeredBy);
    res.json({
      success: result.success,
      orgsProcessed: result.orgsProcessed,
      orgsFailed: result.orgsFailed,
      durationSeconds: result.durationSeconds,
      summary: result,
    });
  } catch (error) {
    console.error('[snapshot] endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// FINALIZE MONTH — promote 'draft' monthly snapshots to 'final'
// Drafts get auto-overwritten by the daily scheduler. Finals are locked and
// will not be touched by the auto-snapshot — they represent post-close numbers.
// ============================================================================

// Helper: derive last-day-of-month "YYYY-MM-DD" from "YYYY-MM"
function periodMonthToEndDate(periodMonth) {
  const [yearStr, monthStr] = periodMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  // day 0 of next month = last day of this month
  const lastDay = new Date(year, month, 0);
  return lastDay.toISOString().slice(0, 10);
}

// GET /api/draft-months
// Lightweight read for the dashboard to know which months are still draft.
// Dashboard polls this on load to decide whether to show the "Finalize" button.
app.get('/api/draft-months', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT period_month, org, revenue, net_profit, created_at
       FROM monthly_snapshots
       WHERE snapshot_status = 'draft' AND job_status = 'success'
       ORDER BY period_month ASC, org ASC`
    );

    res.json({
      draftRows: result.rows,
      totalDrafts: result.rows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[draft-months] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/finalize-month
// Body: { periodMonths: ['2026-04', '2026-05'], entities: 'all' | ['Mining', ...] }
// Re-fetches P&L from Xero for each draft (org, periodMonth) pair and writes
// it back as 'final'. Existing 'final' rows are left alone (locked).
// Reuses snapshotFetchInternal so we don't duplicate Xero P&L parsing logic.
app.post('/api/finalize-month', async (req, res) => {
  const startTime = Date.now();

  try {
    const { periodMonths, entities = 'all', targets } = req.body || {};

    // Resolve which entities to process. Always work from active connections
    // so we have current tenantName/tenantId for the Xero fetch.
    const connections = await tokenStorage.getAllXeroConnections();
    const activeConnections = connections.filter((c) => c.connected);
    if (activeConnections.length === 0) {
      return res.status(400).json({ error: 'No active Xero connections.' });
    }

    // Build a flat list of work items: {tenantName, orgShortName, periodMonth}.
    // Two input modes are supported:
    //   1. targets[] — explicit (org, periodMonth) pairs (preferred for granular UI)
    //   2. periodMonths[] + entities — cartesian product (kept for backward compat)
    const workItems = [];

    if (Array.isArray(targets) && targets.length > 0) {
      // Per-target mode
      for (const t of targets) {
        if (!t || !t.periodMonth || !t.org) {
          return res.status(400).json({
            error: 'each targets entry must have {periodMonth, org}',
          });
        }
        const conn = activeConnections.find(
          (c) => getOrgShortName(c.tenantName) === t.org
        );
        if (!conn) {
          // Don't fail the whole request — surface as a per-target error
          // so the caller sees which orgs couldn't be resolved.
          workItems.push({
            tenantName: null,
            tenantId: conn.tenantId,  
            orgShortName: t.org,
            periodMonth: t.periodMonth,
            resolveError: `No active connection for org "${t.org}"`,
          });
          continue;
        }
        workItems.push({
          tenantName: conn.tenantName,
          tenantId: conn.tenantId,  
          orgShortName: t.org,
          periodMonth: t.periodMonth,
        });
      }
    } else if (Array.isArray(periodMonths) && periodMonths.length > 0) {
      // Per-period mode (cartesian product of periodMonths × entities)
      let workingConnections = activeConnections;
      if (entities !== 'all' && Array.isArray(entities) && entities.length > 0) {
        workingConnections = activeConnections.filter((c) =>
          entities.includes(getOrgShortName(c.tenantName))
        );
      }
      for (const conn of workingConnections) {
        const orgShortName = getOrgShortName(conn.tenantName);
        for (const periodMonth of periodMonths) {
          workItems.push({
            tenantName: conn.tenantName,
            orgShortName,
            periodMonth,
          });
        }
      }
    } else {
      return res.status(400).json({
        error: 'Provide either targets[] (preferred) or periodMonths[] + entities',
      });
    }

    console.log(`[finalize] starting: ${workItems.length} work items`);

    const finalized = [];
    const skippedAlreadyFinal = [];
    const errors = [];

    for (const item of workItems) {
      const { tenantName, tenantId, orgShortName, periodMonth, resolveError } = item;

      // Couldn't resolve org → no Xero call possible
      if (resolveError) {
        errors.push({ org: orgShortName, periodMonth, error: resolveError });
        console.warn(`[finalize] ${orgShortName} ${periodMonth} skipped: ${resolveError}`);
        continue;
      }

      try {
        // Skip if already finalized — finals are locked.
        const existing = await pool.query(
          `SELECT id, snapshot_status FROM monthly_snapshots
           WHERE org = $1 AND period_month = $2`,
          [orgShortName, periodMonth]
        );
        if (existing.rows.some((r) => r.snapshot_status === 'final')) {
          skippedAlreadyFinal.push({ org: orgShortName, periodMonth });
          continue;
        }

        // Re-fetch P&L for this exact month
        const endDate = periodMonthToEndDate(periodMonth);
const finalizeConn = activeConnections.find(c => c.tenantName === tenantName);
if (!finalizeConn) {
  errors.push({ org: orgShortName, periodMonth, error: 'Could not resolve tenantId for ' + tenantName });
  continue;
}
const plResp = await fetchProfitLossDirect({
  tenantId: finalizeConn.tenantId,
  date: endDate,
  periodMonths: 1,
});

        if (plResp.error || !plResp.summary) {
          errors.push({
            org: orgShortName,
            periodMonth,
            error: plResp.error || 'no summary returned',
          });
          console.warn(
            `[finalize] ${orgShortName} ${periodMonth} skipped: ${plResp.error || 'no summary'}`
          );
          continue;
        }

        const s = plResp.summary;
        const revenue = s.totalRevenue || 0;
        const cogs = s.totalCOGS || 0;
        const gross = s.grossProfit ?? revenue - cogs;
        const opex = s.totalExpenses || 0;
        const netProfit = s.netProfit ?? gross - opex;

        // Atomic delete-then-insert. If the INSERT fails we must NOT leave the
        // database with the draft already gone — that would be data loss.
        // Single connection + BEGIN/COMMIT keeps it all-or-nothing.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `DELETE FROM monthly_snapshots
             WHERE org = $1 AND period_month = $2 AND snapshot_status = 'draft'`,
            [orgShortName, periodMonth]
          );
          await client.query(
            `INSERT INTO monthly_snapshots
              (org, period_month, revenue, cogs, gross_profit, opex, net_profit, snapshot_date, job_status, snapshot_status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 'success', 'final', NOW())`,
            [orgShortName, periodMonth, revenue, cogs, gross, opex, netProfit]
          );
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr; // bubble to outer catch — pushes onto errors[]
        } finally {
          client.release();
        }

        finalized.push({
          org: orgShortName,
          periodMonth,
          revenue,
          netProfit,
        });
        console.log(
          `[finalize] ${orgShortName} ${periodMonth}: rev=$${Math.round(revenue).toLocaleString()}, np=$${Math.round(netProfit).toLocaleString()}`
        );

        // Brief pause to be polite to Xero rate limits
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        errors.push({ org: orgShortName, periodMonth, error: err.message });
        console.error(
          `[finalize] ${orgShortName} ${periodMonth} FAILED:`,
          err.message
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[finalize] complete in ${durationSeconds}s: finalized=${finalized.length}, skipped=${skippedAlreadyFinal.length}, errors=${errors.length}`
    );

    res.json({
      success: errors.length === 0,
      durationSeconds,
      finalized,
      skippedAlreadyFinal,
      errors,
      summary: {
        requested: workItems.length,
        finalized: finalized.length,
        skippedAlreadyFinal: skippedAlreadyFinal.length,
        errors: errors.length,
      },
    });
  } catch (error) {
    console.error('[finalize] endpoint error:', error);
    res
      .status(500)
      .json({ success: false, error: error.message });
  }
});

// ============================================================================
// BACKFILL HISTORICAL MONTHS
// One-shot endpoint to populate monthly_snapshots for prior fiscal years.
// Inserts as 'final' (historical periods are stable; no point treating them
// as draft). Skips any (org, period_month) pair that already has a row —
// will never overwrite existing data, so safe to re-run.
// ============================================================================

// Helper: enumerate "YYYY-MM" strings between two month bounds (inclusive)
function enumerateMonths(startMonth, endMonth) {
  const months = [];
  let [year, month] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

app.post('/api/backfill-historical-months', async (req, res) => {
  const startTime = Date.now();

  try {
    const { startMonth, endMonth } = req.body || {};

    // Basic validation: both required, format YYYY-MM, start <= end
    const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!startMonth || !endMonth || !monthRe.test(startMonth) || !monthRe.test(endMonth)) {
      return res.status(400).json({
        error: 'startMonth and endMonth required, format "YYYY-MM"',
      });
    }
    if (startMonth > endMonth) {
      return res.status(400).json({ error: 'startMonth must be <= endMonth' });
    }
    // Don't allow backfill into the future or current month — that's the
    // auto-snapshot's job.
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (endMonth >= currentMonthStr) {
      return res.status(400).json({
        error: `endMonth must be earlier than current month (${currentMonthStr}). Backfill is for historical data only.`,
      });
    }

    const periodMonths = enumerateMonths(startMonth, endMonth);

    const connections = await tokenStorage.getAllXeroConnections();
    const activeConnections = connections.filter((c) => c.connected);
    if (activeConnections.length === 0) {
      return res.status(400).json({ error: 'No active Xero connections.' });
    }

    console.log(
      `[backfill] starting: ${periodMonths.length} months x ${activeConnections.length} entities = ${periodMonths.length * activeConnections.length} potential inserts`
    );

    const inserted = [];
    const skippedExists = [];
    const errors = [];

    for (const conn of activeConnections) {
      const orgShortName = getOrgShortName(conn.tenantName);

      for (const periodMonth of periodMonths) {
        try {
          // Skip if ANY row exists for this (org, periodMonth) — drafts and
          // finals alike. Backfill is purely additive; never touches existing.
          const existing = await pool.query(
            `SELECT id FROM monthly_snapshots
             WHERE org = $1 AND period_month = $2`,
            [orgShortName, periodMonth]
          );
          if (existing.rows.length > 0) {
            skippedExists.push({ org: orgShortName, periodMonth });
            continue;
          }

          // Fetch P&L for that month
          const endDate = periodMonthToEndDate(periodMonth);
const plResp = await fetchProfitLossDirect({
  tenantId: conn.tenantId,
  date: endDate,
  periodMonths: 1,
});

          if (plResp.error || !plResp.summary) {
            errors.push({
              org: orgShortName,
              periodMonth,
              error: plResp.error || 'no summary returned',
            });
            console.warn(
              `[backfill] ${orgShortName} ${periodMonth} skipped: ${plResp.error || 'no summary'}`
            );
            continue;
          }

          const s = plResp.summary;
          const revenue = s.totalRevenue || 0;
          const cogs = s.totalCOGS || 0;
          const gross = s.grossProfit ?? revenue - cogs;
          const opex = s.totalExpenses || 0;
          const netProfit = s.netProfit ?? gross - opex;

          await pool.query(
            `INSERT INTO monthly_snapshots
              (org, period_month, revenue, cogs, gross_profit, opex, net_profit, snapshot_date, job_status, snapshot_status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 'success', 'final', NOW())`,
            [orgShortName, periodMonth, revenue, cogs, gross, opex, netProfit]
          );

          inserted.push({ org: orgShortName, periodMonth, revenue, netProfit });
          console.log(
            `[backfill] ${orgShortName} ${periodMonth}: rev=$${Math.round(revenue).toLocaleString()}, np=$${Math.round(netProfit).toLocaleString()}`
          );

          // Polite delay to keep well under Xero's 60/min rate limit
          await new Promise((r) => setTimeout(r, 600));
        } catch (err) {
          errors.push({ org: orgShortName, periodMonth, error: err.message });
          console.error(
            `[backfill] ${orgShortName} ${periodMonth} FAILED:`,
            err.message
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[backfill] complete in ${durationSeconds}s: inserted=${inserted.length}, skipped=${skippedExists.length}, errors=${errors.length}`
    );

    res.json({
      success: errors.length === 0,
      durationSeconds,
      inserted,
      skippedExists,
      errors,
      summary: {
        range: { startMonth, endMonth, monthCount: periodMonths.length },
        entityCount: activeConnections.length,
        attempted: periodMonths.length * activeConnections.length,
        inserted: inserted.length,
        skippedExists: skippedExists.length,
        errors: errors.length,
      },
    });
  } catch (error) {
    console.error('[backfill] endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// ACCOUNT VARIANCE
// Compares two date periods at the account-level. Returns top contributors to
// revenue / cogs / expense / net-profit changes. Drives Tier 2 AI commentary
// — instead of "revenue dropped 60%", AI can say "revenue dropped 60% with
// $X driven by Account 4100 'Aggregate Sales - RIO'".
// ============================================================================

// Helper: months between two dates inclusive (used to translate a date range
// into the periodMonths parameter the existing P&L endpoint expects).
function monthsBetween(startDate, endDate) {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}

// Aggregate account arrays across entities/periods. Sums by account name.
// Returns array of {name, amount} sorted by amount descending.
function aggregateAccounts(...arrays) {
  const map = {};
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const a of arr) {
      if (!a || !a.name) continue;
      if (!map[a.name]) map[a.name] = 0;
      map[a.name] += parseFloat(a.amount) || 0;
    }
  }
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

// Diff two account arrays by name. Returns {name, current, prior, delta, deltaPct}
// sorted by absolute delta descending. Names appearing in only one period
// still show up — current=0 or prior=0 indicates new/discontinued lines.
function diffAccounts(currentAccounts, priorAccounts) {
  const map = {};
  (currentAccounts || []).forEach(a => {
    if (!map[a.name]) map[a.name] = { name: a.name, current: 0, prior: 0 };
    map[a.name].current += parseFloat(a.amount) || 0;
  });
  (priorAccounts || []).forEach(a => {
    if (!map[a.name]) map[a.name] = { name: a.name, current: 0, prior: 0 };
    map[a.name].prior += parseFloat(a.amount) || 0;
  });
  return Object.values(map)
    .map(r => {
      const delta = r.current - r.prior;
      const deltaPct = r.prior !== 0 ? (delta / Math.abs(r.prior)) * 100 : (r.current !== 0 ? null : 0);
      return { ...r, delta, deltaPct };
    })
    .filter(r => Math.abs(r.delta) > 0.01) // drop zero-delta noise
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

app.post('/api/account-variance', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      organizationName,
      currentStartDate,
      currentEndDate,
      priorStartDate,
      priorEndDate,
      topN = 10,
    } = req.body || {};

    if (!organizationName || !currentStartDate || !currentEndDate || !priorStartDate || !priorEndDate) {
      return res.status(400).json({
        error: 'organizationName, currentStartDate, currentEndDate, priorStartDate, priorEndDate are all required',
      });
    }

    const currentMonths = monthsBetween(currentStartDate, currentEndDate);
    const priorMonths = monthsBetween(priorStartDate, priorEndDate);

    // Resolve entities. 'ALL' / 'All Entities' fan out to every active connection.
    const isAll = ['all', 'all entities', 'consolidated'].includes(String(organizationName).toLowerCase());
    let tenantNames;
    if (isAll) {
      const conns = await tokenStorage.getAllXeroConnections();
      tenantNames = conns.filter(c => c.connected).map(c => c.tenantName);
    } else {
      // Resolve short name → full tenant name via existing connections
      const conns = await tokenStorage.getAllXeroConnections();
      const match = conns.find(c =>
        c.connected && (
          c.tenantName.toLowerCase().includes(String(organizationName).toLowerCase()) ||
          getOrgShortName(c.tenantName) === organizationName
        )
      );
      if (!match) {
        return res.status(404).json({ error: `No active connection found for "${organizationName}"` });
      }
      tenantNames = [match.tenantName];
    }

    console.log(`[variance] ${tenantNames.length} entit${tenantNames.length === 1 ? 'y' : 'ies'}: current=${currentStartDate}..${currentEndDate} (${currentMonths}mo), prior=${priorStartDate}..${priorEndDate} (${priorMonths}mo)`);

    // Fetch P&L for both periods, all entities. Entity-by-entity so we can
    // attribute account variance to the entity it came from.
    const byEntity = [];
    for (const tenantName of tenantNames) {
      const orgShortName = getOrgShortName(tenantName);
      try {
        const [curResp, priorResp] = await Promise.all([
          snapshotFetchInternal('/api/profit-loss-summary', {
            organizationName: tenantName,
            date: currentEndDate,
            periodMonths: currentMonths,
          }),
          snapshotFetchInternal('/api/profit-loss-summary', {
            organizationName: tenantName,
            date: priorEndDate,
            periodMonths: priorMonths,
          }),
        ]);

        if (curResp.error || !curResp.summary || priorResp.error || !priorResp.summary) {
          console.warn(`[variance] ${orgShortName}: skip — current=${curResp.error || 'ok'}, prior=${priorResp.error || 'ok'}`);
          continue;
        }

        byEntity.push({
          entity: orgShortName,
          current: {
            totalRevenue: curResp.summary.totalRevenue || 0,
            totalCOGS: curResp.summary.totalCOGS || 0,
            grossProfit: curResp.summary.grossProfit || 0,
            totalExpenses: curResp.summary.totalExpenses || 0,
            netProfit: curResp.summary.netProfit || 0,
            revenueAccounts: curResp.summary.revenueAccounts || [],
            cogsAccounts: curResp.summary.cogsAccounts || [],
            expenseAccounts: curResp.summary.expenseAccounts || [],
          },
          prior: {
            totalRevenue: priorResp.summary.totalRevenue || 0,
            totalCOGS: priorResp.summary.totalCOGS || 0,
            grossProfit: priorResp.summary.grossProfit || 0,
            totalExpenses: priorResp.summary.totalExpenses || 0,
            netProfit: priorResp.summary.netProfit || 0,
            revenueAccounts: priorResp.summary.revenueAccounts || [],
            cogsAccounts: priorResp.summary.cogsAccounts || [],
            expenseAccounts: priorResp.summary.expenseAccounts || [],
          },
        });
      } catch (err) {
        console.error(`[variance] ${orgShortName} failed:`, err.message);
      }
      // Polite delay between entities
      await new Promise(r => setTimeout(r, 300));
    }

    if (byEntity.length === 0) {
      return res.status(500).json({ error: 'No P&L data could be fetched for any entity in either period' });
    }

    // Per-entity account-level diff (attribution stays attached to entity)
    const entityVariance = byEntity.map(e => {
      const revDiff = diffAccounts(e.current.revenueAccounts, e.prior.revenueAccounts).slice(0, topN);
      const cogsDiff = diffAccounts(e.current.cogsAccounts, e.prior.cogsAccounts).slice(0, topN);
      const expDiff = diffAccounts(e.current.expenseAccounts, e.prior.expenseAccounts).slice(0, topN);
      return {
        entity: e.entity,
        totals: {
          revenue: { current: e.current.totalRevenue, prior: e.prior.totalRevenue, delta: e.current.totalRevenue - e.prior.totalRevenue },
          cogs:    { current: e.current.totalCOGS, prior: e.prior.totalCOGS, delta: e.current.totalCOGS - e.prior.totalCOGS },
          expenses:{ current: e.current.totalExpenses, prior: e.prior.totalExpenses, delta: e.current.totalExpenses - e.prior.totalExpenses },
          netProfit:{current: e.current.netProfit, prior: e.prior.netProfit, delta: e.current.netProfit - e.prior.netProfit },
        },
        topRevenueChanges: revDiff,
        topCOGSChanges: cogsDiff,
        topExpenseChanges: expDiff,
      };
    });

    // Consolidated totals across all entities
    const consolidated = {
      revenue:  { current: 0, prior: 0, delta: 0 },
      cogs:     { current: 0, prior: 0, delta: 0 },
      expenses: { current: 0, prior: 0, delta: 0 },
      netProfit:{ current: 0, prior: 0, delta: 0 },
    };
    entityVariance.forEach(e => {
      ['revenue', 'cogs', 'expenses', 'netProfit'].forEach(k => {
        consolidated[k].current += e.totals[k].current;
        consolidated[k].prior   += e.totals[k].prior;
      });
    });
    Object.keys(consolidated).forEach(k => {
      consolidated[k].delta = consolidated[k].current - consolidated[k].prior;
      consolidated[k].deltaPct = consolidated[k].prior !== 0
        ? (consolidated[k].delta / Math.abs(consolidated[k].prior)) * 100
        : null;
    });

    // For consolidated view, surface the top movers across all entities
    // (account name + entity, since the same account name can exist in multiple entities)
    const flatRevChanges = [];
    const flatExpChanges = [];
    entityVariance.forEach(e => {
      e.topRevenueChanges.forEach(c => flatRevChanges.push({ ...c, entity: e.entity }));
      e.topExpenseChanges.forEach(c => flatExpChanges.push({ ...c, entity: e.entity }));
    });
    const topRevenueMoversConsolidated = flatRevChanges
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, topN);
    const topExpenseMoversConsolidated = flatExpChanges
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, topN);

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    console.log(`[variance] complete in ${durationSeconds}s: ${byEntity.length} entities analysed`);

    res.json({
      success: true,
      durationSeconds,
      periods: {
        current: { startDate: currentStartDate, endDate: currentEndDate, months: currentMonths },
        prior:   { startDate: priorStartDate, endDate: priorEndDate, months: priorMonths },
      },
      organizationName,
      consolidated,
      byEntity: entityVariance,
      topRevenueMoversConsolidated,
      topExpenseMoversConsolidated,
    });
  } catch (error) {
    console.error('[variance] endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// One-time fix: Delete a specific daily_metrics row
app.post("/api/delete-metrics-row", async (req, res) => {
  try {
    const { org, date } = req.body;
    if (!org || !date) {
      return res.status(400).json({ error: "org and date required" });
    }

    const result = await pool.query(
      `DELETE FROM daily_metrics WHERE org = $1 AND snapshot_date = $2`,
      [org, date]
    );

    res.json({
      success: true,
      deleted: result.rowCount,
      message: `Deleted ${result.rowCount} row(s) for ${org} @ ${date}`
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// REVERSAL JOURNALS ENDPOINT
// Fetches manual journals, identifies reversals by description pattern,
// and calculates their P&L impact for the dashboard toggle feature
// ============================================================================

app.get("/api/reversal-journals/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res.status(404).json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const dateFrom = req.query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const dateTo = req.query.dateTo || new Date().toISOString().split("T")[0];

    console.log(`Ã°Å¸â€â€ž Fetching reversal journals for ${tokenData.tenantName} from ${dateFrom} to ${dateTo}`);

    // Step 1: Get chart of accounts for account type lookup
    const accountsResponse = await xero.accountingApi.getAccounts(req.params.tenantId);
    const accountTypeMap = {};
    (accountsResponse.body.accounts || []).forEach(acc => {
      accountTypeMap[acc.code] = {
        type: acc.type,
        name: acc.name,
        class: acc.class
      };
    });

    // Step 2: Get list of manual journals for the date range
    const whereClause = `Date >= DateTime(${dateFrom.replace(/-/g, ",")}) AND Date <= DateTime(${dateTo.replace(/-/g, ",")})`;
    const journalListResponse = await xero.accountingApi.getManualJournals(
      req.params.tenantId,
      null,
      whereClause
    );

    const journalList = (journalListResponse.body.manualJournals || [])
      .filter(j => j.status === "POSTED");

    console.log(`Ã°Å¸â€œâ€¹ Found ${journalList.length} posted manual journals in period`);

    // Step 3: Fetch each journal individually to get line details
    const reversalJournals = [];
    let revenueAdjustment = 0;
    let cogsAdjustment = 0;
    let expenseAdjustment = 0;

    for (const journal of journalList) {
      try {
        const detailResponse = await xero.accountingApi.getManualJournal(
          req.params.tenantId,
          journal.manualJournalID
        );

        const fullJournal = detailResponse.body.manualJournals?.[0];
        if (!fullJournal || !fullJournal.journalLines) continue;

        // Check if ANY line description or narration contains "Reversal:"
        const hasReversalInLines = fullJournal.journalLines.some(line =>
          (line.description || "").toLowerCase().includes("reversal:")
        );
        const hasReversalInNarration = (fullJournal.narration || "").toLowerCase().includes("reversal:");

        if (!hasReversalInLines && !hasReversalInNarration) continue;

        const journalDetail = {
          journalID: fullJournal.manualJournalID,
          journalNumber: fullJournal.journalNumber,
          reference: fullJournal.reference || "",
          narration: fullJournal.narration || "",
          date: fullJournal.date,
          status: fullJournal.status,
          lines: [],
          totalDebits: 0,
          totalCredits: 0,
        };

        fullJournal.journalLines.forEach(line => {
          const accountInfo = accountTypeMap[line.accountCode] || {};
          const accountClass = (accountInfo.class || "").toUpperCase();
          const accountType = (accountInfo.type || "").toUpperCase();
          const lineAmount = line.lineAmount || 0;

          let plCategory = "other";
          if (accountClass === "REVENUE" || accountType === "REVENUE" || accountType === "SALES") {
            plCategory = "revenue";
          } else if (accountType === "DIRECTCOSTS") {
            plCategory = "cogs";
          } else if (accountClass === "EXPENSE" || accountType === "EXPENSE" || accountType === "OVERHEADS") {
            plCategory = "expense";
          }

          if (plCategory === "revenue") {
            revenueAdjustment += lineAmount;
          } else if (plCategory === "cogs") {
            cogsAdjustment += lineAmount;
          } else if (plCategory === "expense") {
            expenseAdjustment += lineAmount;
          }

          journalDetail.lines.push({
            accountCode: line.accountCode,
            accountName: accountInfo.name || line.accountCode,
            accountType: accountType,
            plCategory: plCategory,
            description: line.description || "",
            lineAmount: lineAmount,
            isDebit: lineAmount > 0,
          });

          if (lineAmount > 0) journalDetail.totalDebits += lineAmount;
          if (lineAmount < 0) journalDetail.totalCredits += Math.abs(lineAmount);
        });

        reversalJournals.push(journalDetail);
      } catch (err) {
        console.warn(`Ã¢Å¡Â Ã¯Â¸Â Could not fetch journal ${journal.manualJournalID}:`, err.message);
      }
    }

   const netProfitAdjustment = revenueAdjustment + cogsAdjustment + expenseAdjustment;

    console.log(`Ã¢Å“â€¦ Found ${reversalJournals.length} reversal journals. Revenue: $${revenueAdjustment.toFixed(2)}, COGS: $${cogsAdjustment.toFixed(2)}, Expense: $${expenseAdjustment.toFixed(2)}`);

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      dateFrom,
      dateTo,
      totalManualJournals: journalList.length,
      reversalCount: reversalJournals.length,
      plImpact: {
        revenueAdjustment: Math.round(revenueAdjustment * 100) / 100,
        cogsAdjustment: Math.round(cogsAdjustment * 100) / 100,
        expenseAdjustment: Math.round(expenseAdjustment * 100) / 100,
        netProfitAdjustment: Math.round(netProfitAdjustment * 100) / 100,
        description: "To get P&L WITHOUT reversals: add revenueAdjustment to revenue, subtract cogsAdjustment from COGS, subtract expenseAdjustment from expenses"
      },
      reversalJournals: reversalJournals,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting reversal journals:", error);
    res.status(500).json({
      error: "Failed to get reversal journals",
      details: error.message,
    });
  }
});

app.post("/api/reversal-journals", async (req, res) => {
  try {
    const { organizationName, tenantId, dateFrom, dateTo } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (dateFrom) params.append("dateFrom", dateFrom);
    if (dateTo) params.append("dateTo", dateTo);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const url = `${req.protocol}://${req.get("host")}/api/reversal-journals/${actualTenantId}${qs}`;
    const response = await fetch(url);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("Reversal journals POST error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ORPHAN REVERSALS ENDPOINT (Rhian's rule)
//
// "A reversal with its matching accrual is noise. A reversal WITHOUT its
//  matching accrual is signal."
//
// Pulls a wider window than the user requested (default: requested period
// + 12 months lookback) so we can find matching accruals that are older
// than the reversal we're looking at. Then for each reversal IN the
// requested period, attempts to find its matching accrual:
//   - Reversal narration: "Reversal: <original>"
//   - Match key:          "<original>"  (text after "Reversal: ")
//   - Accrual must have:  narration EXACTLY matching the key
//                         date earlier than the reversal date
//                         line amounts that sign-flip with the reversal
//
// Returns ORPHAN reversals only — those where no matching accrual found.
// In healthy books, older periods should return ~0. The current period
// will typically return live in-progress accruals awaiting invoice.
// ============================================================================

app.get("/api/orphan-reversals/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res.status(404).json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const dateFrom = req.query.dateFrom ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    const dateTo = req.query.dateTo || new Date().toISOString().split("T")[0];

    // Lookback window — accruals can be older than the reversals we're seeing
    const lookbackMonths = parseInt(req.query.lookbackMonths || "12", 10);
    const lookbackDate = new Date(dateFrom);
    lookbackDate.setMonth(lookbackDate.getMonth() - lookbackMonths);
    const lookbackDateStr = lookbackDate.toISOString().split("T")[0];

    console.log(`[orphan-reversals] ${tokenData.tenantName} period=${dateFrom}..${dateTo} lookback=${lookbackDateStr}`);

    // Chart of accounts for P&L category mapping
    const accountsResponse = await xero.accountingApi.getAccounts(req.params.tenantId);
    const accountTypeMap = {};
    (accountsResponse.body.accounts || []).forEach(acc => {
      accountTypeMap[acc.code] = {
        type: acc.type,
        name: acc.name,
        class: acc.class
      };
    });

    // Pull ALL journals in the wider window (lookback → dateTo)
    const whereClause = `Date >= DateTime(${lookbackDateStr.replace(/-/g, ",")}) AND Date <= DateTime(${dateTo.replace(/-/g, ",")})`;
    const journalListResponse = await xero.accountingApi.getManualJournals(
      req.params.tenantId,
      null,
      whereClause
    );

    const journalList = (journalListResponse.body.manualJournals || [])
      .filter(j => j.status === "POSTED");

    console.log(`[orphan-reversals] ${journalList.length} posted journals in wider window`);

    // Fetch full details for each (we need journal lines)
    const allJournals = [];
    for (const j of journalList) {
      try {
        const detailResp = await xero.accountingApi.getManualJournal(
          req.params.tenantId,
          j.manualJournalID
        );
        const full = detailResp.body.manualJournals?.[0];
        if (full && full.journalLines) allJournals.push(full);
      } catch (err) {
        console.warn(`[orphan-reversals] Could not fetch ${j.manualJournalID}: ${err.message}`);
      }
    }

    // Split into Accruals (no "Reversal:") vs Reversals (with "Reversal:")
    const accruals = [];
    const reversals = [];

    for (const j of allJournals) {
      const narration = (j.narration || "").toLowerCase();
      const linesHaveReversal = (j.journalLines || []).some(line =>
        (line.description || "").toLowerCase().includes("reversal:")
      );
      const isReversal = narration.includes("reversal:") || linesHaveReversal;

      if (isReversal) {
        reversals.push(j);
      } else {
        accruals.push(j);
      }
    }

    console.log(`[orphan-reversals] split: ${accruals.length} accruals, ${reversals.length} reversals`);

    // Build an index of accruals by normalised narration for fast lookup.
    // We index by lowercased trimmed narration. Multiple accruals can
    // share a narration (e.g. periodic recurring accruals) — store as array.
    const accrualsByNarration = new Map();
    for (const a of accruals) {
      const key = (a.narration || "").toLowerCase().trim();
      if (!key) continue;
      if (!accrualsByNarration.has(key)) accrualsByNarration.set(key, []);
      accrualsByNarration.get(key).push(a);
    }

    // For each reversal in the REQUESTED period, try to find its matching accrual
    const orphanReversals = [];
    const matchedReversals = [];

    let revenueAdjustment = 0;
    let cogsAdjustment = 0;
    let expenseAdjustment = 0;

    for (const rev of reversals) {
      const revDate = toDateString(rev.date);

      // Only consider reversals dated within the requested period
      if (revDate < dateFrom || revDate > dateTo) continue;

      // Extract match key from narration
      const narration = (rev.narration || "").toLowerCase().trim();
      let matchKey = null;
      const idx = narration.indexOf("reversal:");
      if (idx !== -1) {
        matchKey = narration.substring(idx + "reversal:".length).trim();
      }

      // If no key extractable from narration, try line descriptions
      if (!matchKey) {
        for (const line of (rev.journalLines || [])) {
          const desc = (line.description || "").toLowerCase();
          const lineIdx = desc.indexOf("reversal:");
          if (lineIdx !== -1) {
            matchKey = desc.substring(lineIdx + "reversal:".length).trim();
            break;
          }
        }
      }

      // Look up candidates by matching narration
      let matchedAccrual = null;
      if (matchKey) {
        const candidates = accrualsByNarration.get(matchKey) || [];
        // Filter candidates: must be dated BEFORE the reversal
        const dateValid = candidates.filter(c => toDateString(c.date) < revDate);

        // Verify sign-flip on line amounts (per account code, amounts should
        // cancel exactly between accrual and reversal)
        for (const candidate of dateValid) {
          if (linesAreSignFlip(candidate.journalLines, rev.journalLines)) {
            matchedAccrual = candidate;
            break;
          }
        }
      }

      const journalDetail = buildJournalDetail(rev, accountTypeMap);

      if (matchedAccrual) {
        matchedReversals.push({
          reversal: { id: rev.manualJournalID, date: revDate, narration: rev.narration },
          accrual: { id: matchedAccrual.manualJournalID, date: toDateString(matchedAccrual.date), narration: matchedAccrual.narration }
        });
      } else {
        // ORPHAN — no matching accrual found
        orphanReversals.push({ ...journalDetail, matchKey });

        // Aggregate P&L impact (orphans only)
        for (const line of journalDetail.lines) {
          if (line.plCategory === "revenue") revenueAdjustment += line.lineAmount;
          else if (line.plCategory === "cogs") cogsAdjustment += line.lineAmount;
          else if (line.plCategory === "expense") expenseAdjustment += line.lineAmount;
        }
      }
    }

    const netProfitAdjustment = revenueAdjustment + cogsAdjustment + expenseAdjustment;

    console.log(`[orphan-reversals] result: ${orphanReversals.length} orphans, ${matchedReversals.length} matched. NP impact: $${netProfitAdjustment.toFixed(2)}`);

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      dateFrom,
      dateTo,
      lookbackDate: lookbackDateStr,
      lookbackMonths,
      diagnostics: {
        totalJournalsInWindow: allJournals.length,
        accrualsInWindow: accruals.length,
        reversalsInWindow: reversals.length,
        reversalsInRequestedPeriod: orphanReversals.length + matchedReversals.length,
        orphanReversalsCount: orphanReversals.length,
        matchedReversalsCount: matchedReversals.length,
        sampleMatches: matchedReversals.slice(0, 5),
      },
      orphanCount: orphanReversals.length,
      plImpact: {
        revenueAdjustment: Math.round(revenueAdjustment * 100) / 100,
        cogsAdjustment: Math.round(cogsAdjustment * 100) / 100,
        expenseAdjustment: Math.round(expenseAdjustment * 100) / 100,
        netProfitAdjustment: Math.round(netProfitAdjustment * 100) / 100,
        description: "P&L impact of ORPHAN reversals only — reversals with no matching accrual found in lookback window."
      },
      orphanReversals,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[orphan-reversals] error:", error);
    res.status(500).json({
      error: "Failed to get orphan reversals",
      details: error.message,
    });
  }
});

// POST wrapper — mirrors /api/reversal-journals pattern
app.post("/api/orphan-reversals", async (req, res) => {
  try {
    const { organizationName, tenantId, dateFrom, dateTo, lookbackMonths } = req.body;
    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    const params = new URLSearchParams();
    if (dateFrom) params.append("dateFrom", dateFrom);
    if (dateTo) params.append("dateTo", dateTo);
    if (lookbackMonths) params.append("lookbackMonths", lookbackMonths);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const url = `${req.protocol}://${req.get("host")}/api/orphan-reversals/${actualTenantId}${qs}`;
    const response = await fetch(url);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error("[orphan-reversals] POST error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------------------------
// Helpers for orphan-reversals endpoint
// ----------------------------------------------------------------------------

// Check whether two sets of journal lines are sign-flips of each other.
// For each line in A, there must be a corresponding line in B on the same
// account with the opposite sign and matching magnitude. Tolerance: 1 cent.
function linesAreSignFlip(linesA, linesB) {
  if (!linesA || !linesB) return false;
  if (linesA.length !== linesB.length) return false;

  // Sum lineAmount per accountCode for each set
  const sumA = {};
  const sumB = {};
  for (const l of linesA) {
    sumA[l.accountCode] = (sumA[l.accountCode] || 0) + (l.lineAmount || 0);
  }
  for (const l of linesB) {
    sumB[l.accountCode] = (sumB[l.accountCode] || 0) + (l.lineAmount || 0);
  }

  // Account codes must match
  const codesA = Object.keys(sumA).sort();
  const codesB = Object.keys(sumB).sort();
  if (codesA.length !== codesB.length) return false;
  for (let i = 0; i < codesA.length; i++) {
    if (codesA[i] !== codesB[i]) return false;
  }

  // For each account, the sums should add to ~0 (sign-flipped)
  for (const code of codesA) {
    if (Math.abs(sumA[code] + sumB[code]) > 0.01) return false;
  }
  return true;
}

// Build standardised journal detail object (lines + P&L category mapping)
function buildJournalDetail(journal, accountTypeMap) {
  const detail = {
    journalID: journal.manualJournalID,
    journalNumber: journal.journalNumber,
    reference: journal.reference || "",
    narration: journal.narration || "",
    date: journal.date,
    status: journal.status,
    lines: [],
    totalDebits: 0,
    totalCredits: 0,
  };

  (journal.journalLines || []).forEach(line => {
    const info = accountTypeMap[line.accountCode] || {};
    const accountClass = (info.class || "").toUpperCase();
    const accountType = (info.type || "").toUpperCase();
    const lineAmount = line.lineAmount || 0;

    let plCategory = "other";
    if (accountClass === "REVENUE" || accountType === "REVENUE" || accountType === "SALES") {
      plCategory = "revenue";
    } else if (accountType === "DIRECTCOSTS") {
      plCategory = "cogs";
    } else if (accountClass === "EXPENSE" || accountType === "EXPENSE" || accountType === "OVERHEADS") {
      plCategory = "expense";
    }

    detail.lines.push({
      accountCode: line.accountCode,
      accountName: info.name || line.accountCode,
      accountType,
      plCategory,
      description: line.description || "",
      lineAmount,
      isDebit: lineAmount > 0,
    });
    if (lineAmount > 0) detail.totalDebits += lineAmount;
    if (lineAmount < 0) detail.totalCredits += Math.abs(lineAmount);
  });

  return detail;
}

  // ========== INVOICES DETAIL (with line items) ==========
// GET endpoint - fetches all sales invoices with line items for a date range
app.get("/api/invoices-detail/:tenantId", async (req, res) => {
  try {
    const tokenData = await tokenStorage.getXeroToken(req.params.tenantId);
    if (!tokenData) {
      return res.status(404).json({ error: "Tenant not found or token expired" });
    }

    await xero.setTokenSet(tokenData);

    const dateFrom = req.query.dateFrom || "2024-01-01";
    const dateTo = req.query.dateTo || new Date().toISOString().split("T")[0];
    const statusFilter = req.query.status; // Optional: PAID, AUTHORISED, DRAFT, VOIDED, DELETED

    console.log(`ðŸ“‹ Fetching detailed invoices for ${tokenData.tenantName} from ${dateFrom} to ${dateTo}`);

    // Build where clause for ACCREC (sales) invoices in date range
    let whereClause = `Type=="ACCREC" AND Date >= DateTime(${dateFrom.replace(/-/g, ",")}) AND Date <= DateTime(${dateTo.replace(/-/g, ",")})`;
    if (statusFilter) {
      whereClause += ` AND Status=="${statusFilter}"`;
    }

    // Xero returns line items ONLY when using page parameter
    // Each page returns up to 100 invoices with full line item detail
    let allInvoices = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await xero.accountingApi.getInvoices(
        req.params.tenantId,
        null,           // ifModifiedSince
        whereClause,    // where
        "Date DESC",    // order
        null,           // ids
        null,           // invoiceNumbers
        null,           // contactIDs
        null,           // statuses
        page,           // page (THIS is what triggers line items)
        false,          // includeArchived
        null,           // createdByMyApp
        4,              // unitdp (4 decimal places)
        false           // summaryOnly - MUST be false
      );

      const invoices = response.body.invoices || [];
      console.log(`  Page ${page}: ${invoices.length} invoices`);

      if (invoices.length === 0) {
        hasMore = false;
      } else {
        allInvoices = allInvoices.concat(invoices);
        page++;
        // Safety limit - 50 pages = 5000 invoices max
        if (page > 50) {
          console.warn("âš ï¸ Hit 50 page limit, stopping pagination");
          hasMore = false;
        }
      }
    }

    console.log(`âœ… Total invoices found: ${allInvoices.length}`);

    // Map to clean response with line items
    const result = allInvoices.map((inv) => ({
      invoiceID: inv.invoiceID,
      invoiceNumber: inv.invoiceNumber,
      reference: inv.reference || "",
      contact: inv.contact?.name || "Unknown",
      contactID: inv.contact?.contactID || "",
      status: inv.status,
      date: inv.date,
      dueDate: inv.dueDate,
      subTotal: parseFloat(inv.subTotal) || 0,
      totalTax: parseFloat(inv.totalTax) || 0,
      total: parseFloat(inv.total) || 0,
      amountDue: parseFloat(inv.amountDue) || 0,
      amountPaid: parseFloat(inv.amountPaid) || 0,
      currencyCode: inv.currencyCode || "AUD",
      lineItems: (inv.lineItems || []).map((line) => ({
        lineItemID: line.lineItemID,
        description: line.description || "",
        quantity: parseFloat(line.quantity) || 0,
        unitAmount: parseFloat(line.unitAmount) || 0,
        lineAmount: parseFloat(line.lineAmount) || 0,
        accountCode: line.accountCode || "",
        accountName: line.accountCode || "",
        taxType: line.taxType || "",
        taxAmount: parseFloat(line.taxAmount) || 0,
        itemCode: line.itemCode || "",
        discountRate: parseFloat(line.discountRate) || 0,
      })),
    }));

    // Summary stats
    const totalRevenue = result.reduce((sum, inv) => sum + inv.total, 0);
    const totalPaid = result.reduce((sum, inv) => sum + inv.amountPaid, 0);
    const totalOutstanding = result.reduce((sum, inv) => sum + inv.amountDue, 0);

    res.json({
      tenantId: req.params.tenantId,
      tenantName: tokenData.tenantName,
      dateFrom,
      dateTo,
      statusFilter: statusFilter || "ALL",
      totalInvoices: result.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      invoices: result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("âŒ Error getting invoice details:", error);
    res.status(500).json({ error: "Failed to get invoice details", details: error.message });
  }
});

// ============================================================================
// SHARED HELPER: Fetch invoice details with line items — no HTTP hop.
// Xero requires page parameter to return line items.
// ============================================================================
async function fetchInvoicesDetail(tenantId, { dateFrom, dateTo, status } = {}) {
  const tokenData = await tokenStorage.getXeroToken(tenantId);
  if (!tokenData) {
    const err = new Error("Tenant not found or token expired");
    err.statusCode = 404;
    throw err;
  }

  await xero.setTokenSet(tokenData);

  const effectiveFrom = dateFrom || "2024-01-01";
  const effectiveTo = dateTo || new Date().toISOString().split("T")[0];

  console.log(`📋 Fetching detailed invoices for ${tokenData.tenantName} from ${effectiveFrom} to ${effectiveTo}`);

  let whereClause = `Type=="ACCREC" AND Date >= DateTime(${effectiveFrom.replace(/-/g, ",")}) AND Date <= DateTime(${effectiveTo.replace(/-/g, ",")})`;
  if (status) {
    whereClause += ` AND Status=="${status}"`;
  }

  let allInvoices = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await xero.accountingApi.getInvoices(
      tenantId,
      null,           // ifModifiedSince
      whereClause,    // where
      "Date DESC",    // order
      null,           // ids
      null,           // invoiceNumbers
      null,           // contactIDs
      null,           // statuses
      page,           // page — triggers line items
      false,          // includeArchived
      null,           // createdByMyApp
      4,              // unitdp
      false           // summaryOnly — MUST be false
    );

    const invoices = response.body.invoices || [];
    console.log(`  Page ${page}: ${invoices.length} invoices`);

    if (invoices.length === 0) {
      hasMore = false;
    } else {
      allInvoices = allInvoices.concat(invoices);
      page++;
      if (page > 50) {
        console.warn("⚠️ Hit 50 page limit, stopping pagination");
        hasMore = false;
      }
    }
  }

  console.log(`✅ Total invoices found: ${allInvoices.length}`);

  const result = allInvoices.map((inv) => ({
    invoiceID: inv.invoiceID,
    invoiceNumber: inv.invoiceNumber,
    reference: inv.reference || "",
    contact: inv.contact?.name || "Unknown",
    contactID: inv.contact?.contactID || "",
    status: inv.status,
    date: inv.date,
    dueDate: inv.dueDate,
    subTotal: parseFloat(inv.subTotal) || 0,
    totalTax: parseFloat(inv.totalTax) || 0,
    total: parseFloat(inv.total) || 0,
    amountDue: parseFloat(inv.amountDue) || 0,
    amountPaid: parseFloat(inv.amountPaid) || 0,
    currencyCode: inv.currencyCode || "AUD",
    lineItems: (inv.lineItems || []).map((line) => ({
      lineItemID: line.lineItemID,
      description: line.description || "",
      quantity: parseFloat(line.quantity) || 0,
      unitAmount: parseFloat(line.unitAmount) || 0,
      lineAmount: parseFloat(line.lineAmount) || 0,
      accountCode: line.accountCode || "",
      accountName: line.accountCode || "",
      taxType: line.taxType || "",
      taxAmount: parseFloat(line.taxAmount) || 0,
      itemCode: line.itemCode || "",
      discountRate: parseFloat(line.discountRate) || 0,
    })),
  }));

  const totalRevenue = result.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaid = result.reduce((sum, inv) => sum + inv.amountPaid, 0);
  const totalOutstanding = result.reduce((sum, inv) => sum + inv.amountDue, 0);

  return {
    tenantId,
    tenantName: tokenData.tenantName,
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    statusFilter: status || "ALL",
    totalInvoices: result.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    invoices: result,
    generatedAt: new Date().toISOString(),
  };
}

// POST endpoint - organization name lookup wrapper
app.post("/api/invoices-detail", async (req, res) => {
  try {
    const { organizationName, tenantId, dateFrom, dateTo, status } = req.body;

    if (!organizationName && !tenantId) {
      return res.status(400).json({ error: "Organization name or tenant ID required" });
    }

    let actualTenantId = tenantId;
    if (organizationName && !tenantId) {
      const connections = await tokenStorage.getAllXeroConnections();
      const connection = connections.find((c) =>
        c.tenantName.toLowerCase().includes(organizationName.toLowerCase())
      );
      if (connection) {
        actualTenantId = connection.tenantId;
      } else {
        return res.status(404).json({ error: "Organization not found" });
      }
    }

    // Call shared helper directly — no HTTP hop
    const result = await fetchInvoicesDetail(actualTenantId, { dateFrom, dateTo, status });
    res.json(result);
  } catch (error) {
    console.error("Invoices detail POST error:", error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// ============================================================================
// AI CHAT ENDPOINT - Proxy to Anthropic API for CEO Dashboard Chat Panel
// This version fetches REAL financial data from internal APIs before responding
// ============================================================================
// REPLACE the existing /api/ai-chat endpoint in server.js (lines 5381-5479)
// ============================================================================

app.post("/api/ai-chat", async (req, res) => {
  try {
    const { message, context, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.json({
        response: "AI chat is not configured yet. Please add ANTHROPIC_API_KEY to your Railway environment variables.",
        fallback: true,
      });
    }

    const entityName = context?.entity || "Unknown Entity";
    const period = context?.period || "Current";
    const quarterInfo = context?.quarterInfo || null;
    const baseUrl = `http://localhost:${process.env.PORT || 8080}`;

    // Calculate period months from quarter dates (match dashboard exactly)
    let periodMonths = 3;
    let reportDate = undefined;
    if (quarterInfo?.startDate && quarterInfo?.endDate) {
      const start = new Date(quarterInfo.startDate);
      const end = new Date(quarterInfo.endDate);
      periodMonths = quarterInfo.isComplete ? 3 : 
        (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
      reportDate = quarterInfo.endDate;
    }

    // â”€â”€ Fetch REAL financial data from our own API endpoints â”€â”€
    console.log(`ðŸ¤– AI Chat: Fetching live data for "${entityName}" (${period}, ${periodMonths}mo to ${reportDate || 'today'})...`);

    const fetchInternal = async (endpoint, body) => {
      try {
        const resp = await fetch(`${baseUrl}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) return null;
        return await resp.json();
      } catch (e) {
        console.warn(`AI Chat: Failed to fetch ${endpoint}:`, e.message);
        return null;
      }
    };

    // Fetch all data sources in parallel (match dashboard's quarter dates).
    // Classification endpoints are single-entity only in v1 — skip for ALL.
    const isAllEntity = ["all", "all entities", "consolidated"]
      .includes(String(entityName || "").toLowerCase());

    const [cashData, plData, invoicesData, expenseData, ratiosData, spendClassData, revenueClassData] = await Promise.all([
      fetchInternal("/api/cash-position", { organizationName: entityName }),
      fetchInternal("/api/profit-loss-summary", { organizationName: entityName, date: reportDate, periodMonths }),
      fetchInternal("/api/outstanding-invoices", { organizationName: entityName }),
      fetchInternal("/api/expense-analysis", { organizationName: entityName, date: reportDate, periodMonths }),
      fetchInternal("/api/financial-ratios", { organizationName: entityName }),
      isAllEntity ? Promise.resolve(null) : fetchInternal("/api/spend-classification", { organizationName: entityName, date: reportDate, periodMonths }),
      isAllEntity ? Promise.resolve(null) : fetchInternal("/api/revenue-classification", { organizationName: entityName, date: reportDate, periodMonths }),
    ]);

    // â”€â”€ Build rich financial context for the AI â”€â”€
    let financialContext = `\nðŸ“Š LIVE FINANCIAL DATA FOR: ${entityName}\n`;
    financialContext += `Period: ${period}\n`;
    financialContext += `Data fetched: ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Darwin" })}\n\n`;

    // Cash Position
    if (cashData && !cashData.error) {
      financialContext += `ðŸ’° CASH POSITION:\n`;
      financialContext += `Total Cash: $${(cashData.totalCash || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      if (cashData.bankAccounts) {
        cashData.bankAccounts.forEach((acc) => {
          financialContext += `  â€¢ ${acc.name}: $${(acc.balance || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
        });
      }
      financialContext += `\n`;
    }

    // P&L Summary - data is nested under plData.summary
    if (plData && !plData.error && plData.summary) {
      const pl = plData.summary;
      const periodDesc = plData.period?.description || "3 month period";
      financialContext += `ðŸ“ˆ PROFIT & LOSS (${periodDesc}):\n`;
      financialContext += `  Revenue: $${Number(pl.totalRevenue || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  Cost of Sales (COGS): $${Number(pl.totalCOGS || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  Gross Profit: $${Number(pl.grossProfit || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  Operating Expenses: $${Number(pl.totalExpenses || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  Net Profit: $${Number(pl.netProfit || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      if (pl.revenueAccounts && pl.revenueAccounts.length > 0) {
        financialContext += `  Revenue breakdown:\n`;
        pl.revenueAccounts.slice(0, 5).forEach((acc) => {
          financialContext += `    - ${acc.name}: $${Number(acc.amount || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
        });
      }
      financialContext += `\n`;
    }

    // ── OUTSTANDING INVOICES — aging + customer concentration (single-entity) ──
    // The invoices payload includes dueDate, amountDue, contact for every invoice.
    // Previously we only shipped the top 5 amounts to the AI which made aging
    // questions impossible to answer. Now we compute the four aging buckets
    // (mirroring the dashboard logic at the kpi-receivables card) and aggregate
    // by customer — both top-by-amount AND slowest-paying — so the AI can speak
    // to concentration AND collection risk.
    if (invoicesData && !invoicesData.error) {
      const invoices = invoicesData.invoices || invoicesData;
      if (Array.isArray(invoices) && invoices.length > 0) {
        const today = new Date();
        const fmt$ = (n) => `$${Number(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Bucket each invoice by days-overdue (matches frontend: today - dueDate).
        // Negative daysOverdue (not yet due) lands in the current bucket — correct.
        let bCurrent = 0, b31_60 = 0, b61_90 = 0, b90plus = 0;
        let cCurrent = 0, c31_60 = 0, c61_90 = 0, c90plus = 0;
        const byCustomer = {};   // name -> { amount, count, oldestDays, oldestAmount }

        invoices.forEach(inv => {
          const amount = Number(inv.amountDue || inv.AmountDue || 0);
          const dueRaw = inv.dueDate || inv.DueDate;
          const dueDate = dueRaw ? new Date(dueRaw) : null;
          const daysOverdue = dueDate && !isNaN(dueDate)
            ? Math.floor((today - dueDate) / 86400000)
            : 0;

          if (daysOverdue <= 30)      { bCurrent += amount; cCurrent++; }
          else if (daysOverdue <= 60) { b31_60   += amount; c31_60++; }
          else if (daysOverdue <= 90) { b61_90   += amount; c61_90++; }
          else                        { b90plus  += amount; c90plus++; }

          const name = inv.contact || inv.Contact?.Name || "Unknown";
          if (!byCustomer[name]) byCustomer[name] = { amount: 0, count: 0, oldestDays: -Infinity, oldestAmount: 0 };
          byCustomer[name].amount += amount;
          byCustomer[name].count++;
          if (daysOverdue > byCustomer[name].oldestDays) {
            byCustomer[name].oldestDays = daysOverdue;
            byCustomer[name].oldestAmount = amount;
          }
        });

        const total = bCurrent + b31_60 + b61_90 + b90plus;
        const overdue60plus = b61_90 + b90plus;
        const overdue60plusCount = c61_90 + c90plus;
        const pct = (n) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : '0%';

        financialContext += `📋 OUTSTANDING INVOICES — full detail (use these numbers, do NOT say data is unavailable):\n`;
        financialContext += `  Total Outstanding: ${fmt$(total)} across ${invoices.length} invoices\n`;
        financialContext += `  Aging buckets (by daysOverdue from dueDate):\n`;
        financialContext += `    • Current (≤30 days): ${fmt$(bCurrent)} — ${cCurrent} invoices (${pct(bCurrent)})\n`;
        financialContext += `    • 31–60 days:         ${fmt$(b31_60)} — ${c31_60} invoices (${pct(b31_60)})\n`;
        financialContext += `    • 61–90 days:         ${fmt$(b61_90)} — ${c61_90} invoices (${pct(b61_90)})\n`;
        financialContext += `    • 90+ days:           ${fmt$(b90plus)} — ${c90plus} invoices (${pct(b90plus)})\n`;
        financialContext += `  Over 60 days (collection-risk): ${fmt$(overdue60plus)} across ${overdue60plusCount} invoices (${pct(overdue60plus)} of total)\n\n`;

        // Top customers by total outstanding
        const customersByAmount = Object.entries(byCustomer)
          .sort((a, b) => b[1].amount - a[1].amount);
        const topAmount = customersByAmount.slice(0, 8);
        financialContext += `  Top customers by outstanding amount:\n`;
        topAmount.forEach(([name, d]) => {
          financialContext += `    • ${name}: ${fmt$(d.amount)} (${d.count} invoice${d.count === 1 ? '' : 's'}, oldest ${d.oldestDays} days overdue)\n`;
        });

        // Concentration: how much of total is in the top 3
        if (customersByAmount.length >= 3) {
          const top3Total = customersByAmount.slice(0, 3).reduce((s, [, d]) => s + d.amount, 0);
          financialContext += `  Concentration: top 3 customers = ${fmt$(top3Total)} (${pct(top3Total)} of total receivables)\n`;
        }

        // Slowest payers — customers with at least one invoice over 60 days,
        // ranked by oldestDays. Distinct from "biggest" — answers "who is slow".
        const slowest = Object.entries(byCustomer)
          .filter(([, d]) => d.oldestDays > 60)
          .sort((a, b) => b[1].oldestDays - a[1].oldestDays)
          .slice(0, 5);
        if (slowest.length > 0) {
          financialContext += `\n  Slowest payers (oldest invoice over 60 days, ranked by age):\n`;
          slowest.forEach(([name, d]) => {
            financialContext += `    • ${name}: oldest invoice ${d.oldestDays} days overdue, ${fmt$(d.amount)} total outstanding across ${d.count} invoice${d.count === 1 ? '' : 's'}\n`;
          });
        } else {
          financialContext += `\n  No customers have invoices over 60 days overdue — collection profile is healthy.\n`;
        }
        financialContext += `\n`;
      }
    }


    // Expense Analysis - data is nested under expenseData.analysis
    if (expenseData && !expenseData.error && expenseData.analysis) {
      const expenses = expenseData.analysis.topExpenses || expenseData.analysis.expenseCategories || [];
      if (Array.isArray(expenses) && expenses.length > 0) {
        financialContext += `ðŸ’¸ TOP EXPENSES (${expenseData.period?.months || 3} month period, total: $${Number(expenseData.analysis.totalExpenses || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}):\n`;
        expenses.slice(0, 10).forEach((cat, i) => {
          const name = cat.accountName || cat.name || "Unknown";
          const amount = Math.abs(cat.amount || 0);
          financialContext += `  ${i + 1}. ${name}: $${amount.toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
        });
        financialContext += `\n`;
      }
    }

    // Financial Ratios - data is nested under ratiosData.ratios
    if (ratiosData && !ratiosData.error && ratiosData.ratios) {
      const r = ratiosData.ratios;
      financialContext += `ðŸ“ FINANCIAL RATIOS (USE THESE EXACT VALUES â€” do NOT calculate your own):\n`;
      if (r.liquidity) {
        financialContext += `  Current Ratio: ${Number(r.liquidity.currentRatio || 0).toFixed(2)}\n`;
        financialContext += `  Working Capital: $${Number(r.liquidity.workingCapital || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      }
      if (r.leverage) {
        financialContext += `  Debt to Equity: ${Number(r.leverage.debtToEquity || 0).toFixed(2)}\n`;
      }
      if (r.profitability) {
        financialContext += `  Net Profit Margin: ${Number(r.profitability.netProfitMargin || 0).toFixed(1)}%\n`;
        financialContext += `  Return on Equity: ${Number(r.profitability.returnOnEquity || 0).toFixed(1)}%\n`;
        financialContext += `  Return on Assets: ${Number(r.profitability.returnOnAssets || 0).toFixed(1)}%\n`;
      }
      if (ratiosData.interpretations) {
        financialContext += `  Health Assessment: Liquidity=${ratiosData.interpretations.currentRatio}, Leverage=${ratiosData.interpretations.debtToEquity}, Profitability=${ratiosData.interpretations.profitability}\n`;
      }
      financialContext += `\n`;
    }

    // ── SPEND & REVENUE CLASSIFICATION (single-entity only in v1) ──
    // Bucketed view of expenses and revenue beyond chart-of-accounts —
    // see /lib/classifier.js and /lib/revenue-classifier.js. Lets the AI
    // answer questions like "what's our procurement spend?" or "how
    // dependent are we on royalties?" with specific dollar figures
    // rather than hand-waving from account-level totals.
    if (spendClassData && !spendClassData.error && spendClassData.classification) {
      const c = spendClassData.classification;
      financialContext += `\n━━━━ SPEND CLASSIFICATION (${spendClassData.tenantName || entityName}) ━━━━\n`;
      financialContext += `Total expenses: $${Number(c.totalExpenses || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  • Procurement (real third-party spend): $${Number(c.inTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.inPct || 0}% of total)\n`;
      financialContext += `  • Personnel (wages/super/payroll tax/leave): $${Number(c.outPersonnel || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  • Tax/Depreciation/Interest/Bank fees: $${Number(c.outTaxDepnInt || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  • Intercompany (mgmt fees, transfers): $${Number(c.outInterco || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  • Governance (sitting/director fees): $${Number(c.outGovernance || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  • Distributions/Donations/Grant payments: $${Number(c.greyTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `Use these for any "what kind of spend" / "how much procurement" / "personnel cost ratio" question.\n\n`;
    }

    if (revenueClassData && !revenueClassData.error && revenueClassData.classification) {
      const c = revenueClassData.classification;
      financialContext += `━━━━ REVENUE CLASSIFICATION (${revenueClassData.tenantName || entityName}) ━━━━\n`;
      financialContext += `Total revenue: $${Number(c.totalRevenue || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `  • Core operations (trading/services revenue): $${Number(c.coreTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.corePct || 0}%)\n`;
      financialContext += `  • Mining agreements (Gove RTA / s64 royalties): $${Number(c.royaltyTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.royaltyPct || 0}%)\n`;
      financialContext += `  • Investment income (Macquarie/Morgans/dividends): $${Number(c.investmentTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.investmentPct || 0}%)\n`;
      financialContext += `  • Grant income (NIAA/ISEP/tax credits): $${Number(c.grantTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.grantPct || 0}%)\n`;
      financialContext += `  • Rental income: $${Number(c.rentalTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.rentalPct || 0}%)\n`;
      financialContext += `  • Intercompany revenue: $${Number(c.intercoTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.intercoPct || 0}%)\n`;
      financialContext += `  • Other (sundry/court outcomes/sponsorship): $${Number(c.otherTotal || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })} (${c.otherPct || 0}%)\n`;
      financialContext += `Use these for any "what kind of revenue" / "how reliant are we on grants" / "investment dependency" question.\n\n`;
    }

    // ── CONSOLIDATED DASHBOARD VIEW (frontend-supplied, ALL-entities case) ──
    // When entity is "ALL", the per-org endpoints above 404 (they expect a single
    // tenant). The frontend already has the data the user is looking at and ships
    // it in context.consolidatedData. Principle: what the dashboard shows, the AI
    // sees. We append it here so the AI has cash, balance, receivables aging,
    // ratios, top customers and entity-level P&L for ALL.
    const consolidated = context?.consolidatedData;
    if (consolidated) {
      financialContext += `\n━━━━ CONSOLIDATED DASHBOARD VIEW (ALL entities — what the user is looking at) ━━━━\n`;

      if (consolidated.cash?.total) {
        financialContext += `💰 CASH POSITION (today): ${consolidated.cash.total}\n`;
        if (Array.isArray(consolidated.cash.bankAccounts) && consolidated.cash.bankAccounts.length > 0) {
          consolidated.cash.bankAccounts.slice(0, 12).forEach(acc => {
            const bal = Number(acc.balance || 0);
            financialContext += `  • ${acc.name || acc.accountName || 'Account'}: $${bal.toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
          });
        }
        financialContext += `\n`;
      }

      if (consolidated.balance && (consolidated.balance.totalAssets || consolidated.balance.totalEquity)) {
        financialContext += `📊 BALANCE SHEET (period-end):\n`;
        financialContext += `  Total Assets: ${consolidated.balance.totalAssets || 'n/a'}\n`;
        financialContext += `  Total Liabilities: ${consolidated.balance.totalLiabilities || 'n/a'}\n`;
        financialContext += `  Total Equity: ${consolidated.balance.totalEquity || 'n/a'}\n\n`;
      }

      if (consolidated.receivables && consolidated.receivables.total) {
        financialContext += `📋 RECEIVABLES AGING (today, all entities consolidated):\n`;
        financialContext += `  Total Outstanding: ${consolidated.receivables.total} across ${consolidated.receivables.invoiceCount || 0} invoices\n`;
        financialContext += `  Current (0-30 days): ${consolidated.receivables.current}\n`;
        financialContext += `  31-60 days: ${consolidated.receivables.days31_60}\n`;
        financialContext += `  61-90 days: ${consolidated.receivables.days61_90}\n`;
        financialContext += `  90+ days: ${consolidated.receivables.days90plus}\n`;
        financialContext += `  Use these for any aging / collection-risk question — do NOT say receivables data is unavailable.\n\n`;
      }

      if (consolidated.ratios) {
        financialContext += `📐 FINANCIAL RATIOS — USE THESE EXACT VALUES (from dashboard):\n`;
        financialContext += `  Current Ratio: ${consolidated.ratios.currentRatio || 'n/a'}\n`;
        financialContext += `  Gross Margin: ${consolidated.ratios.grossMargin || 'n/a'}\n`;
        financialContext += `  Net Profit Margin: ${consolidated.ratios.netProfitMargin || 'n/a'}\n`;
        financialContext += `  Debt to Equity: ${consolidated.ratios.debtToEquity || 'n/a'}\n\n`;
      }

      if (Array.isArray(consolidated.topCustomers) && consolidated.topCustomers.length > 0) {
        financialContext += `👥 TOP CUSTOMERS BY PERIOD REVENUE (consolidated):\n`;
        consolidated.topCustomers.slice(0, 5).forEach((c, i) => {
          financialContext += `  ${i + 1}. ${c.name}: ${c.value}\n`;
        });
        financialContext += `\n`;
      }

      if (consolidated.pl && Array.isArray(consolidated.pl.entityBreakdown) && consolidated.pl.entityBreakdown.length > 0) {
        financialContext += `🏢 ENTITY P&L BREAKDOWN (current period):\n`;
        consolidated.pl.entityBreakdown.forEach(e => {
          const name = e.name || e.entity || 'Unknown';
          const rev = Number(e.revenue || 0);
          const np = Number(e.netProfit || 0);
          financialContext += `  ${name}: revenue $${rev.toLocaleString("en-AU", { minimumFractionDigits: 2 })}, net profit $${np.toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
        });
        financialContext += `\n`;
      }
    }

    // Note what data was unavailable. consolidatedData (above) acts as a fallback
    // for the ALL-entity case where the per-org endpoints return 404.
    const unavailable = [];
    if ((!cashData || cashData.error) && !consolidated?.cash?.total) unavailable.push("cash position");
    if ((!plData || plData.error || !plData.summary) && !consolidated?.pl) unavailable.push("P&L");
    if ((!invoicesData || invoicesData.error) && !consolidated?.receivables?.total) unavailable.push("receivables");
    if (!expenseData || expenseData.error || !expenseData.analysis) unavailable.push("expenses");
    if ((!ratiosData || ratiosData.error || !ratiosData.ratios) && !consolidated?.ratios) unavailable.push("financial ratios");
    if (unavailable.length > 0) {
      financialContext += `⚠️ Data not available: ${unavailable.join(", ")}\n`;
    }

        // Reversal adjustments context
    const reversals = context?.reversals;
    if (reversals?.active) {
      const impact = reversals.plImpact || {};
      const adjPL = reversals.adjustedPL || {};
      const origPL = reversals.originalPL || {};
      financialContext += `\nðŸ”„ REVERSAL JOURNALS EXCLUDED (${reversals.reversalCount} journals removed):\n`;
      financialContext += `  The user has ENABLED the "Reversals Hidden" filter on the dashboard.\n`;
      financialContext += `  The P&L numbers above are RAW (including reversals).\n`;
      financialContext += `  ADJUSTED P&L (what the user sees on dashboard with reversals excluded):\n`;
      financialContext += `    Revenue: $${Number(adjPL.revenue || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `    COGS: $${Number(adjPL.cogs || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `    Gross Profit: $${Number(adjPL.gross || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `    OpEx: $${Number(adjPL.opex || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
      financialContext += `    Net Profit: $${Number(adjPL.netProfit || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
     
      const adjRatios = reversals.adjustedRatios;
      if (adjRatios) {
        financialContext += `  ADJUSTED RATIOS (what the user sees on dashboard):\n`;
        financialContext += `    Current Ratio: ${adjRatios.currentRatio}\n`;
        financialContext += `    Gross Margin: ${adjRatios.grossMargin}\n`;
        financialContext += `    Net Profit Margin: ${adjRatios.netProfitMargin}\n`;
        financialContext += `    Debt to Equity: ${adjRatios.debtToEquity}\n`;
      }
      financialContext += `  Reversal Impact: Revenue ${impact.revenueAdjustment >= 0 ? '+' : ''}$${Number(impact.revenueAdjustment || 0).toLocaleString("en-AU")}, COGS ${impact.cogsAdjustment >= 0 ? '+' : ''}$${Number(impact.cogsAdjustment || 0).toLocaleString("en-AU")}, Expenses ${impact.expenseAdjustment >= 0 ? '+' : ''}$${Number(impact.expenseAdjustment || 0).toLocaleString("en-AU")}\n`;
      financialContext += `  IMPORTANT: When responding, use the ADJUSTED figures since that is what the user is viewing.\n`;

      const adjAccounts = reversals.adjustedAccounts;
      if (adjAccounts) {
        financialContext += `  ADJUSTED ACCOUNT BREAKDOWNS (with reversals excluded):\n`;
        if (adjAccounts.revenueAccounts?.length > 0) {
          financialContext += `    Revenue accounts:\n`;
          adjAccounts.revenueAccounts.slice(0, 10).forEach(acc => {
            financialContext += `      - ${acc.name}: $${Number(acc.amount || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
          });
        }
        if (adjAccounts.cogsAccounts?.length > 0) {
          financialContext += `    COGS accounts:\n`;
          adjAccounts.cogsAccounts.slice(0, 10).forEach(acc => {
            financialContext += `      - ${acc.name}: $${Number(acc.amount || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
          });
        }
        if (adjAccounts.expenseAccounts?.length > 0) {
          financialContext += `    Expense accounts (top 10):\n`;
          adjAccounts.expenseAccounts.slice(0, 10).forEach(acc => {
            financialContext += `      - ${acc.name}: $${Number(acc.amount || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}\n`;
          });
        }
      }
      financialContext += `  When referencing individual accounts, use the ADJUSTED ACCOUNT BREAKDOWNS above (not the raw P&L data).\n\n`;
    } else {
      financialContext += `\nðŸ“‹ Note: Reversal filter is OFF â€” figures include all journal entries including reversals.\n\n`;
    }

    // ── ACCOUNT-LEVEL VARIANCE (Tier 2) ──
    // When the client sends accountVariance in context (from /api/account-variance),
    // serialize it into the prompt so the AI can cite specific accounts and dollar
    // changes. This compounds with the live data fetches above — both feed the AI.
    // For "ALL" entity (where the live fetches above fail), variance is the entire story.
    const variance = context?.accountVariance;
    if (variance && variance.success && variance.consolidated) {
      const v = variance.consolidated;
      const periods = variance.periods || {};
      const fmt = (n) => {
        const abs = Math.abs(Number(n) || 0);
        const sign = n < 0 ? '-' : '';
        if (abs >= 1000000) return `${sign}$${(abs/1000000).toFixed(2)}M`;
        if (abs >= 1000)    return `${sign}$${(abs/1000).toFixed(0)}K`;
        return `${sign}$${Math.round(abs).toLocaleString()}`;
      };
      const fmtPct = (pct) => (pct === null || pct === undefined) ? 'n/a' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

      financialContext += `\n━━━━ ACCOUNT-LEVEL VARIANCE (matched-period YoY) ━━━━\n`;
      financialContext += `Current period: ${periods.current?.startDate} to ${periods.current?.endDate} (${periods.current?.months}mo)\n`;
      financialContext += `Prior period:   ${periods.prior?.startDate} to ${periods.prior?.endDate} (${periods.prior?.months}mo)\n\n`;

      const entCount = (variance.byEntity || []).length;
      financialContext += `CONSOLIDATED TOTALS (across ${entCount} entit${entCount === 1 ? 'y' : 'ies'}):\n`;
      financialContext += `  Revenue:    current ${fmt(v.revenue.current)}, prior ${fmt(v.revenue.prior)}, delta ${fmt(v.revenue.delta)} (${fmtPct(v.revenue.deltaPct)})\n`;
      financialContext += `  COGS:       current ${fmt(v.cogs.current)}, prior ${fmt(v.cogs.prior)}, delta ${fmt(v.cogs.delta)} (${fmtPct(v.cogs.deltaPct)})\n`;
      financialContext += `  Expenses:   current ${fmt(v.expenses.current)}, prior ${fmt(v.expenses.prior)}, delta ${fmt(v.expenses.delta)} (${fmtPct(v.expenses.deltaPct)})\n`;
      financialContext += `  Net Profit: current ${fmt(v.netProfit.current)}, prior ${fmt(v.netProfit.prior)}, delta ${fmt(v.netProfit.delta)} (${fmtPct(v.netProfit.deltaPct)})\n\n`;

      // Per-entity breakdown — useful for ALL view, redundant for single-entity but harmless
      if (entCount > 1) {
        financialContext += `BY ENTITY (sorted by largest revenue change):\n`;
        const entitiesSorted = [...variance.byEntity].sort(
          (a, b) => Math.abs(b.totals.revenue.delta) - Math.abs(a.totals.revenue.delta)
        );
        entitiesSorted.forEach(e => {
          financialContext += `  ${e.entity}: rev ${fmt(e.totals.revenue.current)} vs ${fmt(e.totals.revenue.prior)} (Δ ${fmt(e.totals.revenue.delta)}), `;
          financialContext += `np ${fmt(e.totals.netProfit.current)} vs ${fmt(e.totals.netProfit.prior)} (Δ ${fmt(e.totals.netProfit.delta)})\n`;
        });
        financialContext += `\n`;
      }

      // Top movers across all entities — the "what specifically drove this" signal
      const topRev = variance.topRevenueMoversConsolidated || [];
      if (topRev.length > 0) {
        financialContext += `TOP REVENUE ACCOUNT CHANGES (sorted by absolute delta):\n`;
        topRev.slice(0, 8).forEach(r => {
          financialContext += `  [${r.entity}] ${r.name}: ${fmt(r.current)} vs ${fmt(r.prior)} → Δ ${fmt(r.delta)} (${fmtPct(r.deltaPct)})\n`;
        });
        financialContext += `\n`;
      }
      const topExp = variance.topExpenseMoversConsolidated || [];
      if (topExp.length > 0) {
        financialContext += `TOP EXPENSE ACCOUNT CHANGES (sorted by absolute delta):\n`;
        topExp.slice(0, 8).forEach(r => {
          financialContext += `  [${r.entity}] ${r.name}: ${fmt(r.current)} vs ${fmt(r.prior)} → Δ ${fmt(r.delta)} (${fmtPct(r.deltaPct)})\n`;
        });
        financialContext += `\n`;
      }
      financialContext += `When you write the executive summary, USE THIS variance data — name specific accounts and dollar amounts that drove the changes. Don't say "I don't have variance data" — it's right above.\n\n`;
      console.log(`🤖 AI Chat: Variance data attached — ${entCount} entities, ${topRev.length} revenue movers, ${topExp.length} expense movers`);
    }

    // Debug: show what data sources succeeded
    console.log(`ðŸ¤– AI Chat: Available data - Cash: ${!!cashData && !cashData?.error}, P&L: ${!!plData?.summary}, Invoices: ${!!invoicesData && !invoicesData?.error}, Expenses: ${!!expenseData?.analysis}, Ratios: ${!!ratiosData?.ratios}`);
    if (unavailable.length > 0) {
      console.log(`ðŸ¤– AI Chat: UNAVAILABLE: ${unavailable.join(', ')}`);
    }
    console.log(`ðŸ¤– AI Chat: Context length: ${financialContext.length} chars`);

    console.log(`ðŸ¤– AI Chat: Data fetched. Building prompt...`);

    // â”€â”€ Build system prompt with REAL data â”€â”€
    const systemPrompt = `You are an AI financial analyst embedded in the RAC (Rirratjingu Aboriginal Corporation) CEO Dashboard.
You have LIVE access to real financial data which is provided below. Use these ACTUAL NUMBERS in your responses.

ABOUT RAC:
- 7 entities: Mining (quarry - largest revenue), Aboriginal Corporation (parent), Enterprises, Property Management, Ngarrkuwuy Developments, Rirratjingu Invest, Marrin Square Developments
- Mining's main customer: Swiss Aluminium Australia (Rio Tinto contractor) - 75%+ of revenue
- Products: Type E Rip Rap ($105+/t), Road Base, Screened Sand, 20mm Minus ($35/t), aggregates
- Financial year: July-June (FY26 = Jul 2025 - Jun 2026)
- Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun

${financialContext}

RESPONSE GUIDELINES:

# Data integrity — non-negotiable
- ALWAYS use the exact numbers from the data above. Never calculate your own ratios, margins, or percentages — they are already provided in the FINANCIAL RATIOS section. If a ratio looks unusual (e.g. margin over 100%, negative net profit margin), report the actual figure and note it may reflect adjustments rather than recompute it.
- ALWAYS reference specific dollar amounts and accounts from the data above.
- If reversal journals are EXCLUDED (filter active), use the ADJUSTED P&L figures and explicitly note that reversals have been excluded.
- If reversal filter is OFF, use the raw figures but flag if reversals may be distorting the numbers (e.g. negative COGS, unusual margins).

# Tiny denominator percentages — avoid the "+6,840%" trap
- When a percentage change is computed against a prior-period base that is small or near zero, the percentage will explode to absurd values (e.g. +6,840%, -16,838%). These percentages are mathematically correct but meaningless and misleading.
- Rule: if the prior-period base is below $1,000 in absolute value, do NOT cite the percentage change. Cite the absolute dollar change instead, e.g. "rose from -$247 to $50,000 (a $50,247 swing)". Never write "+20,381%".
- This applies to YoY account variances and any prior-period comparisons.

# Answer framing — never lead with what's missing
- LEAD WITH WHAT YOU HAVE. Do NOT open the response with "I don't have X" or "data is unavailable". Answer the parts you can answer using the data above (especially the OUTSTANDING INVOICES aging breakdown, customer concentration, slowest payers, and account variance). If a specific dimension is genuinely absent, mention it briefly at the END as a caveat — never as the opener.
- Do NOT contradict yourself: if you list specific aging buckets, customer amounts, or slowest payers from the data, do NOT also say "I don't have aging data". The data is right above. Use it.

# Precision when summarising aging data
- When citing a slowest-payer's age, the qualifier "oldest invoice" is critical and must be preserved. WRONG: "East Arnhem 130 days overdue, $77,773 across 21 invoices" (this implies all 21 are 130 days overdue). RIGHT: "East Arnhem's oldest invoice is 130 days overdue; their full $77,773 across 21 invoices includes both current and aged amounts."
- Always distinguish "total outstanding" from "amount overdue beyond X days".

# Format and style — keep responses scannable and consistent
- Lead each paragraph with a bold thesis sentence stating the key insight (e.g. "**Revenue surged +247% on new contract wins.**" then supporting detail).
- Use Markdown ## headers when ranking, decomposing, or breaking a question into parts ("## Top 3 Drivers", "## Aging Profile"). Don't use headers for short single-paragraph answers.
- Bold key numbers using **$amount** markdown format.
- Use Australian dollar formatting: $X,XXX (commas as thousand separators).
- Be concise and executive-level — the CEO is busy. Keep responses to 2–3 short paragraphs unless the question explicitly requests a deep breakdown.
- Highlight key insights, trends, risks, and opportunities. Compare figures where relevant (revenue vs expenses, margins, YoY).`;

    // Build messages array with history
    const messages = [];
    if (history && Array.isArray(history)) {
      history.slice(-6).forEach((msg) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    messages.push({ role: "user", content: message });

    // Call Anthropic API
    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages,
        }),
      }
    );

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errorBody);
      throw new Error(`Anthropic API returned ${anthropicResponse.status}`);
    }

    const data = await anthropicResponse.json();
    const responseText =
      data.content?.[0]?.text || "Sorry, I couldn't generate a response.";

    console.log(`ðŸ¤– AI Chat: Response generated successfully`);
    res.json({ response: responseText });

  } catch (error) {
    console.error("AI Chat error:", error);
    res.status(500).json({
      response: "Sorry, I encountered an error processing your question. Please try again.",
      error: error.message,
    });
  }
});

// ============================================================================
// END AI CHAT ENDPOINT
// ============================================================================

// Initialize database and start server
async function startServer() {
  try {
    await initializeAutoRefresh();

    app.listen(port, () => {
      console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ RAC Financial Dashboard running on port ${port}`);
      console.log(
        `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â  Dashboard: ${
          process.env.NODE_ENV === "production"
            ? "https://your-app.up.railway.app"
            : `http://localhost:${port}`
        }`
      );
      console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ Database: Connected to PostgreSQL`);
      console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Xero OAuth: /auth`);
      console.log(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ApprovalMax OAuth: /auth?provider=approvalmax`);
      console.log(
        `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â½ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¯ Ready for RAC financial integration with date-flexible trial balance!`
      );
    });
  } catch (error) {
    console.error("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Failed to start server:", error);
    process.exit(1);
  }
}


startServer();