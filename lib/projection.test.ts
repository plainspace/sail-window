import { describe, it, expect } from 'vitest'
import { loadLakePolygon } from './geometry'
import { projectToSvg } from './projection'

const poly = loadLakePolygon('lake-dunmore.json')!

describe('projectToSvg', () => {
  const { path, project } = projectToSvg(poly, 300, 500)

  it('produces a closed SVG path', () => {
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('keeps every projected point inside the viewport', () => {
    for (const ll of poly) {
      const [x, y] = project(ll)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(300)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(500)
    }
  })

  it('puts north at the top, so higher latitude means smaller y', () => {
    const lats = poly.map((p) => p[1])
    const north = poly.find((p) => p[1] === Math.max(...lats))!
    const south = poly.find((p) => p[1] === Math.min(...lats))!
    expect(project(north)[1]).toBeLessThan(project(south)[1])
  })
})
