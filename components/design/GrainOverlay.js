"use client";

export default function GrainOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-hidden="true">
      <svg className="hidden">
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>
      </svg>
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{ filter: "url(#grain)" }}
      />
    </div>
  );
}
