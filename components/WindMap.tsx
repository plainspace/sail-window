import { loadLakePolygon } from '@/lib/geometry'
import { projectToSvg } from '@/lib/projection'

const W = 260
const H = 460

export function WindMap({
  bearingDeg,
  windKt,
  cardinal,
  fetchMi,
}: {
  bearingDeg: number
  windKt: number
  cardinal: string
  fetchMi: number
}) {
  const { path } = projectToSvg(loadLakePolygon(), W, H)
  // NWS reports the direction wind comes FROM. Motion points the opposite way.
  const motion = bearingDeg + 180
  const arrows: [number, number][] = []
  for (let x = 20; x < W; x += 42) for (let y = 20; y < H; y += 42) arrows.push([x, y])

  return (
    <figure className="map">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
           aria-label={`Lake Dunmore, wind from the ${cardinal} at ${Math.round(windKt)} knots`}>
        <defs>
          <clipPath id="lake"><path d={path} /></clipPath>
        </defs>
        <path d={path} className="water" />
        <g clipPath="url(#lake)" className="arrows">
          {arrows.map(([x, y]) => (
            <g key={`${x}-${y}`} transform={`translate(${x},${y}) rotate(${motion})`}>
              <line x1="0" y1="7" x2="0" y2="-7" />
              <path d="M0,-9 L3,-4 L-3,-4 Z" />
            </g>
          ))}
        </g>
      </svg>
      <figcaption>
        Wind from the <strong>{cardinal}</strong> at {Math.round(windKt)} kt ·
        fetch {fetchMi.toFixed(1)} mi
        <br />
        <span className="quiet">
          One NWS reading covers the whole lake, so the arrows do not vary. The fetch line length is
          the real derived value. Lake outline: OpenStreetMap contributors, ODbL.
        </span>
      </figcaption>
    </figure>
  )
}
