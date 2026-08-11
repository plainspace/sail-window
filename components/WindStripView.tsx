'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { OverlayScrollbarsComponent } from './overlay-scrollbars-component'

export type Col = {
  iso: string
  windRounded: number
  fromDeg: number
  barPct: number
  gustPct: number
  showGust: boolean
  pass: boolean
  dark: boolean
  speed: string
  sky: 'clear' | 'mostly-clear' | 'partly' | 'cloudy' | 'unknown'
  precipPct: number
  precipFail: boolean
  hr: string
  title: string
}

export type DotState = 'window' | 'marginal' | 'hour' | 'none'
export type DayGroup = {
  key: string
  chip: string
  full: string
  dot: DotState
  cols: Col[]
}

// The knot scale for the bars, driven by the spot's wind band: `max` is the top of
// the axis, `min`/`hi` are the target-band bounds (the sailable window).
export type Scale = { max: number; min: number; hi: number }

const dotAria: Record<DotState, string> = {
  window: 'sailable window',
  marginal: 'marginal, close to the wind floor but gusting enough to sail',
  hour: 'isolated good hours but no window',
  none: 'nothing sailable',
}

// x position (px from the viewport's left edge) that defines the "left edge" of the
// strip, just right of the pinned axis. Used for both scroll targeting and the
// active-day IntersectionObserver.
const EDGE = 44

// Sky cover as a tiny two-tone glyph: warm sun disc, muted (currentColor) cloud.
// As cover rises the sun shrinks and the cloud grows, so a run of fair weather
// reads warm at a glance without resolving individual icons. aria-hidden ... the
// state is already in the column title. Kept to very few strokes for ~13px.
function Cloud() {
  return (
    <g fill="currentColor">
      <circle cx="5.4" cy="10.2" r="2.1" />
      <circle cx="8" cy="8.7" r="2.8" />
      <circle cx="10.7" cy="10.2" r="2.1" />
      <rect x="3.3" y="10" width="9.4" height="2.7" rx="1.35" />
    </g>
  )
}

function SkyIcon({ state }: { state: Col['sky'] }) {
  return (
    <svg className={`sky-icon sky-${state}`} viewBox="0 0 16 16" aria-hidden="true">
      {state === 'clear' && <circle className="sun" cx="8" cy="8" r="4.3" />}
      {state === 'mostly-clear' && (
        <>
          <circle className="sun" cx="7.2" cy="6.7" r="3.7" />
          <g transform="translate(3.4 3.6) scale(0.6)">
            <Cloud />
          </g>
        </>
      )}
      {state === 'partly' && (
        <>
          <circle className="sun" cx="5.6" cy="5.9" r="3.1" />
          <Cloud />
        </>
      )}
      {state === 'cloudy' && <Cloud />}
      {state === 'unknown' && (
        <circle
          cx="8"
          cy="8"
          r="3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeDasharray="2 1.8"
        />
      )}
    </svg>
  )
}

