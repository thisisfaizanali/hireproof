import { NextResponse, type NextRequest } from "next/server";

// Sends visitors without a session cookie to the login page. This is only a
// shortcut: whether the cookie is valid is decided by the API.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("hp_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
