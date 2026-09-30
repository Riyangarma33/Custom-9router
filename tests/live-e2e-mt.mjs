import assert from "node:assert";

const BASE_URL = "http://127.0.0.1:20148";

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.headers?.Authorization) {
    const m = options.headers.Authorization.match(/Bearer (.+)/);
    if (m && !headers["Cookie"]) {
      headers["Cookie"] = `auth_token=${m[1]}`;
    }
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

async function runLiveTests() {
  console.log(`\n======================================================`);
  console.log(`Starting Phase 4 Live E2E Verification on ${BASE_URL}`);
  console.log(`======================================================\n`);

  // ── Step 1: Health Probe ──
  console.log("--> Step 1: Health check");
  const health = await request("/api/health");
  assert.strictEqual(health.status, 200, "Health probe must return 200");
  assert.strictEqual(health.body.ok, true);
  console.log("✓ Health endpoint OK");

  // ── Step 2: Superadmin Login ──
  console.log("--> Step 2: Superadmin login");
  const superLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "123456" }),
  });
  assert.strictEqual(superLogin.status, 200, `Superadmin login failed: ${JSON.stringify(superLogin.body)}`);
  assert.strictEqual(superLogin.body.isSuperadmin, true);
  const superToken = superLogin.body.token;
  assert(superToken, "Superadmin token must be returned");
  console.log("✓ Superadmin authenticated successfully");

  // ── Step 3: RBAC - Org Creation Gating ──
  console.log("--> Step 3: Testing org creation gating (Superadmin-only)");
  const unauthOrg = await request("/api/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "Unauth Org" }),
  });
  assert.strictEqual(unauthOrg.status, 401, "Unauthenticated org creation must be rejected");

  // Create Org Acme via Superadmin
  const timestamp = Date.now();
  const createOrgAcme = await request("/api/orgs", {
    method: "POST",
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      name: `Acme Corp ${timestamp}`,
      plan_tier: "enterprise",
      pay_as_you_go_ceiling: 150.0,
    }),
  });
  assert.strictEqual(createOrgAcme.status, 201, `Failed to create Org Acme: ${JSON.stringify(createOrgAcme.body)}`);
  const orgAcme = createOrgAcme.body.organization;
  assert(orgAcme && orgAcme.id);
  console.log(`✓ Superadmin created Org Acme: ${orgAcme.id} (${orgAcme.name})`);

  // ── Step 4: Solo Signup Bootstrapping ──
  console.log("--> Step 4: Solo user signup without invitation code");
  const aliceEmail = `alice_${timestamp}@acme.com`;
  const aliceSignup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: aliceEmail,
      password: "password1234",
      displayName: "Alice",
    }),
  });
  assert.strictEqual(aliceSignup.status, 201, `Alice signup failed: ${JSON.stringify(aliceSignup.body)}`);
  assert.strictEqual(aliceSignup.body.user.email, aliceEmail);
  assert(aliceSignup.body.activeOrgId, "Solo user must receive an auto-provisioned personal workspace");
  assert.strictEqual(aliceSignup.body.role, "org_admin");
  const aliceToken = aliceSignup.body.token;
  const aliceId = aliceSignup.body.user.id;
  const alicePersonalOrgId = aliceSignup.body.activeOrgId;
  console.log(`✓ Alice signed up solo: personal workspace auto-created (${alicePersonalOrgId}) with role 'org_admin'`);

  // ── Step 5: Check Auth Status & Clean Solo UX ──
  console.log("--> Step 5: Verify auth status for solo user");
  const aliceStatus = await request("/api/auth/status", {
    method: "GET",
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert.strictEqual(aliceStatus.status, 200);
  assert.strictEqual(aliceStatus.body.authenticated, true);
  assert.strictEqual(aliceStatus.body.organizations.length, 1);
  assert.strictEqual(aliceStatus.body.organizations[0].type, "personal_auto");
  console.log("✓ Solo user auth status OK (type = 'personal_auto' correctly flagged)");

  // ── Step 6: Add Alice to Org Acme as Org Admin ──
  console.log("--> Step 6: Add Alice to Org Acme as org_admin");
  const addAlice = await request(`/api/orgs/${orgAcme.id}/members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      userId: aliceId,
      role: "org_admin",
    }),
  });
  assert.strictEqual(addAlice.status, 201, `Failed to add Alice to Acme: ${JSON.stringify(addAlice.body)}`);
  console.log("✓ Alice added to Org Acme as org_admin");

  // ── Step 7: Alice Switches Active Org to Org Acme ──
  console.log("--> Step 7: Alice switches active org to Org Acme");
  const switchOrg = await request("/api/auth/org/switch", {
    method: "POST",
    headers: { Authorization: `Bearer ${aliceToken}` },
    body: JSON.stringify({ orgId: orgAcme.id }),
  });
  assert.strictEqual(switchOrg.status, 200, `Failed to switch org: ${JSON.stringify(switchOrg.body)}`);
  assert.strictEqual(switchOrg.body.activeOrgId, orgAcme.id);
  assert.strictEqual(switchOrg.body.role, "org_admin");
  const aliceAcmeToken = switchOrg.body.token;
  console.log("✓ Alice successfully switched active organization context to Org Acme");

  // ── Step 8: Org Admin Generates Invitation Code ──
  console.log("--> Step 8: Alice generates team invitation code for Org Acme");
  const createInv = await request(`/api/orgs/${orgAcme.id}/invitations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${aliceAcmeToken}` },
    body: JSON.stringify({ role_to_assign: "member", expiresInHours: 24 }),
  });
  assert.strictEqual(createInv.status, 201, `Invitation creation failed: ${JSON.stringify(createInv.body)}`);
  const inviteCode = createInv.body.invitation.code;
  assert(inviteCode, "Invitation code must exist");
  console.log(`✓ Invitation code generated: ${inviteCode}`);

  // ── Step 9: Invited User Signup (Direct Join, Skip Personal Org) ──
  console.log("--> Step 9: Bob signs up using invitation code");
  const bobEmail = `bob_${timestamp}@acme.com`;
  const bobSignup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: bobEmail,
      password: "password1234",
      displayName: "Bob",
      invitationCode: inviteCode,
    }),
  });
  assert.strictEqual(bobSignup.status, 201, `Bob signup failed: ${JSON.stringify(bobSignup.body)}`);
  assert.strictEqual(bobSignup.body.user.email, bobEmail);
  assert.strictEqual(bobSignup.body.activeOrgId, orgAcme.id, "Bob must join Org Acme directly");
  assert.strictEqual(bobSignup.body.role, "member", "Bob role must match invitation ('member')");
  const bobToken = bobSignup.body.token;
  const bobId = bobSignup.body.user.id;
  console.log("✓ Bob joined Org Acme directly via invite code (personal auto-org skipped as designed)");

  // ── Step 10: Single-Use Invitation Code Enforcement ──
  console.log("--> Step 10: Verify invitation code cannot be reused");
  const eveEmail = `eve_${timestamp}@acme.com`;
  const eveSignup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: eveEmail,
      password: "password1234",
      displayName: "Eve",
      invitationCode: inviteCode,
    }),
  });
  assert.strictEqual(eveSignup.status, 400, "Reused invitation code must be rejected");
  console.log("✓ Re-used invitation code rejected successfully");

  // ── Step 11: Remote Connection REST API & Server-Derived Tenant Fields ──
  console.log("--> Step 11: Connection creation server-derived scoping (anti-spoofing)");
  const createConnRes = await request("/api/providers/connections", {
    method: "POST",
    headers: { Authorization: `Bearer ${aliceAcmeToken}` },
    body: JSON.stringify({
      provider: "anthropic",
      apiKey: "sk-ant-live-e2e-test-key",
      name: `Acme Shared Anthropic Key ${timestamp}`,
      is_org_shared: true,
      // Attempted spoofing:
      owner_user_id: "spoofed-user-id",
      org_id: "spoofed-org-id",
    }),
  });
  assert.strictEqual(createConnRes.status, 201, `Create connection failed: ${JSON.stringify(createConnRes.body)}`);
  const conn = createConnRes.body.connection;
  assert.strictEqual(conn.owner_user_id, aliceId, "owner_user_id MUST be derived from session, not client payload");
  assert.strictEqual(conn.org_id, orgAcme.id, "org_id MUST be derived from session, not client payload");
  assert.strictEqual(Boolean(conn.is_org_shared), true);
  console.log(`✓ Connection created: id=${conn.id}, org=${conn.org_id}, owner=${conn.owner_user_id}`);

  // ── Step 12: Member Visibility within Org Acme ──
  console.log("--> Step 12: Org member visibility of shared connection");
  const bobConns = await request("/api/providers", {
    method: "GET",
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.strictEqual(bobConns.status, 200);
  const foundConn = bobConns.body.connections.find((c) => c.id === conn.id);
  assert(foundConn, "Bob in Org Acme must be able to see the org-shared connection");
  console.log("✓ Org-shared connection is accessible to Org Acme member");

  // ── Step 13: Strict Cross-Tenant Isolation with Org Beta ──
  console.log("--> Step 13: Cross-tenant isolation verification with Org Beta");
  const createOrgBeta = await request("/api/orgs", {
    method: "POST",
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      name: `Beta Corp ${timestamp}`,
      plan_tier: "standard",
    }),
  });
  assert.strictEqual(createOrgBeta.status, 201);
  const orgBeta = createOrgBeta.body.organization;

  // Solo Charlie in Org Beta
  const charlieEmail = `charlie_${timestamp}@beta.com`;
  const charlieSignup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: charlieEmail, password: "password1234", displayName: "Charlie" }),
  });
  assert.strictEqual(charlieSignup.status, 201);
  const charlieId = charlieSignup.body.user.id;

  // Add Charlie to Beta
  await request(`/api/orgs/${orgBeta.id}/members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ userId: charlieId, role: "org_admin" }),
  });

  // Charlie switches to Org Beta
  const charlieSwitch = await request("/api/auth/org/switch", {
    method: "POST",
    headers: { Authorization: `Bearer ${charlieSignup.body.token}` },
    body: JSON.stringify({ orgId: orgBeta.id }),
  });
  const charlieBetaToken = charlieSwitch.body.token;

  // Charlie creates connection in Org Beta
  const charlieConn = await request("/api/providers/connections", {
    method: "POST",
    headers: { Authorization: `Bearer ${charlieBetaToken}` },
    body: JSON.stringify({
      provider: "anthropic",
      apiKey: "sk-ant-charlie-key",
      name: `Charlie Beta Key ${timestamp}`,
      is_org_shared: true,
    }),
  });
  assert.strictEqual(charlieConn.status, 201);

  // Assert Charlie in Org Beta CANNOT see Acme connection
  const charlieList = await request("/api/providers", {
    method: "GET",
    headers: { Authorization: `Bearer ${charlieBetaToken}` },
  });
  const charlieVisibleIds = charlieList.body.connections.map((c) => c.id);
  assert(!charlieVisibleIds.includes(conn.id), "Charlie in Org Beta must NEVER see Org Acme connections");

  // Assert Alice in Org Acme CANNOT see Beta connection
  const aliceList = await request("/api/providers", {
    method: "GET",
    headers: { Authorization: `Bearer ${aliceAcmeToken}` },
  });
  const aliceVisibleIds = aliceList.body.connections.map((c) => c.id);
  assert(!aliceVisibleIds.includes(charlieConn.body.connection.id), "Alice in Org Acme must NEVER see Org Beta connections");

  console.log("✓ Cross-tenant connection isolation confirmed: 0% leakage between Org Acme and Org Beta");

  // ── Step 14: Clean up test connections & organizations ──
  console.log("--> Step 14: Cleanup test data via Superadmin");
  await request(`/api/providers/${conn.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${superToken}` },
  });
  await request(`/api/providers/${charlieConn.body.connection.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${superToken}` },
  });
  await request(`/api/orgs/${orgAcme.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${superToken}` },
  });
  await request(`/api/orgs/${orgBeta.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${superToken}` },
  });
  console.log("✓ Test cleanup completed");

  console.log(`\n======================================================`);
  console.log(`🎉 ALL LIVE END-TO-END MULTI-TENANCY TESTS PASSED!`);
  console.log(`======================================================\n`);
}

runLiveTests().catch((err) => {
  console.error("❌ Live test failure:", err);
  process.exit(1);
});
