/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['dl.airtable.com', 'v5.airtableusercontent.com', 'www.dropbox.com'],
  },
  // Treat ffmpeg packages as external — they contain native binaries and
  // must not be bundled by webpack. Vercel will load them at runtime.
  serverExternalPackages: ['fluent-ffmpeg', 'ffmpeg-static'],
}

module.exports = nextConfig
