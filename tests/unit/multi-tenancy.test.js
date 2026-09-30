import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

// Standalone runner compatibility (runs both directly in node and under vitest)
const isVitest = typeof describe === "function" && typeof it === "function";

async function runMultiTenancyTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mt-test-"));
  process.env.DATA_DIR = tempDir;

  console.log(`[TEST] Using temp DATA_DIR: ${tempDir}`);

  // Dynamic import so DATA_DIR is picked up
  const {
    getOrganizations,
    createOrganization,
    getOrganizationById,
    updateOrganization,
    deleteOrganization,
    createUser,
    getUserById,
    getUserByEmail,
    verifyUserPassword,
    getMembershipsForUser,
    addMembership,
    createInvitation,
    redeemInvitation,
    createProviderConnection,
    getProviderConnections,
    getProviderConnectionById,
    getSuperadminByUsername,
    verifySuperadminPassword,
    getOrgSettings,
    updateOrgSettings,
  } = await import("../../src/lib/localDb.js");

  const { getProviderCredentials, markAccountUnavailable } = await import("../../src/sse/services/auth.js");

  try {
    // ── Test 1: Verify Superadmin structural separation ──
    console.log("==> Test 1: Superadmin structural separation");
    const admin = await getSuperadminByUsername("admin");
    assert(admin, "Superadmin record must exist");
    assert.strictEqual(admin.username, "admin");

    const validPass = await verifySuperadminPassword("admin", "123456");
    assert.strictEqual(validPass, true, "Superadmin password verification must succeed");

    const adminAsUser = await getUserByEmail("admin");
    assert.strictEqual(adminAsUser, null, "Superadmin must NOT be a row in users table");

    // ── Test 2: Create Two Distinct Organizations ──
    console.log("==> Test 2: Create Org A and Org B");
    const orgA = await createOrganization({
      name: "Acme Corp (Org A)",
      plan_tier: "enterprise",
      pay_as_you_go_ceiling: 100.0,
      created_by: "admin",
    });
    assert(orgA && orgA.id, "Org A must be created");

    const orgB = await createOrganization({
      name: "Beta Inc (Org B)",
      plan_tier: "standard",
      pay_as_you_go_ceiling: 50.0,
      created_by: "admin",
    });
    assert(orgB && orgB.id, "Org B must be created");

    // ── Test 3: Create Users in Both Orgs and Multi-Org User ──
    console.log("==> Test 3: Create users and assign memberships");
    const userA1 = await createUser({
      email: "usera1@acme.com",
      password: "password123",
      displayName: "User A1 (Admin)",
    });
    const userA2 = await createUser({
      email: "usera2@acme.com",
      password: "password123",
      displayName: "User A2 (Member)",
    });

    const userB1 = await createUser({
      email: "userb1@beta.com",
      password: "password123",
      displayName: "User B1 (Admin)",
    });
    const userB2 = await createUser({
      email: "userb2@beta.com",
      password: "password123",
      displayName: "User B2 (Member)",
    });

    const userAB = await createUser({
      email: "userab@shared.com",
      password: "password123",
      displayName: "User AB (Multi-Org)",
    });

    // Assign roles in Org A
    await addMembership({ userId: userA1.id, orgId: orgA.id, role: "org_admin" });
    await addMembership({ userId: userA2.id, orgId: orgA.id, role: "member" });
    await addMembership({ userId: userAB.id, orgId: orgA.id, role: "member" });

    // Assign roles in Org B
    await addMembership({ userId: userB1.id, orgId: orgB.id, role: "org_admin" });
    await addMembership({ userId: userB2.id, orgId: orgB.id, role: "member" });
    await addMembership({ userId: userAB.id, orgId: orgB.id, role: "org_admin" });

    // Verify User AB has different roles across orgs
    const userABMemberships = await getMembershipsForUser(userAB.id);
    assert.strictEqual(userABMemberships.length, 2, "User AB must belong to 2 organizations");

    const abInOrgA = userABMemberships.find((m) => m.orgId === orgA.id);
    const abInOrgB = userABMemberships.find((m) => m.orgId === orgB.id);
    assert.strictEqual(abInOrgA.role, "member", "User AB must be plain 'member' in Org A");
    assert.strictEqual(abInOrgB.role, "org_admin", "User AB must be 'org_admin' in Org B");

    // ── Test 4: Invitations and Single-Use Redemption ──
    console.log("==> Test 4: Org invitations and single-use redemption");
    const inv = await createInvitation({
      orgId: orgA.id,
      roleToAssign: "member",
      createdBy: userA1.id,
    });
    assert(inv && inv.code, "Invitation must have a unique code");

    const invitedUser = await createUser({
      email: "invited@acme.com",
      password: "password123",
      displayName: "Invited User",
    });

    const redeemed = await redeemInvitation(inv.code, invitedUser.id);
    assert.strictEqual(redeemed.orgId, orgA.id);
    assert.strictEqual(redeemed.role, "member");

    // Attempt double redemption
    let alreadyUsedError = null;
    try {
      await redeemInvitation(inv.code, userB2.id);
    } catch (err) {
      alreadyUsedError = err;
    }
    assert(alreadyUsedError, "Redeeming an already used invitation must fail");
    assert.strictEqual(alreadyUsedError.code, "INVITATION_ALREADY_USED");

    // ── Test 5: Provider Connections Scoping & Isolation ──
    console.log("==> Test 5: Provider connections scoping and read-path isolation");
    // Org A connections
    const connA1Personal = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "User A1 Personal Key",
      apiKey: "sk-a1-personal",
      owner_user_id: userA1.id,
      org_id: orgA.id,
      is_org_shared: 0,
      priority: 1,
    });

    const connAShared = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Org A Shared Key Pool",
      apiKey: "sk-a-shared",
      owner_user_id: userA1.id,
      org_id: orgA.id,
      is_org_shared: 1,
      priority: 2,
    });

    // Org B connections
    const connB1Personal = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "User B1 Personal Key",
      apiKey: "sk-b1-personal",
      owner_user_id: userB1.id,
      org_id: orgB.id,
      is_org_shared: 0,
      priority: 1,
    });

    const connBShared = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Org B Shared Key Pool",
      apiKey: "sk-b-shared",
      owner_user_id: userB1.id,
      org_id: orgB.id,
      is_org_shared: 1,
      priority: 2,
    });

    // User AB's connections in Org A and Org B
    const connABOrgA = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "User AB Org A Key",
      apiKey: "sk-ab-orga",
      owner_user_id: userAB.id,
      org_id: orgA.id,
      is_org_shared: 0,
      priority: 1,
    });

    const connABOrgB = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "User AB Org B Key",
      apiKey: "sk-ab-orgb",
      owner_user_id: userAB.id,
      org_id: orgB.id,
      is_org_shared: 0,
      priority: 1,
    });

    // Assertion 5.1: User A1 read path in Org A
    const listA1 = await getProviderConnections({
      provider: "openai",
      accessibleBy: { userId: userA1.id, orgId: orgA.id, isSuperadmin: false },
    });
    const a1Ids = listA1.map((c) => c.id);
    assert(a1Ids.includes(connA1Personal.id), "User A1 must see their personal connection in Org A");
    assert(a1Ids.includes(connAShared.id), "User A1 must see Org A shared connection");
    assert(!a1Ids.includes(connB1Personal.id), "User A1 must NEVER see Org B personal connection");
    assert(!a1Ids.includes(connBShared.id), "User A1 must NEVER see Org B shared connection");
    assert(!a1Ids.includes(connABOrgA.id), "User A1 must NEVER see User AB personal connection in Org A");

    // Assertion 5.2: User AB read path while active in Org A
    const listAB_OrgA = await getProviderConnections({
      provider: "openai",
      accessibleBy: { userId: userAB.id, orgId: orgA.id, isSuperadmin: false },
    });
    const abOrgAIds = listAB_OrgA.map((c) => c.id);
    assert(abOrgAIds.includes(connABOrgA.id), "User AB in Org A sees their Org A connection");
    assert(abOrgAIds.includes(connAShared.id), "User AB in Org A sees Org A shared connection");
    assert(!abOrgAIds.includes(connABOrgB.id), "User AB's Org B connection is INVISIBLE while active in Org A");
    assert(!abOrgAIds.includes(connBShared.id), "User AB in Org A cannot see Org B shared connection");

    // Assertion 5.3: User AB read path while active in Org B
    const listAB_OrgB = await getProviderConnections({
      provider: "openai",
      accessibleBy: { userId: userAB.id, orgId: orgB.id, isSuperadmin: false },
    });
    const abOrgBIds = listAB_OrgB.map((c) => c.id);
    assert(abOrgBIds.includes(connABOrgB.id), "User AB in Org B sees their Org B connection");
    assert(abOrgBIds.includes(connBShared.id), "User AB in Org B sees Org B shared connection");
    assert(!abOrgBIds.includes(connABOrgA.id), "User AB's Org A connection is INVISIBLE while active in Org B");
    assert(!abOrgBIds.includes(connAShared.id), "User AB in Org B cannot see Org A shared connection");

    // ── Test 6: Dynamic Credential Resolver Multi-Tier Failover ──
    console.log("==> Test 6: Dynamic Credential Resolver Tier 1 and Tier 2 Failover");

    // Case 6.1: Tier 1 Personal match for User A1
    const creds1 = await getProviderCredentials("openai", null, "gpt-4o", {
      callerContext: { userId: userA1.id, orgId: orgA.id, isSuperadmin: false },
    });
    assert(creds1, "Resolver must return credentials");
    assert.strictEqual(creds1.connectionId, connA1Personal.id, "Tier 1: must pick User A1 personal connection first");

    // Case 6.2: Rate limit Tier 1 personal connection -> Failover to Tier 2 Org Shared
    await markAccountUnavailable(connA1Personal.id, 429, "rate_limited", "openai", "gpt-4o", Date.now() + 60000);

    const creds2 = await getProviderCredentials("openai", null, "gpt-4o", {
      callerContext: { userId: userA1.id, orgId: orgA.id, isSuperadmin: false },
    });
    assert(creds2, "Resolver must failover to Tier 2 shared connection");
    assert.strictEqual(creds2.connectionId, connAShared.id, "Tier 2: must fallback to Org A shared pool");

    // Case 6.3: Rate limit Tier 2 as well -> Verify Org B connections are STILL NOT ACCESSED
    await markAccountUnavailable(connAShared.id, 429, "rate_limited", "openai", "gpt-4o", Date.now() + 60000);

    const creds3 = await getProviderCredentials("openai", null, "gpt-4o", {
      callerContext: { userId: userA1.id, orgId: orgA.id, isSuperadmin: false },
    });
    // Either all rate-limited or null, but NEVER returns Org B's connections!
    assert(
      creds3 === null || creds3.allRateLimited === true,
      "Org A must be rate-limited and NEVER leak to Org B"
    );
    if (creds3 && creds3.connectionId) {
      assert.notStrictEqual(creds3.connectionId, connB1Personal.id);
      assert.notStrictEqual(creds3.connectionId, connBShared.id);
    }

    // Case 6.4: Meanwhile, Org B caller is unaffected!
    const credsB = await getProviderCredentials("openai", null, "gpt-4o", {
      callerContext: { userId: userB1.id, orgId: orgB.id, isSuperadmin: false },
    });
    assert(credsB, "Org B caller must NOT be affected by Org A rate limits");
    assert.strictEqual(credsB.connectionId, connB1Personal.id, "Org B caller gets their Tier 1 personal connection");

    // Case 6.5: Tier 3 Platform Pay-As-You-Go fallback when platform connection is seeded
    console.log("==> Test 6.5: Tier 3 platform pay-as-you-go pool fallback");
    const connPlatform = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Platform Pay-As-You-Go OpenRouter Pool",
      apiKey: "sk-platform-openrouter-key",
      org_id: "org_default",
      is_org_shared: 1,
      priority: 1,
    });

    const credsTier3 = await getProviderCredentials("openai", null, "gpt-4o", {
      callerContext: { userId: userA1.id, orgId: orgA.id, isSuperadmin: false },
    });
    assert(credsTier3, "Org A must failover to Tier 3 platform PAYG connection when ceiling allows");
    assert.strictEqual(credsTier3.connectionId, connPlatform.id, "Must select Tier 3 platform connection");

    // Case 6.6: If Org has 0 ceiling, Tier 3 is refused
    await updateOrganization(orgA.id, { pay_as_you_go_ceiling: 0.0 });
    const credsZeroCeiling = await getProviderCredentials("openai", null, "gpt-4o", {
      callerContext: { userId: userA1.id, orgId: orgA.id, isSuperadmin: false },
    });
    assert(
      credsZeroCeiling === null || credsZeroCeiling.allRateLimited === true,
      "Zero ceiling org must NOT be allowed to draw on Tier 3 platform pool"
    );

    // ── Test 7: Per-Org Settings ──
    console.log("==> Test 7: Per-organization settings isolation");
    await updateOrgSettings(orgA.id, { oidcIssuerUrl: "https://auth.acme.com", authMode: "oidc" });
    await updateOrgSettings(orgB.id, { samlEntryPoint: "https://saml.beta.com", authMode: "saml" });

    const settingsA = await getOrgSettings(orgA.id);
    const settingsB = await getOrgSettings(orgB.id);

    assert.strictEqual(settingsA.oidcIssuerUrl, "https://auth.acme.com");
    assert.strictEqual(settingsA.authMode, "oidc");

    assert.strictEqual(settingsB.samlEntryPoint, "https://saml.beta.com");
    assert.strictEqual(settingsB.authMode, "saml");

    console.log("✅ All Phase 4 multi-tenancy unit tests passed successfully!");
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Run when executed directly via Node
runMultiTenancyTests().catch((err) => {
  console.error("❌ Multi-tenancy test failure:", err);
  process.exit(1);
});
