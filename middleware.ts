import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // CEO-only routes
    const ceoRoutes = ["/api/users", "/manage-campaigns"];
    const isCEORoute = ceoRoutes.some((r) => pathname.startsWith(r));

    if (isCEORoute && token?.role !== "CEO") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // COLLECTOR-only routes
    const collectorRoutes = ["/collector", "/api/collectors"];
    const isCollectorRoute = collectorRoutes.some((r) => pathname.startsWith(r));

    if (isCollectorRoute && token?.role !== "COLLECTOR") {
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
    "/manage-campaigns/:path*",
    "/settings/:path*",
    "/api/((?!auth|dev).*)",
  ],
};
