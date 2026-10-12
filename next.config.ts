import type { NextConfig } from "next";
import { assertRequiredSecrets } from "./lib/requiredSecrets";

// Never run or deploy unlocked: dev, build (so a Vercel deploy fails) and start all stop here
// with a clear error if DASHBOARD_PASSWORD or CRON_SECRET is empty. (.env.local is loaded before this file.)
assertRequiredSecrets();

// Gemini reads context/*.md at runtime, so every route that can run a pipeline step
// (cron routes, admin routes, and pages whose admin buttons start a run) must ship them.
const ctx = ["./context/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/": ctx,
    "/coverage": ctx,
    "/papers": ctx,
    "/topics": ctx,
    "/shortlist": ctx,
    "/api/daily": ctx,
    "/api/weekly": ctx,
    "/api/admin/run-daily": ctx,
    "/api/admin/make-brief": ctx,
  },
};

export default nextConfig;
