/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
    ],
  },
  // Linting is handled by the root `npm run lint`. Skip the Next-bundled
  // ESLint pass during `next build` so we don't need a duplicate config here.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
