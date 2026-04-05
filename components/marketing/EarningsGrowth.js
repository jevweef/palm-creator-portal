'use client'
import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { motion, useInView, animate } from 'framer-motion'

/* ─── Chart dimensions ─── */
const W = 800, H = 320
const P = { t: 30, r: 60, b: 55, l: 15 }
const cW = W - P.l - P.r, cH = H - P.t - P.b
const PALM_DAY = 91, TOTAL_DAYS = 182

/* ─── Palm colors (converted from the blue) ─── */
const C = {
  line: '#E88FAC',
  fillTop: 'rgba(232,143,172,0.25)',
  fillBot: 'rgba(232,143,172,0.02)',
  divider: 'rgba(232,143,172,0.45)',
  text: '#1a1a1a',
  muted: '#999',
  grid: 'rgba(0,0,0,0.06)',
  green: '#34C759',
  white: '#ffffff',
}

/* ─── Seeded RNG (same chart every render) ─── */
function rng(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

/* ─── Generate fake earnings data ─── */
function makeData() {
  const r = rng(42)
  const pts = []
  for (let i = 0; i < TOTAL_DAYS; i++) {
    let v
    if (i < PALM_DAY) {
      v = 25 + r() * 55
      if (r() > 0.93) v += 40 + r() * 60
    } else {
      const p = (i - PALM_DAY) / (TOTAL_DAYS - PALM_DAY)
      v = Math.max(20, 60 + p * 300 + (r() - 0.3) * 130)
      if (r() > 0.85) v *= 1.4 + r() * 0.7
    }
    pts.push(Math.round(v * 100) / 100)
  }
  return pts
}

/* ─── SVG coordinate helpers ─── */
const px = (i, len) => P.l + (i / (len - 1)) * cW
const py = (v, max) => P.t + cH - (v / max) * cH

function linePath(pts, max) {
  return pts.map((v, i) =>
    `${i ? 'L' : 'M'}${px(i, pts.length).toFixed(1)},${py(v, max).toFixed(1)}`
  ).join('')
}

function areaPath(pts, max) {
  const base = P.t + cH
  return linePath(pts, max) + `L${(P.l + cW).toFixed(1)},${base}L${P.l},${base}Z`
}

/* ─── Date formatter ─── */
function dateForDay(i) {
  const d = new Date(2024, 10, 3)
  d.setDate(d.getDate() + i)
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

/* ─── Animated counter ─── */
function Counter({ to, duration = 2.5, delay = 0.3, go, prefix = '$', suffix = '' }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!go) return
    const ctrl = animate(0, to, { duration, delay, ease: 'easeOut', onUpdate: setV })
    return () => ctrl.stop()
  }, [go, to, duration, delay])
  return <>{prefix}{Math.round(v).toLocaleString('en-US')}{suffix}</>
}

