import { NextRequest, NextResponse } from "next/server";

const ENV_KEY_VARS = [
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "PRODUCTBOARD_API_TOKEN",
  "ATTENTION_API_KEY",
  "PENDO_INTEGRATION_KEY",
  "AMPLITUDE_API_KEY",
  "ATLASSIAN_API_TOKEN",
  "LINEAR_API_KEY",
];

function hasAnyEnvKey(): boolean {
  return ENV_KEY_VARS.some((v) => !!process.env[v]);
}

function getExpectedCredentials(): { username: string; password: string } | null {
  const password = process.env.APP_BASIC_AUTH_PASSWORD || process.env.BASIC_AUTH_PASSWORD;
  if (!password) return null;

  return {
    username: process.env.APP_BASIC_AUTH_USERNAME || process.env.BASIC_AUTH_USERNAME || "viewer",
    password,
  };
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Feedback Agent", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function authMisconfigured(): NextResponse {
  return new NextResponse(
    "Configuration error: API keys are set in environment variables but APP_BASIC_AUTH_PASSWORD is not configured. " +
    "Set APP_BASIC_AUTH_PASSWORD to protect your credentials, or remove all API keys from the environment to run in demo-only mode.",
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

export function middleware(req: NextRequest) {
  const expected = getExpectedCredentials();

  if (!expected) {
    if (hasAnyEnvKey()) return authMisconfigured();
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) return unauthorized();

  try {
    const encoded = authHeader.slice("Basic ".length).trim();
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return unauthorized();

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (username !== expected.username || password !== expected.password) {
      return unauthorized();
    }

    return NextResponse.next();
  } catch {
    return unauthorized();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
