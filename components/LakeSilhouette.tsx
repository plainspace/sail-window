import { loadLakePolygon } from '@/lib/geometry'
import { projectToSvg } from '@/lib/projection'

const W = 92
const H = 168

// Small piece of page identity: the real outline of Lake Dunmore with one
// arrow for the current or next window's wind. Furniture, not a data panel.
export function LakeSilhouette({
  fromDeg,
  cardinal,
  windKt,
}: {
  fromDeg: number
  cardinal: string
  windKt: number
}) {
  const { path } = projectToSvg(loadLakePolygon(), W, H)
  // NWS reports where wind comes FROM; the arrow shows where it is going.
  const motion = fromDeg + 180

  return (
    <figure className="silhouette">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Lake Dunmore outline, wind from the ${cardinal} at ${Math.round(windKt)} knots`}
      >
        <path d={path} className="lake-fill" />
        <g transform={`translate(${W / 2}, ${H / 2}) rotate(${motion})`} className="lake-arrow">
          <line x1="0" y1="16" x2="0" y2="-16" />
          <path d="M0,-22 L7,-10 L-7,-10 Z" />
        </g>
      </svg>
      <figcaption>
        Wind from the <strong>{cardinal}</strong>
      </figcaption>
    </figure>
  )
}
