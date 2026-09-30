import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { registerUserWithBootstrapping } from "@/lib/db/repos/usersRepo.js";
import { setDashboardAuthCookie, createDashboardAuthToken } from "@/lib/auth/dashboardSession";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password, displayName, invitationCode } = body || {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    let registration;
    try {
      registration = await registerUserWithBootstrapping({
        email,
        password,
        displayName,
        invitationCode,
        authSource: "local",
      });
    } catch (err) {
      if (err.code === "USER_EXISTS") {
        return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      }
      if (err.code === "INVITATION_NOT_FOUND") {
        return NextResponse.json({ error: "Invalid invitation code" }, { status: 404 });
      }
      if (err.code === "INVITATION_ALREADY_USED" || err.code === "INVITATION_EXPIRED") {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const { user, activeOrgId, role } = registration;

    const claims = {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      activeOrgId,
      role,
    };

    let token = null;
    try {
      const cookieStore = await cookies();
      token = await setDashboardAuthCookie(cookieStore, request, claims);
    } catch {
      token = await createDashboardAuthToken(claims);
    }

    return NextResponse.json(
      {
        success: true,
        user: { id: user.id, email: user.email, displayName: user.display_name },
        activeOrgId,
        role,
        token,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create account" }, { status: 500 });
  }
}
