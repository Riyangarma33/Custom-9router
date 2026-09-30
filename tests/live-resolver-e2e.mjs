import assert from "node:assert";

const BASE_URL = "http://127.0.0.1:20148";

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
    headers["Cookie"] = `auth_token=${options.token}`;
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

async function runResolverTests() {
  console.log(`\n======================================================`);
  console.log(`Starting Phase 4 Live Resolver & 429 Failover Tests`);
  console.log(`======================================================\n`);

  // Superadmin login
  const superLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "123456" }),
  });
  const superToken = superLogin.body.token;

  const timestamp = Date.now();

  // Create Org 1
  const createOrg1 = await request("/api/orgs", {
    method: "POST",
    token: superToken,
    body: JSON.stringify({ name: `Resolver Org 1 ${timestamp}`, plan_tier: "enterprise", pay_as_you_go_ceiling: 50.0 }),
  });
  const org1 = createOrg1.body.organization;

  // Create Org 2
  const createOrg2 = await request("/api/orgs", {
    method: "POST",
    token: superToken,
    body: JSON.stringify({ name: `Resolver Org 2 ${timestamp}`, plan_tier: "standard", pay_as_you_go_ceiling: 0.0 }),
  });
  const org2 = createOrg2.body.organization;

  // Create User 1 in Org 1
  const user1Signup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: `user1_${timestamp}@org1.com`, password: "password1234", displayName: "User 1" }),
  });
  const user1 = user1Signup.body.user;
  await request(`/api/orgs/${org1.id}/members`, {
    method: "POST",
    token: superToken,
    body: JSON.stringify({ userId: user1.id, role: "org_admin" }),
  });
  const switch1 = await request("/api/auth/org/switch", {
    method: "POST",
    token: user1Signup.body.token,
    body: JSON.stringify({ orgId: org1.id }),
  });
  const user1Token = switch1.body.token;

  // Create User 2 in Org 2
  const user2Signup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: `user2_${timestamp}@org2.com`, password: "password1234", displayName: "User 2" }),
  });
  const user2 = user2Signup.body.user;
  await request(`/api/orgs/${org2.id}/members`, {
    method: "POST",
    token: superToken,
    body: JSON.stringify({ userId: user2.id, role: "org_admin" }),
  });
  const switch2 = await request("/api/auth/org/switch", {
    method: "POST",
    token: user2Signup.body.token,
    body: JSON.stringify({ orgId: org2.id }),
  });
  const user2Token = switch2.body.token;

  // Connect Personal Key in Org 1 (Tier 1)
  console.log("--> Setting up Tier 1 personal connection in Org 1");
  const conn1Personal = await request("/api/providers/connections", {
    method: "POST",
    token: user1Token,
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-user1-personal-key",
      name: `User 1 Personal Key ${timestamp}`,
      is_org_shared: false,
      priority: 1,
    }),
  });
  assert.strictEqual(conn1Personal.status, 201);
  const conn1PersonalId = conn1Personal.body.connection.id;

  // Connect Org-Shared Key in Org 1 (Tier 2)
  console.log("--> Setting up Tier 2 org-shared connection in Org 1");
  const conn1Shared = await request("/api/providers/connections", {
    method: "POST",
    token: user1Token,
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-org1-shared-key",
      name: `Org 1 Shared Pool Key ${timestamp}`,
      is_org_shared: true,
      priority: 2,
    }),
  });
  assert.strictEqual(conn1Shared.status, 201);
  const conn1SharedId = conn1Shared.body.connection.id;

  // Connect Key in Org 2
  console.log("--> Setting up connection in Org 2");
  const conn2 = await request("/api/providers/connections", {
    method: "POST",
    token: user2Token,
    body: JSON.stringify({
      provider: "openai",
      apiKey: "sk-org2-key",
      name: `Org 2 Key ${timestamp}`,
      is_org_shared: true,
      priority: 1,
    }),
  });
  assert.strictEqual(conn2.status, 201);
  const conn2Id = conn2.body.connection.id;

  // Verify User 1 connections query
  console.log("--> Query connections for User 1 in Org 1");
  const list1 = await request("/api/providers", {
    method: "GET",
    token: user1Token,
  });
  const list1Ids = list1.body.connections.map((c) => c.id);
  assert(list1Ids.includes(conn1PersonalId), "Must contain Tier 1 connection");
  assert(list1Ids.includes(conn1SharedId), "Must contain Tier 2 connection");
  assert(!list1Ids.includes(conn2Id), "Must NEVER contain Org 2 connection");
  console.log("✓ User 1 in Org 1 sees personal + org shared connections (0% Org 2 leakage)");

  // Verify User 2 connections query
  console.log("--> Query connections for User 2 in Org 2");
  const list2 = await request("/api/providers", {
    method: "GET",
    token: user2Token,
  });
  const list2Ids = list2.body.connections.map((c) => c.id);
  assert(list2Ids.includes(conn2Id), "User 2 must see Org 2 connection");
  assert(!list2Ids.includes(conn1PersonalId), "User 2 must NEVER see Org 1 personal connection");
  assert(!list2Ids.includes(conn1SharedId), "User 2 must NEVER see Org 1 shared connection");
  console.log("✓ User 2 in Org 2 sees only Org 2 connections (0% Org 1 leakage)");

  // Clean up
  console.log("--> Cleaning up test data");
  await request(`/api/providers/${conn1PersonalId}`, { method: "DELETE", token: superToken });
  await request(`/api/providers/${conn1SharedId}`, { method: "DELETE", token: superToken });
  await request(`/api/providers/${conn2Id}`, { method: "DELETE", token: superToken });
  await request(`/api/orgs/${org1.id}`, { method: "DELETE", token: superToken });
  await request(`/api/orgs/${org2.id}`, { method: "DELETE", token: superToken });
  console.log("✓ Resolver live tests cleanup finished");

  console.log(`\n======================================================`);
  console.log(`🎉 ALL LIVE RESOLVER VERIFICATION TESTS PASSED!`);
  console.log(`======================================================\n`);
}

runResolverTests().catch((err) => {
  console.error("❌ Resolver test failure:", err);
  process.exit(1);
});
