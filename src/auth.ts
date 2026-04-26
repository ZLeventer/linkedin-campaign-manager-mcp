import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { URL } from "node:url";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export const LINKEDIN_SCOPES = [
  "r_ads",
  "r_ads_reporting",
  "r_ads_leadgen_automation",
];

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  refresh_token_expires_at: number;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

let cachedTokens: StoredTokens | null = null;

function tokenPath(): string {
  return resolve(process.env.LINKEDIN_TOKEN_PATH ?? "./token.json");
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.LINKEDIN_CLIENT_ID;
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!id) throw new AuthError("LINKEDIN_CLIENT_ID is not set");
  if (!secret) throw new AuthError("LINKEDIN_CLIENT_SECRET is not set");
  return { id, secret };
}

function oauthPort(): number {
  const raw = process.env.LINKEDIN_OAUTH_PORT ?? "53123";
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new AuthError(`LINKEDIN_OAUTH_PORT invalid: ${raw}`);
  }
  return n;
}

function redirectUri(): string {
  return `http://127.0.0.1:${oauthPort()}`;
}

async function loadTokens(): Promise<StoredTokens> {
  if (cachedTokens) return cachedTokens;
  const path = tokenPath();
  if (!existsSync(path)) {
    throw new AuthError(`No token at ${path}. Run \`npm run auth\` once to authorize.`);
  }
  const raw = await readFile(path, "utf8");
  const tokens = JSON.parse(raw) as StoredTokens;
  cachedTokens = tokens;
  return tokens;
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  cachedTokens = tokens;
  await writeFile(tokenPath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens> {
  const { id, secret } = clientCreds();
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: id,
      client_secret: secret,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new AuthError(`Refresh failed ${res.status}: ${body}`);
  }
  const data = (await res.json()) as TokenResponse;
  const now = Math.floor(Date.now() / 1000);
  const refreshed: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: now + data.expires_in - 60,
    refresh_token_expires_at: data.refresh_token_expires_in
      ? now + data.refresh_token_expires_in
      : tokens.refresh_token_expires_at,
    scope: data.scope ?? tokens.scope,
  };
  await saveTokens(refreshed);
  return refreshed;
}

/** Returns a currently-valid access token, refreshing if needed. */
export async function getAccessToken(): Promise<string> {
  let tokens = await loadTokens();
  const now = Math.floor(Date.now() / 1000);
  if (tokens.refresh_token_expires_at && now >= tokens.refresh_token_expires_at) {
    throw new AuthError(
      "Refresh token has expired (365d lifetime). Run `npm run auth` to re-authorize."
    );
  }
  if (now >= tokens.expires_at) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.access_token;
}

/** One-time interactive OAuth flow: opens browser, captures code, exchanges for tokens. */
export async function runInitFlow(): Promise<void> {
  const { id, secret } = clientCreds();
  const port = oauthPort();
  const redirect = redirectUri();
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const authUrl = new URL(LINKEDIN_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", id);
  authUrl.searchParams.set("redirect_uri", redirect);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));

  console.error("\n=== LinkedIn Campaign Manager MCP — initial auth ===\n");
  console.error("Prerequisite: in your LinkedIn app (developer.linkedin.com → your app");
  console.error(`→ Auth tab), add this exact redirect URI:\n\n    ${redirect}\n`);
  console.error("Also ensure the app has been granted these product scopes:");
  console.error(`    ${LINKEDIN_SCOPES.join(", ")}\n`);
  console.error("Open this URL in your browser:\n");
  console.error(authUrl.toString());
  console.error("\nWaiting for redirect on port " + port + "...\n");

  const code: string = await new Promise((res, rej) => {
    const server = createServer((req, resp) => {
      try {
        const u = new URL(req.url ?? "/", redirect);
        const c = u.searchParams.get("code");
        const s = u.searchParams.get("state");
        const e = u.searchParams.get("error");
        const ed = u.searchParams.get("error_description");
        if (e) {
          const msg = `Auth error: ${e}${ed ? " — " + ed : ""}`;
          resp.writeHead(400, { "content-type": "text/plain" });
          resp.end(msg);
          server.close();
          rej(new Error(msg));
          return;
        }
        if (c) {
          if (s !== state) {
            resp.writeHead(400, { "content-type": "text/plain" });
            resp.end("State mismatch");
            server.close();
            rej(new Error("State mismatch — possible CSRF"));
            return;
          }
          resp.writeHead(200, { "content-type": "text/plain" });
          resp.end("Authorized. You can close this tab.");
          server.close();
          res(c);
          return;
        }
        resp.writeHead(404).end();
      } catch (caught) {
        rej(caught);
      }
    });
    server.on("error", rej);
    server.listen(port, "127.0.0.1");
  });

  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: id,
      client_secret: secret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new AuthError(`Token exchange failed ${tokenRes.status}: ${body}`);
  }
  const data = (await tokenRes.json()) as TokenResponse;
  if (!data.refresh_token) {
    throw new AuthError(
      "No refresh_token returned. Enable refresh tokens on your LinkedIn app (Auth tab)."
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const tokens: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now + data.expires_in - 60,
    refresh_token_expires_at: data.refresh_token_expires_in
      ? now + data.refresh_token_expires_in
      : now + 365 * 24 * 3600,
    scope: data.scope,
  };
  await saveTokens(tokens);
  console.error(`\nSaved tokens to ${tokenPath()}`);
  console.error(`  access token expires: ${new Date(tokens.expires_at * 1000).toISOString()}`);
  console.error(`  refresh token expires: ${new Date(tokens.refresh_token_expires_at * 1000).toISOString()}`);
  console.error(`  granted scopes: ${tokens.scope ?? "(not reported)"}\n`);
}
