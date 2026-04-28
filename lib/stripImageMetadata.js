import sharp from 'sharp'

// Re-encode an image buffer to strip metadata. sharp drops EXIF, ICC,
// IPTC, XMP, and C2PA / Content Credentials manifests by default
// (we omit .withMetadata() and .keepIccProfile()).
//
// What this DOES NOT remove: Google's SynthID is embedded in the pixel
// values themselves, not in metadata. It survives re-encoding. Only
// Google's detector can spot it.
export async function stripImageMetadata(buffer, ext = 'jpg') {
  const fmt = ext.toLowerCase()
  let pipeline = sharp(buffer).rotate() // bake in EXIF orientation, then drop

  if (fmt === 'png') {
    return pipeline.png({ compressionLevel: 9 }).toBuffer()
  }
  if (fmt === 'webp') {
    return pipeline.webp({ quality: 95 }).toBuffer()
  }
  // default jpeg
  return pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer()
}
