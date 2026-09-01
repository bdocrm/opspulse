import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { matchRouteRule } from "@/lib/permissions";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Look up the shared, centralized route rule. No matching rule means the
    // path is not role-protected (auth on /api/... is handled by matcher).
    const rule = matchRouteRule(pathname);
    if (rule && token && !rule.roles.includes(token.role as never)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/campaigns/:path*",
    "/agents/:path*",
    "/collector/:path*",
    "/performance/:path*",
    "/production-monitoring/:path*",
    "/manage-campaigns/:path*",
    "/manage-users/:path*",
    "/manage-agents/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/api/((?!auth|dev).*)",
  ],
};