// NWS gives the direction wind blows FROM. An arrow depicting motion points to deg + 180.
function DirArrow({ fromDeg }: { fromDeg: number }) {
  return (
    <svg className="dir" viewBox="-6 -6 12 12" aria-hidden="true">
      <g transform={`rotate(${fromDeg + 180})`}>
        <line x1="0" y1="4.5" x2="0" y2="-3.5" />
        <path d="M0,-5 L3,-1 L-3,-1 Z" />
      </g>
    </svg>
  )
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function WindStripView({ days, scale }: { days: DayGroup[]; scale: Scale }) {
  const osRef = useRef<OverlayScrollbarsComponentRef | null>(null)
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // The element OverlayScrollbars actually scrolls (its internal viewport), not the host.
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const [active, setActive] = useState(days[0]?.key ?? '')

  const setDayRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) dayRefs.current.set(key, el)
      else dayRefs.current.delete(key)
    },
    []
  )

  // Scroll the OverlayScrollbars viewport (never the page) so the day lands at the
  // left edge, just past the axis.
  const scrollToDay = useCallback((key: string) => {
    const vp = osRef.current?.osInstance()?.elements().viewport
    const el = dayRefs.current.get(key)
    if (!vp || !el) return
    // Target the snap point exactly (scroll-padding-left is 40) so proximity snapping
    // does not fight the smooth scroll and pull the day off the left edge.
    const left = vp.scrollLeft + (el.getBoundingClientRect().left - vp.getBoundingClientRect().left) - 40
    vp.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  // Active day = the day occupying the left edge of the viewport, which is not the
  // same as the earliest day still intersecting. Picking the lowest-index visible
  // day means a previous day's trailing sliver keeps winning: jump to Friday and
  // Thursday stays highlighted because its last hour is still on screen.
  useEffect(() => {
    if (!viewport) return
    const pick = () => {
      const edge = viewport.getBoundingClientRect().left + EDGE
      let best: string | null = null
      let bestDelta = Infinity
      dayRefs.current.forEach((el, key) => {
        const r = el.getBoundingClientRect()
        if (r.right <= edge) return // scrolled fully past the left edge
        const delta = Math.abs(r.left - edge)
        if (delta < bestDelta) {
          bestDelta = delta
          best = key
        }
      })
      const next = best
      if (next) setActive((prev) => (prev === next ? prev : next))
    }
    pick()
    viewport.addEventListener('scroll', pick, { passive: true })
    return () => viewport.removeEventListener('scroll', pick)
  }, [viewport, days])

  return (
    <>
      <nav
        className="day-nav"
        aria-label="Jump to a day"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`day-chip has-${d.dot}${active === d.key ? ' is-active' : ''}`}
            aria-current={active === d.key ? 'true' : undefined}
            aria-label={`${d.full}, ${dotAria[d.dot]}`}
            onClick={() => scrollToDay(d.key)}
          >
            <span className="day-chip-label">{d.chip}</span>
          </button>
        ))}
      </nav>

      <div className="strip-scroll">
        <div className="strip-axis" aria-hidden="true">
          <span style={{ bottom: `${(scale.hi / scale.max) * 100}%` }}>{scale.hi}</span>
          <span style={{ bottom: `${(scale.min / scale.max) * 100}%` }}>{scale.min}</span>
          <span style={{ bottom: '0' }}>0 kt</span>
        </div>

        <OverlayScrollbarsComponent
          className="strip-os"
          ref={osRef}
          events={{
            initialized: (instance) => {
              const vp = instance.elements().viewport
              // Make the viewport keyboard-focusable so arrow keys scroll it.
              vp.setAttribute('tabindex', '0')
              vp.setAttribute('role', 'group')
              vp.setAttribute('aria-label', 'Hour-by-hour wind forecast. Scroll horizontally.')
              setViewport(vp)
            },
          }}
        >
          <div
            className="strip-inner"
            style={
              {
                // Target band position on the 0-to-max scale, read by .graph::before.
                '--band-bottom': `${(scale.min / scale.max) * 100}%`,
                '--band-height': `${((scale.hi - scale.min) / scale.max) * 100}%`,
              } as CSSProperties
            }
          >
            {days.map((d) => (
              <div className="day" key={d.key} data-day={d.key} ref={setDayRef(d.key)}>
                <div className="day-label">{d.key}</div>
                <div className="day-cols">
                  {d.cols.map((c) => (
                    <div
                      className={`col ${c.pass ? 'is-pass' : 'is-fail'}${c.dark ? ' is-dark' : ''}`}
                      key={c.iso}
                      title={c.title}
                    >
                      <SkyIcon state={c.sky} />
                      <div className="graph">
                        {c.showGust && c.gustPct > c.barPct && (
                          <span
                            className="gust"
                            style={{ bottom: `${c.barPct}%`, height: `${c.gustPct - c.barPct}%` }}
                          />
                        )}
                        <span className={`bar ${c.speed}`} style={{ height: `${c.barPct}%` }} />
                        {c.pass && <span className="pip" aria-hidden="true" />}
                      </div>
                      {/* Precip lane: proportional fill, quiet below 10%, gate colour at 30%+ */}
                      <div className="precip" aria-hidden="true">
                        {c.precipPct >= 10 && (
                          <span
                            className={`precip-fill${c.precipFail ? ' is-gate' : ''}`}
                            style={{ width: `${c.precipPct}%` }}
                          />
                        )}
                      </div>
                      <DirArrow fromDeg={c.fromDeg} />
                      <span className="hr">{c.hr}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </>
  )
}
