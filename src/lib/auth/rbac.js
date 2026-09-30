import { NextResponse } from "next/server";
import { getSessionFromRequest } from "./dashboardSession.js";
import { getApiKeyByKey } from "../db/repos/apiKeysRepo.js";
import { getMembership } from "../db/repos/membershipsRepo.js";
import { isLocalRequest } from "@/dashboardGuard";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) {
    const { getConsistentMachineId } = await import("@/shared/utils/machineId");
    cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  }
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  if (!request?.headers) return false;
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

function extractApiKey(request) {
  if (!request?.headers) return null;
  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const val = authHeader.slice(7).trim();
    // Exclude JWT tokens (which have 3 dot-separated parts)
    if (val.split(".").length !== 3) return val;
  }
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader.trim();
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader.trim();
  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key");
    if (keyParam) return keyParam.trim();
  } catch {}
  return null;
}

/**
 * Resolves full tenant context for an incoming request.
 */
export async function resolveCallerContext(request) {
  // 1. CLI Token (internal CLI / daemon access)
  if (await hasValidCliToken(request)) {
    const headerUserId = request.headers.get("x-9r-user-id");
    const headerOrgId = request.headers.get("x-9r-org-id") || request.headers.get("x-9r-active-org");
    const isSuper = request.headers.get("x-9r-superadmin") === "true";
    return {
      authenticated: true,
      isCli: true,
      isSuperadmin: isSuper,
      userId: headerUserId || null,
      orgId: headerOrgId || (isSuper ? null : "org_default"),
      role: isSuper ? "superadmin" : "org_admin",
    };
  }

  // 2. JWT Dashboard Session
  const session = await getSessionFromRequest(request);
  if (session && session.authenticated) {
    if (session.isSuperadmin) {
      return {
        authenticated: true,
        isSuperadmin: true,
        userId: null,
        orgId: null,
        role: "superadmin",
        username: session.username || "admin",
      };
    }

    // User session
    const userId = session.userId;
    let activeOrgId = request.headers?.get?.("x-active-org") ||
                      request.headers?.get?.("x-9r-active-org") ||
                      session.activeOrgId ||
                      null;

    let role = session.role || "member";
    if (userId && activeOrgId) {
      const membership = await getMembership(userId, activeOrgId);
      if (membership) {
        role = membership.role;
      }
    }

    return {
      authenticated: true,
      isSuperadmin: false,
      userId,
      email: session.email,
      displayName: session.displayName,
      orgId: activeOrgId,
      role,
    };
  }

  // 3. API Key
  const rawApiKey = extractApiKey(request);
  if (rawApiKey) {
    const keyRow = await getApiKeyByKey(rawApiKey);
    if (keyRow && keyRow.isActive) {
      return {
        authenticated: true,
        isApiKey: true,
        isSuperadmin: false,
        apiKeyId: keyRow.id,
        userId: keyRow.user_id || null,
        orgId: keyRow.org_id || "org_default",
        role: "member",
      };
    }
  }

  // 4. Local request fallback (dashboard or local CLI without auth)
  if (request && isLocalRequest(request)) {
    return {
      authenticated: true,
      isLocal: true,
      isSuperadmin: false,
      userId: null,
      orgId: "org_default",
      role: "org_admin",
    };
  }

  return {
    authenticated: false,
    isSuperadmin: false,
    userId: null,
    orgId: null,
    role: null,
  };
}

export async function requireAuth(request) {
  const ctx = await resolveCallerContext(request);
  if (!ctx.authenticated) {
    const errorRes = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    errorRes.ctx = ctx;
    return { error: errorRes, ctx };
  }
  return { ctx };
}

export async function requireSuperadmin(request) {
  const { error, ctx } = await requireAuth(request);
  if (error) return { error, ctx };
  if (!ctx.isSuperadmin) {
    return {
      error: NextResponse.json({ error: "Forbidden: Superadmin access required" }, { status: 403 }),
      ctx,
    };
  }
  return { ctx };
}

export async function requireOrgAdmin(request, targetOrgId) {
  const { error, ctx } = await requireAuth(request);
  if (error) return { error, ctx };
  if (ctx.isSuperadmin) return { ctx };

  const orgId = targetOrgId || ctx.orgId;
  if (!orgId) {
    return {
      error: NextResponse.json({ error: "Forbidden: No active organization context" }, { status: 403 }),
      ctx,
    };
  }

  if (ctx.userId) {
    const membership = await getMembership(ctx.userId, orgId);
    if (membership && membership.role === "org_admin") {
      return { ctx: { ...ctx, orgId, role: "org_admin" } };
    }
  }

  return {
    error: NextResponse.json({ error: "Forbidden: Organization admin privileges required" }, { status: 403 }),
    ctx,
  };
}

export async function requireOrgMember(request, targetOrgId) {
  const { error, ctx } = await requireAuth(request);
  if (error) return { error, ctx };
  if (ctx.isSuperadmin) return { ctx };

  const orgId = targetOrgId || ctx.orgId;
  if (!orgId) {
    return {
      error: NextResponse.json({ error: "Forbidden: No active organization context" }, { status: 403 }),
      ctx,
    };
  }

  if (ctx.userId) {
    const membership = await getMembership(ctx.userId, orgId);
    if (membership) {
      return { ctx: { ...ctx, orgId, role: membership.role } };
    }
  }

  if (ctx.isLocal && orgId === "org_default") {
    return { ctx };
  }

  return {
    error: NextResponse.json({ error: "Forbidden: Not a member of this organization" }, { status: 403 }),
    ctx,
  };
}
