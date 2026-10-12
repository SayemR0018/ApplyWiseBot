import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers declare `runtime = "nodejs"` + `maxDuration`, which cacheComponents doesn't allow.
  cacheComponents: false,
  serverExternalPackages: ["unpdf", "mammoth"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
