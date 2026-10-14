/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.OPSVIEW_BUILD_DIR || ".next",
  experimental: {
    serverComponentsExternalPackages: ["officecrypto-tool"],
    outputFileTracingIncludes: {
      "/api/production-monitoring/smart-import/[id]/unlock": ["./node_modules/officecrypto-tool/**/*", "./node_modules/cfb/**/*", "./node_modules/crypto-js/**/*", "./node_modules/xml2js/**/*", "./node_modules/xmlbuilder/**/*", "./node_modules/sax/**/*"],
    },
  },
  images: {
    remotePatterns: [],
  },
};

module.exports = nextConfig;
