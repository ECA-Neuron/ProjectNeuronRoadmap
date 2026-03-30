import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/auth/signin",
  },
});

export const config = {
  // Protect every app page except auth, api, static, and the landing page
  matcher: [
    "/dashboard/:path*",
    "/my-dashboard/:path*",
    "/overview/:path*",
    "/roadmap/:path*",
    "/burndown/:path*",
    "/workstreams/:path*",
    "/deliverables/:path*",
    "/partners/:path*",
    "/people/:path*",
    "/docs/:path*",
    "/admin/:path*",
    "/features/:path*",
    "/goals/:path*",
    "/issues/:path*",
    "/open-issues/:path*",
    "/cost/:path*",
    "/assignments/:path*",
    "/resources/:path*",
  ],
};
