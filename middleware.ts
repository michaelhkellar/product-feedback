import { NextRequest, NextResponse } from "next/server";

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

export function middleware(req: NextRequest) {
  const expected = getExpectedCredentials();
  if (!expected) return NextResponse.next();

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
