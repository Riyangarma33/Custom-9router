import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings, verifySuperadminPassword } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";
const SESSION_MAX_AGE_SEC = 24 * 60 * 60;

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

/**
 * Creates a JWT token for the dashboard session.
 * For users: { userId, email, displayName, activeOrgId, role }
 * For superadmins: { isSuperadmin: true, username: 'admin' }
 */
export async function createDashboardAuthToken(claims = {}) {
  const payload = {
    authenticated: true,
    ...claims,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies session from an incoming Request (via cookie or Authorization header).
 */
export async function getSessionFromRequest(request) {
  if (!request) return null;

  // 1. Check cookies
  let token = null;
  try {
    token = request.cookies?.get?.("auth_token")?.value;
  } catch {}

  // 2. Check Authorization header
  if (!token) {
    const authHeader = request.headers?.get?.("Authorization") || request.headers?.get?.("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }
  }

  // 3. Check Cookie header string directly if cookies obj not parsed
  if (!token) {
    const cookieHeader = request.headers?.get?.("cookie") || "";
    const match = cookieHeader.match(/auth_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) return null;
  return getDashboardAuthSession(token);
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return token;
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify dashboard password (superadmin or local settings fallback).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;

  // Check superadmin first
  try {
    const isSuper = await verifySuperadminPassword("admin", password);
    if (isSuper) return true;
  } catch {}

  // Fallback to settings password
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);

  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
