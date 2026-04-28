import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const checkAuthStatusSchema = {};

export async function checkAuthStatus(_args: Record<string, never>) {
  const tokenPath = resolve(process.env.LINKEDIN_TOKEN_PATH ?? "./token.json");

  if (!existsSync(tokenPath)) {
    return {
      status: "NO_TOKEN",
      token_path: tokenPath,
      message: "No token.json found. Run `npm run auth` to authorize.",
    };
  }

  const raw = await readFile(tokenPath, "utf8");
  const tokens = JSON.parse(raw) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    refresh_token_expires_at: number;
    scope?: string;
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const accessExpiresAt = new Date(tokens.expires_at * 1000).toISOString();
  const refreshExpiresAt = new Date(tokens.refresh_token_expires_at * 1000).toISOString();
  const accessDaysLeft = Math.floor((tokens.expires_at - nowSec) / 86400);
  const refreshDaysLeft = Math.floor((tokens.refresh_token_expires_at - nowSec) / 86400);
  const accessExpired = nowSec >= tokens.expires_at;
  const refreshExpired = nowSec >= tokens.refresh_token_expires_at;

  let status: string;
  let message: string;

  if (refreshExpired) {
    status = "REFRESH_EXPIRED";
    message = "Refresh token has expired. Run `npm run auth` to re-authorize.";
  } else if (accessExpired) {
    status = "ACCESS_EXPIRED_AUTO_REFRESH";
    message = "Access token expired but refresh token is valid. Will auto-refresh on next API call.";
  } else if (accessDaysLeft <= 7) {
    status = "ACCESS_EXPIRING_SOON";
    message = `Access token expires in ${accessDaysLeft} day(s). Auto-refresh is enabled — no action needed.`;
  } else if (refreshDaysLeft <= 30) {
    status = "REFRESH_EXPIRING_SOON";
    message = `Refresh token expires in ${refreshDaysLeft} day(s). Plan to run \`npm run auth\` before it lapses.`;
  } else {
    status = "OK";
    message = "Tokens are valid.";
  }

  return {
    status,
    message,
    token_path: tokenPath,
    access_token: {
      valid: !accessExpired,
      expires_at: accessExpiresAt,
      days_remaining: accessDaysLeft,
    },
    refresh_token: {
      valid: !refreshExpired,
      expires_at: refreshExpiresAt,
      days_remaining: refreshDaysLeft,
    },
    scopes: tokens.scope ?? null,
    env: {
      configured_account: process.env.LINKEDIN_DEFAULT_AD_ACCOUNT ?? null,
      api_version: process.env.LINKEDIN_API_VERSION ?? "202604 (default)",
      client_id_set: Boolean(process.env.LINKEDIN_CLIENT_ID),
      client_secret_set: Boolean(process.env.LINKEDIN_CLIENT_SECRET),
    },
  };
}
