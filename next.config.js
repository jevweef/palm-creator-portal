/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['dl.airtable.com', 'v5.airtableusercontent.com', 'www.dropbox.com'],
  },
  // Prevent webpack from bundling ffmpeg packages — they contain native binaries
  // that must be loaded from node_modules at runtime, not embedded in chunks.
  serverExternalPackages: ['fluent-ffmpeg', 'ffmpeg-static'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'ffmpeg-static', 'fluent-ffmpeg']
    }
    return config
  },
}

module.exports = nextConfig
