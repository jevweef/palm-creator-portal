// Centralized config for the AI Super Clone reference-image flow.
// Three poses, two WaveSpeed models. Prompts hard-coded per the contact's
// guidance; bikini color = black, face prompt has the "half body close-up"
// qualifier appended.

export const POSES = {
  front: {
    key: 'front',
    label: 'Front View',
    fileLabel: 'Front View',
    model: 'alibaba/wan-2.7/image-edit',
    modelLabel: 'Wan 2.7',
    prompt:
      'Exact same woman as in the reference images, wearing a black micro bikini, front three-quarter body view, standing pose with hands relaxed, confident posture, soft studio lighting, clean light gray seamless background, hyper realistic photography, ultra detailed skin texture, best quality, 8k, sharp focus, cinematic lighting, masterpiece, photorealistic',
    extraParams: { size: '1080*1920', seed: -1 },
    airtableOutputField: 'AI Ref Front',
  },
  back: {
    key: 'back',
    label: 'Back View',
    fileLabel: 'Back View',
    model: 'alibaba/wan-2.7/image-edit',
    modelLabel: 'Wan 2.7',
    prompt:
      'Exact same woman as in the reference images, wearing a black micro bikini, rear full body view, standing straight with hands at sides, elegant posture, soft even studio lighting highlighting her figure, clean light gray seamless background, hyper realistic, ultra detailed skin, best quality, 8k resolution, sharp focus, photorealistic, masterpiece',
    extraParams: { size: '1080*1920', seed: -1 },
    airtableOutputField: 'AI Ref Back',
  },
  face: {
    key: 'face',
    label: 'Close Up Face',
    fileLabel: 'Close Up Face',
    model: 'google/nano-banana-2/edit',
    modelLabel: 'Nano Banana 2',
    prompt:
      'Exact same woman as in the reference images, extreme close-up portrait of her face and shoulders, neutral expression, direct gaze, soft diffused studio lighting, clean light gray background, hyper realistic photography, ultra detailed skin texture and pores, best quality, 8k, razor sharp focus on eyes, cinematic, masterpiece, photorealistic, angle should be a half body pic, close up',
    extraParams: { aspect_ratio: '9:16', resolution: '4k', output_format: 'jpeg' },
    airtableOutputField: 'AI Ref Face',
  },
}

export const AI_REF_FOLDER = (aka) => `/Palm Ops/Creators/${aka}/ai_reference`

// Files in the shared AI Ref Inputs Airtable field carry a pose-prefixed
// filename — Front View input_1.jpg, Back View input_2.png, etc. The UI
// filters by prefix.
export function inputFilename(pose, index, ext) {
  return `${POSES[pose].fileLabel} input_${index}.${ext.replace(/^\./, '')}`
}

export function outputFilename(pose, ext = 'jpg') {
  return `${POSES[pose].fileLabel} AI Reference.${ext.replace(/^\./, '')}`
}

export function poseFromFilename(name) {
  if (!name) return null
  for (const pose of Object.values(POSES)) {
    if (name.startsWith(pose.fileLabel + ' input_') || name.startsWith(pose.fileLabel + ' AI Reference')) {
      return pose.key
    }
  }
  return null
}
