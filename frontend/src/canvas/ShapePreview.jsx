import { SHAPE_ART } from "./shapeGeometry";

const ROUND = new Set(["roundedRectangle", "process", "dfdProcess", "package"]);
const ELLIPSE = new Set([
  "ellipse",
  "usecase",
  "attribute",
  "multivaluedAttribute",
  "derivedAttribute",
  "terminator",
  "connector",
]);

const FILL = "#24344a";
const STROKE = "#7aa2c9";

/**
 * A preview drawn from the same geometry the canvas uses, so the library can
 * never advertise a shape the editor draws differently.
 */
export default function ShapePreview({ type, width = 38, height = 28 }) {
  const art = SHAPE_ART[type];
  const dash = type === "derivedAttribute" ? "4 3" : undefined;

  return (
    <svg
      className="shape-preview"
      viewBox="0 0 100 100"
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {art ? (
        <>
          {(art.bodies || [art.body]).filter(Boolean).map((d, i) => (
            <path
              key={i}
              d={d}
              fill={FILL}
              stroke={STROKE}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {(art.detail || []).map((d, i) => (
            <path
              key={`d${i}`}
              d={d}
              fill="none"
              stroke={STROKE}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      ) : ELLIPSE.has(type) ? (
        <>
          <ellipse
            cx="50"
            cy="50"
            rx="49"
            ry="49"
            fill={FILL}
            stroke={STROKE}
            strokeWidth="1.5"
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
          {type === "multivaluedAttribute" ? (
            <ellipse
              cx="50"
              cy="50"
              rx="38"
              ry="38"
              fill="none"
              stroke={STROKE}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </>
      ) : (
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx={ROUND.has(type) ? 18 : 3}
          fill={type === "text" ? "none" : FILL}
          stroke={type === "text" ? "none" : STROKE}
          strokeWidth="1.5"
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Notation details that are not part of the outline. */}
      {(type === "class" || type === "interface") && (
        <g stroke={STROKE} strokeWidth="1.5" vectorEffect="non-scaling-stroke">
          <line x1="1" y1="30" x2="99" y2="30" />
          <line x1="1" y1="62" x2="99" y2="62" />
        </g>
      )}
      {type === "predefinedProcess" && (
        <g stroke={STROKE} strokeWidth="1.5" vectorEffect="non-scaling-stroke">
          <line x1="18" y1="1" x2="18" y2="99" />
          <line x1="82" y1="1" x2="82" y2="99" />
        </g>
      )}
      {type === "weakEntity" && (
        <rect
          x="6"
          y="6"
          width="88"
          height="88"
          fill="none"
          stroke={STROKE}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {type === "entity" && (
        <rect
          x="8"
          y="8"
          width="84"
          height="84"
          fill="none"
          stroke={STROKE}
          strokeWidth="1.5"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {type === "dataStore" && (
        <g stroke={STROKE} strokeWidth="1.5" vectorEffect="non-scaling-stroke">
          <line x1="4" y1="1" x2="4" y2="99" />
          <line x1="96" y1="1" x2="96" y2="99" />
        </g>
      )}
      {type === "text" && (
        <text x="50" y="72" textAnchor="middle" fontSize="64" fill={STROKE} fontFamily="Georgia, serif">
          T
        </text>
      )}
      {type === "actor" && (
        <g stroke={STROKE} strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke">
          <circle cx="50" cy="20" r="13" />
          <line x1="50" y1="33" x2="50" y2="66" />
          <line x1="26" y1="45" x2="74" y2="45" />
          <line x1="50" y1="66" x2="30" y2="94" />
          <line x1="50" y1="66" x2="70" y2="94" />
        </g>
      )}
    </svg>
  );
}
