'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  sky: 'clear' | 'partly' | 'cloudy' | 'unknown'
  precipPct: number
  precipFail: boolean
  hr: string
  title: string
}

export type DotState = 'window' | 'hour' | 'none'
export type DayGroup = {
  key: string
  chip: string
  full: string
  dot: DotState
  cols: Col[]
}

const dotAria: Record<DotState, string> = {
  window: 'sailable window',
  hour: 'isolated good hours but no window',
  none: 'nothing sailable',
}

const SCALE_MAX = 25
// x position (px from the viewport's left edge) that defines the "left edge" of the
// strip, just right of the pinned axis. Used for both scroll targeting and the
// active-day IntersectionObserver.
const EDGE = 44

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

export function WindStripView({ days }: { days: DayGroup[] }) {
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
            className={`day-chip${active === d.key ? ' is-active' : ''}`}
            aria-current={active === d.key ? 'true' : undefined}
            aria-label={`${d.full}, ${dotAria[d.dot]}`}
            onClick={() => scrollToDay(d.key)}
          >
            <span className={`day-dot dot-${d.dot}`} aria-hidden="true" />
            <span className="day-chip-label">{d.chip}</span>
          </button>
        ))}
      </nav>

      <div className="strip-scroll">
        <div className="strip-axis" aria-hidden="true">
          <span style={{ bottom: `${(20 / SCALE_MAX) * 100}%` }}>20</span>
          <span style={{ bottom: `${(7 / SCALE_MAX) * 100}%` }}>7</span>
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
          <div className="strip-inner">
            {days.map((d) => (
              <div className="day" key={d.key} data-day={d.key} ref={setDayRef(d.key)}>
                <div className="day-label">{d.key}</div>
                <div className="day-cols">
                  {d.cols.map((c) => (
                    <div
                      className={`col sky-${c.sky} ${c.pass ? 'is-pass' : 'is-fail'}${c.dark ? ' is-dark' : ''}`}
                      key={c.iso}
                      title={c.title}
                    >
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
