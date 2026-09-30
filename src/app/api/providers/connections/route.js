import { GET as getProviders, POST as createProvider } from "../route.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return getProviders(request);
}

export async function POST(request) {
  return createProvider(request);
}
