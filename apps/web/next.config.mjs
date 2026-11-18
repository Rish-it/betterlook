/** @type {import('next').NextConfig} */
export default {
  agentRules: false,
  devIndicators: false,
  outputFileTracingIncludes: {'/*': ['./supabase-ca.crt']},
  experimental: {optimizePackageImports: ['@astryxdesign/core']},
};
