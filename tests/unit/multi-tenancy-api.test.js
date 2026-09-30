import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

async function runApiTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-test-"));
  process.env.DATA_DIR = tempDir;
  process.env.INITIAL_PASSWORD = "123456";
  console.log(`[TEST-API] Using temp DATA_DIR: ${tempDir}`);

  const { getOrganizations, getSuperadminByUsername, createOrganization } = await import("../../src/lib/localDb.js");
  await getOrganizations();

  const { POST: signupHandler } = await import("../../src/app/api/auth/signup/route.js");
  const { POST: loginHandler } = await import("../../src/app/api/auth/login/route.js");
  const { GET: statusHandler } = await import("../../src/app/api/auth/status/route.js");
  const { POST: switchOrgHandler } = await import("../../src/app/api/auth/org/switch/route.js");
  const { GET: getOrgsHandler, POST: createOrgHandler } = await import("../../src/app/api/orgs/route.js");
  const { GET: getProvidersHandler, POST: createProviderHandler } = await import("../../src/app/api/providers/route.js");
  const { createDashboardAuthToken } = await import("../../src/lib/auth/dashboardSession.js");

  try {
    // ── Test 1: Superadmin Login via /api/auth/login ──
    console.log("==> Test API 1: Superadmin Login");
    const superadminLoginReq = new Request("http://localhost:20128/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "123456" }),
    });
    const superLoginRes = await loginHandler(superadminLoginReq);
    const superLoginData = await superLoginRes.json();
    if (superLoginRes.status !== 200) console.error("Login failed with:", superLoginData);
    assert.strictEqual(superLoginRes.status, 200);
    assert.strictEqual(superLoginData.isSuperadmin, true);

    const superToken = await createDashboardAuthToken({ isSuperadmin: true, username: "admin" });

    // ── Test 2: Create Org via /api/orgs (Superadmin required) ──
    console.log("==> Test API 2: Org creation RBAC");
    // Non-superadmin attempt should fail (403 or 401)
    const unauthorizedReq = new Request("http://localhost:20128/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rogue Org" }),
    });
    const unauthRes = await createOrgHandler(unauthorizedReq);
    assert.strictEqual(unauthRes.status, 401);

    // Superadmin attempt should succeed
    const createOrgReq = new Request("http://localhost:20128/api/orgs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${superToken}`,
      },
      body: JSON.stringify({ name: "Alpha Corp", plan_tier: "enterprise", pay_as_you_go_ceiling: 250.0 }),
    });
    const createOrgRes = await createOrgHandler(createOrgReq);
    assert.strictEqual(createOrgRes.status, 201);
    const orgData = await createOrgRes.json();
    assert.strictEqual(orgData.organization.name, "Alpha Corp");
    const alphaOrgId = orgData.organization.id;

    // ── Test 3: User Signup via /api/auth/signup ──
    console.log("==> Test API 3: User signup");
    const signupReq = new Request("http://localhost:20128/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@alphacorp.com",
        password: "securepassword",
        displayName: "Alice Alpha",
      }),
    });
    const signupRes = await signupHandler(signupReq);
    assert.strictEqual(signupRes.status, 201);
    const signupData = await signupRes.json();
    assert.strictEqual(signupData.user.email, "alice@alphacorp.com");
    assert(signupData.activeOrgId, "Solo signup must auto-provision a personal workspace");
    assert.strictEqual(signupData.role, "org_admin", "User must be org_admin of their personal workspace");
    const aliceId = signupData.user.id;

    // Add Alice as org_admin to Alpha Corp
    const { addMembership } = await import("../../src/lib/db/repos/membershipsRepo.js");
    await addMembership({ userId: aliceId, orgId: alphaOrgId, role: "org_admin" });

    // ── Test 4: Alice Login & Session Context ──
    console.log("==> Test API 4: User login and org context");
    const userLoginReq = new Request("http://localhost:20128/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@alphacorp.com", password: "securepassword" }),
    });
    const userLoginRes = await loginHandler(userLoginReq);
    assert.strictEqual(userLoginRes.status, 200);
    const userLoginData = await userLoginRes.json();
    assert.strictEqual(userLoginData.organizations.length, 2, "Alice has personal workspace + Alpha Corp");

    // Test switching org to Alpha Corp
    console.log("==> Test API 4.5: Switch active organization context");
    const switchReq = new Request("http://localhost:20128/api/auth/org/switch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userLoginData.token}`,
      },
      body: JSON.stringify({ orgId: alphaOrgId }),
    });
    const switchRes = await switchOrgHandler(switchReq);
    assert.strictEqual(switchRes.status, 200);
    const switchData = await switchRes.json();
    assert.strictEqual(switchData.activeOrgId, alphaOrgId);
    assert.strictEqual(switchData.role, "org_admin");

    const aliceToken = switchData.token;

    // ── Test 5: Remote Connection Creation Server-Derived Tenant Fields ──
    console.log("==> Test API 5: Remote Connection creation derives owner_user_id and org_id");
    // Client attempts to spoof another user and org in request body
    const createConnReq = new Request("http://localhost:20128/api/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        provider: "anthropic",
        apiKey: "sk-ant-test-alice-key",
        name: "Alice Anthropic",
        is_org_shared: true,
        // Spoofed fields that MUST be ignored
        owner_user_id: "spoofed-user-id",
        org_id: "spoofed-org-id",
      }),
    });
    const createConnRes = await createProviderHandler(createConnReq);
    assert.strictEqual(createConnRes.status, 201);
    const connData = await createConnRes.json();

    assert.strictEqual(connData.connection.owner_user_id, aliceId, "owner_user_id must match session userId, NOT spoofed value");
    assert.strictEqual(connData.connection.org_id, alphaOrgId, "org_id must match session activeOrgId, NOT spoofed value");
    assert.strictEqual(Boolean(connData.connection.is_org_shared), true, "Alice (org_admin) can share connection org-wide");

    // ── Test 6: Scoped Provider Read ──
    console.log("==> Test API 6: Scoped connection list");
    const getConnsReq = new Request("http://localhost:20128/api/providers", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${aliceToken}`,
      },
    });
    const getConnsRes = await getProvidersHandler(getConnsReq);
    assert.strictEqual(getConnsRes.status, 200);
    const connsListData = await getConnsRes.json();
    assert.strictEqual(connsListData.connections.length, 1);
    assert.strictEqual(connsListData.connections[0].id, connData.connection.id);

    console.log("✅ All API endpoint multi-tenancy tests passed successfully!");
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runApiTests().catch((err) => {
  console.error("❌ API test failure:", err);
  process.exit(1);
});