/* ═══════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════ */
export default function EarningsGrowth() {
  const ref = useRef(null)
  const svgRef = useRef(null)
  const go = useInView(ref, { once: true, margin: '-80px' })
  const [hover, setHover] = useState(null)

  const data = useMemo(makeData, [])
  const max = useMemo(() => Math.max(...data) * 1.12, [data])
  const total = useMemo(() => data.reduce((a, b) => a + b, 0), [data])
  const beforeTotal = useMemo(() => data.slice(0, PALM_DAY).reduce((a, b) => a + b, 0), [data])
  const afterTotal = useMemo(() => data.slice(PALM_DAY).reduce((a, b) => a + b, 0), [data])
  const growthPct = Math.round(((afterTotal / beforeTotal) - 1) * 100)

  const palmX = px(PALM_DAY, data.length)

  /* Y-axis */
  const yTop = Math.ceil(max / 200) * 200
  const ySteps = []
  for (let v = 200; v <= yTop; v += 200) ySteps.push(v)

  /* X-axis */
  const xLabels = [
    { lines: ['Nov 03,', '2024'], pos: 0 },
    { lines: ['Dec 18,', '2024'], pos: 0.25 },
    { lines: ['Feb 01,', '2025'], pos: 0.5 },
    { lines: ['Mar 18,', '2025'], pos: 0.75 },
    { lines: ['May 02,', '2025'], pos: 1 },
  ]

  /* Hover tracking */
  const onMove = useCallback((e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((mx - P.l) / cW) * (data.length - 1))
    if (i < 0 || i >= data.length) { setHover(null); return }
    setHover({
      i,
      cx: px(i, data.length),
      cy: py(data[i], max),
      value: data[i],
      date: dateForDay(i),
    })
  }, [data, max])

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

  /* Tooltip positioning (clamp to edges, flip if near top) */
  const tt = hover ? (() => {
    const tx = Math.max(75, Math.min(hover.cx, W - 75))
    const above = hover.cy > 90
    const ty = above ? hover.cy - 56 : hover.cy + 18
    return { x: tx, y: ty }
  })() : null

  return (
    <div ref={ref} style={{
      background: C.white,
      borderRadius: 16,
      padding: '28px 32px 20px',
      maxWidth: 860,
      margin: '0 auto',
      boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      border: '1px solid #F0D0D8',
      fontFamily: font,
      position: 'relative',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 16,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
          Nov 03, 2024 – May 02, 2025
        </span>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
          <Counter to={Math.round(total)} duration={2.8} delay={0.3} go={go} />
        </span>
      </div>

      {/* ── SVG Chart ── */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => {
          const touch = e.touches[0]
          if (touch) onMove({ clientX: touch.clientX, clientY: touch.clientY })
        }}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id="palmAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.fillTop} />
            <stop offset="100%" stopColor={C.fillBot} />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {ySteps.map(v => (
          <line key={v} x1={P.l} x2={P.l + cW}
            y1={py(v, max)} y2={py(v, max)}
            stroke={C.grid} strokeWidth={1} />
        ))}

        {/* Area fill */}
        <motion.path
          d={areaPath(data, max)}
          fill="url(#palmAreaFill)"
          initial={{ opacity: 0 }}
          animate={go ? { opacity: 1 } : {}}
          transition={{ duration: 1.2, delay: 1.0 }}
        />

        {/* Main line */}
        <motion.path
          d={linePath(data, max)}
          fill="none"
          stroke={C.line}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={go ? { pathLength: 1 } : {}}
          transition={{ duration: 2.8, delay: 0.3, ease: [0.4, 0, 0.2, 1] }}
        />

        {/* "Joined Palm" divider */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={go ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 1.5 }}
        >
          <line x1={palmX} x2={palmX} y1={P.t} y2={P.t + cH}
            stroke={C.divider} strokeWidth={1.5} strokeDasharray="6,4" />
          <text x={palmX} y={P.t - 10} textAnchor="middle"
            fill={C.line} fontSize={11} fontWeight={600} fontFamily={font}>
            Joined Palm
          </text>
        </motion.g>

        {/* Y-axis labels (right side, like screenshot) */}
        {ySteps.map(v => (
          <text key={v} x={P.l + cW + 8} y={py(v, max) + 4}
            fill={C.muted} fontSize={11} fontFamily={font}>
            ${v}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map(({ lines, pos }, idx) => (
          <text key={idx} x={P.l + pos * cW} y={H - 20}
            textAnchor="middle" fill={C.muted} fontSize={11} fontFamily={font}>
            {lines.map((line, li) => (
              <tspan key={li} x={P.l + pos * cW} dy={li === 0 ? 0 : 14}>{line}</tspan>
            ))}
          </text>
        ))}

        {/* ── Hover tooltip ── */}
        {hover && tt && (
          <g>
            {/* Vertical guide line */}
            <line x1={hover.cx} x2={hover.cx} y1={P.t} y2={P.t + cH}
              stroke="rgba(0,0,0,0.08)" strokeWidth={1} />

            {/* Dot on line */}
            <circle cx={hover.cx} cy={hover.cy} r={5}
              fill={C.line} stroke={C.white} strokeWidth={2.5} />

            {/* Tooltip card */}
            <g>
              <rect x={tt.x - 72} y={tt.y} width={144} height={46} rx={8}
                fill={C.white} stroke="rgba(0,0,0,0.08)" strokeWidth={1}
                style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }} />

              {/* Date */}
              <text x={tt.x} y={tt.y + 18} textAnchor="middle"
                fill={C.text} fontSize={11.5} fontWeight={600} fontFamily={font}>
                {hover.date}
              </text>

              {/* Dot + Total + Value */}
              <circle cx={tt.x - 50} cy={tt.y + 34} r={3.5} fill={C.line} />
              <text x={tt.x - 42} y={tt.y + 37.5}
                fill={C.muted} fontSize={11} fontFamily={font}>
                Total
              </text>
              <text x={tt.x + 62} y={tt.y + 37.5} textAnchor="end"
                fill={C.text} fontSize={11} fontWeight={600} fontFamily={font}>
                ${hover.value.toFixed(2)}
              </text>
            </g>
          </g>
        )}
      </svg>

      {/* ── Growth badge ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 6 }}
        animate={go ? { opacity: 1, scale: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay: 2.9, ease: [0.34, 1.56, 0.64, 1] }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginTop: 14, padding: '6px 14px',
          background: 'rgba(52,199,89,0.1)', borderRadius: 20,
          fontSize: 13, fontWeight: 600, color: C.green,
        }}
      >
        ↑ <Counter to={growthPct} duration={0.8} delay={3.0} go={go} prefix="" />% growth after Palm
      </motion.div>
    </div>
  )
}
