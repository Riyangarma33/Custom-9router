import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserById } from "@/lib/db/repos/usersRepo.js";
import { getMembershipsForUser } from "@/lib/db/repos/membershipsRepo.js";
import { getOrganizationById } from "@/lib/db/repos/organizationsRepo.js";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const session = await getDashboardAuthSession(token);

    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const ssoType = settings.ssoType || "oidc";

    if (!session || !session.authenticated) {
      return NextResponse.json({
        requireLogin,
        authMode,
        ssoType,
        oidcConfigured: isOidcConfigured(settings),
        oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
        samlConfigured: isSamlConfigured(settings),
        samlLoginLabel: (settings.samlLoginLabel || "Sign in with SAML SSO").trim() || "Sign in with SAML SSO",
        hasPassword: !!settings.password,
        displayName: "Guest",
        loginMethod: null,
        authenticated: false,
        isSuperadmin: false,
        user: null,
        activeOrgId: null,
        activeOrg: null,
        role: null,
        organizations: [],
      });
    }

    // Superadmin session
    if (session.isSuperadmin) {
      return NextResponse.json({
        requireLogin,
        authMode,
        ssoType,
        oidcConfigured: isOidcConfigured(settings),
        oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
        samlConfigured: isSamlConfigured(settings),
        samlLoginLabel: (settings.samlLoginLabel || "Sign in with SAML SSO").trim() || "Sign in with SAML SSO",
        hasPassword: !!settings.password,
        displayName: "Superadmin",
        loginMethod: "Superadmin",
        authenticated: true,
        isSuperadmin: true,
        user: null,
        activeOrgId: null,
        activeOrg: null,
        role: "superadmin",
        organizations: [],
      });
    }

    // User session
    const user = session.userId ? await getUserById(session.userId) : null;
    const memberships = session.userId ? await getMembershipsForUser(session.userId) : [];

    let activeOrgId = session.activeOrgId;
    let activeOrg = null;
    let role = session.role || "member";

    if (activeOrgId) {
      activeOrg = await getOrganizationById(activeOrgId);
      const m = memberships.find((item) => item.orgId === activeOrgId);
      if (m) role = m.role;
    } else if (memberships.length > 0) {
      activeOrgId = memberships[0].orgId;
      activeOrg = await getOrganizationById(activeOrgId);
      role = memberships[0].role;
    }

    const displayName =
      user?.display_name ||
      session.displayName ||
      user?.email ||
      session.email ||
      "User";

    const loginMethod = session.saml ? "SAML" : session.oidc ? "OIDC" : "Local";

    return NextResponse.json({
      requireLogin,
      authMode,
      ssoType,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      samlConfigured: isSamlConfigured(settings),
      samlLoginLabel: (settings.samlLoginLabel || "Sign in with SAML SSO").trim() || "Sign in with SAML SSO",
      hasPassword: !!settings.password,
      displayName,
      loginMethod,
      authenticated: true,
      isSuperadmin: false,
      user: user ? {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        authSource: user.authSource,
      } : {
        id: session.userId,
        email: session.email,
        displayName: session.displayName,
      },
      activeOrgId,
      activeOrg: activeOrg ? {
        id: activeOrg.id,
        name: activeOrg.name,
        plan_tier: activeOrg.plan_tier,
        status: activeOrg.status,
      } : null,
      role,
      organizations: memberships.map((m) => ({
        id: m.orgId,
        name: m.orgName,
        role: m.role,
        status: m.orgStatus,
      })),
      oidcLogin: !!session.oidc,
      samlLogin: !!session.saml,
    });
  } catch (error) {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      ssoType: "oidc",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      samlConfigured: false,
      samlLoginLabel: "Sign in with SAML SSO",
      hasPassword: false,
      displayName: "Guest",
      loginMethod: null,
      authenticated: false,
      isSuperadmin: false,
      user: null,
      activeOrgId: null,
      activeOrg: null,
      role: null,
      organizations: [],
    });
  }
}
