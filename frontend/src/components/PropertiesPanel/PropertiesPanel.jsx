import { DIAGRAM_TYPES, shapesForFamily } from "../../schema/canonical";
import { TYPE_LABELS } from "../../canvas/shapeCatalog";
import { ACTIONS } from "../../canvas/commands/types";
import {
  CONNECTOR_PRESETS,
  LINE_STYLES,
  MARKERS,
  MAX_MARKER_SIZE,
  MIN_MARKER_SIZE,
  MULTIPLICITIES,
  ROUTINGS,
  UML_RELATIONSHIPS,
  presetOf,
  presetPatch,
  relationshipOf,
  relationshipPatch,
} from "../../canvas/connectors";
import { useDiagramStore } from "../../state/diagramStore";

// A small, useful palette; any other value can be typed as a hex code.
const SWATCHES = [
  "#e8eef6",
  "#ffffff",
  "#c8ddf5",
  "#c5e6d0",
  "#f6e3b4",
  "#f0c9c9",
  "#e0d4f5",
  "#1e2a3a",
  "#2f4763",
  "#4c8dff",
  "#5cbc8a",
  "#d4b05c",
  "#d46565",
  "#a06bd4",
  "#101722",
];

export default function PropertiesPanel() {
  const diagram = useDiagramStore((s) => s.diagram);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const selectedEdgeIds = useDiagramStore((s) => s.selectedEdgeIds);
  const dispatch = useDiagramStore((s) => s.dispatch);

  const nodes = diagram.nodes.filter((n) => selectedIds.includes(n.id));
  const edge = diagram.edges.find((e) => selectedEdgeIds.includes(e.id));

  if (!nodes.length && !edge) {
    return (
      <div className="empty-props">
        <p>Select a shape or connector to edit its properties. Changes apply immediately.</p>
        <p>
          Canvas background, grid and the dark/light theme are in the toolbar.
        </p>
      </div>
    );
  }

  if (edge && !nodes.length) {
    return <EdgeProperties edge={edge} diagram={diagram} dispatch={dispatch} />;
  }

  return <NodeProperties nodes={nodes} diagram={diagram} dispatch={dispatch} />;
}

/* ---------------------------------------------------------------- nodes --- */

function NodeProperties({ nodes, diagram, dispatch }) {
  const node = nodes[0];
  const multi = nodes.length > 1;
  const ids = nodes.map((n) => n.id);

  const patch = (partial) =>
    multi
      ? dispatch({ action: ACTIONS.UPDATE_NODES, payload: { ids, patch: partial } })
      : dispatch({ action: ACTIONS.UPDATE_NODE, payload: { id: node.id, patch: partial } });

  // Style changes merge into each node's own style object, so a fill applied to
  // a selection never touches a shape outside it.
  const style = (partial) => patch({ style: partial });

  const isClass = node.type === "class" || node.type === "interface";
  const isErEntity = node.type === "entity" || node.type === "weakEntity";
  const types = shapesForFamily(diagram.diagram_type);
  if (node.type === "group" && !types.includes("group")) types.push("group");

  return (
    <form className="prop-form" onSubmit={(e) => e.preventDefault()}>
      <div className="props-header">
        {multi ? `${nodes.length} shapes selected` : TYPE_LABELS[node.type] || node.type}
        {multi ? <span className="props-note">Changes apply to every selected shape.</span> : null}
      </div>

      {!multi && (node.confidence != null || node.sources?.length) ? (
        <div className="props-badge">
          {node.confidence != null && (
            <span>
              Recognition confidence: <strong>{Math.round(node.confidence * 100)}%</strong>
            </span>
          )}
          {node.sources?.length ? (
            <span>
              Sources: <strong>{node.sources.join(", ")}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {!multi && (
        <label>
          Text
          <input value={node.label} onChange={(e) => patch({ label: e.target.value })} />
        </label>
      )}

      {!multi && (
        <label>
          Shape type
          <select value={node.type} onChange={(e) => patch({ type: e.target.value })}>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] || t}
              </option>
            ))}
          </select>
        </label>
      )}

      {!multi && (
        <div className="prop-row">
          <label>
            Width
            <input
              type="number"
              value={Math.round(node.size.width)}
              onChange={(e) => patch({ size: { ...node.size, width: Number(e.target.value) } })}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              value={Math.round(node.size.height)}
              onChange={(e) => patch({ size: { ...node.size, height: Number(e.target.value) } })}
            />
          </label>
        </div>
      )}

      {!multi && (
        <div className="prop-row">
          <label>
            X
            <input
              type="number"
              value={Math.round(node.position.x)}
              onChange={(e) => patch({ position: { ...node.position, x: Number(e.target.value) } })}
            />
          </label>
          <label>
            Y
            <input
              type="number"
              value={Math.round(node.position.y)}
              onChange={(e) => patch({ position: { ...node.position, y: Number(e.target.value) } })}
            />
          </label>
        </div>
      )}

      <div className="prop-section-title">Colours</div>
      <ColorField
        label="Fill"
        value={node.style.fill}
        onChange={(fill) => style({ fill })}
        allowTransparent
      />
      <ColorField label="Border" value={node.style.border} onChange={(border) => style({ border })} />
      <ColorField label="Text" value={node.style.color} onChange={(color) => style({ color })} />

      <div className="prop-row">
        <label>
          Border width
          <input
            type="number"
            min="0"
            max="12"
            step="0.5"
            value={node.style.borderWidth ?? 1.5}
            onChange={(e) => style({ borderWidth: Number(e.target.value) })}
          />
        </label>
        <label>
          Opacity
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={node.style.opacity ?? 1}
            onChange={(e) => style({ opacity: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="prop-section-title">Text</div>
      <div className="prop-row">
        <label>
          Font
          <select value={node.style.font} onChange={(e) => style({ font: e.target.value })}>
            <option>Segoe UI</option>
            <option>Arial</option>
            <option>Georgia</option>
            <option>Consolas</option>
            <option>Times New Roman</option>
          </select>
        </label>
        <label>
          Size
          <input
            type="number"
            min="8"
            max="48"
            value={node.style.fontSize}
            onChange={(e) => style({ fontSize: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="prop-row">
        <label>
          Style
          <select value={node.style.fontStyle} onChange={(e) => style({ fontStyle: e.target.value })}>
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </label>
        <label>
          Weight
          <select
            value={node.style.fontWeight || "500"}
            onChange={(e) => style({ fontWeight: e.target.value })}
          >
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="700">Bold</option>
          </select>
        </label>
      </div>
      <label>
        Text alignment
        <select value={node.style.textAlign} onChange={(e) => style({ textAlign: e.target.value })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>

      {/* UML classes keep three compartments: name, attributes, methods. */}
      {isClass && !multi && (
        <>
          <div className="prop-section-title">Compartments</div>
          <label>
            Attributes (one per line)
            <textarea
              rows={3}
              spellCheck={false}
              value={(node.attributes || []).join("\n")}
              onChange={(e) => patch({ attributes: splitMembers(e.target.value) })}
            />
          </label>
          <label>
            Methods (one per line)
            <textarea
              rows={3}
              spellCheck={false}
              value={(node.methods || []).join("\n")}
              onChange={(e) => patch({ methods: splitMembers(e.target.value) })}
            />
          </label>
        </>
      )}

      {/* ER entities are a name-only rectangle, so members are edited as nodes. */}
      {!isClass && !isErEntity && (node.attributes?.length || node.methods?.length) ? (
        <label>
          Attributes (one per line)
          <textarea
            rows={2}
            value={(node.attributes || []).join("\n")}
            onChange={(e) => patch({ attributes: splitMembers(e.target.value) })}
          />
        </label>
      ) : null}

      <label>
        Diagram type
        <select
          value={diagram.diagram_type}
          onChange={(e) =>
            dispatch({ action: ACTIONS.SET_DIAGRAM_TYPE, payload: { diagram_type: e.target.value } })
          }
        >
          {DIAGRAM_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

/* ----------------------------------------------------------- connectors --- */

function EdgeProperties({ edge, diagram, dispatch }) {
  const patch = (partial) =>
    dispatch({ action: ACTIONS.UPDATE_EDGE, payload: { id: edge.id, patch: partial } });
  const style = (partial) => patch({ style: partial });
  const isUml = diagram.diagram_type === "uml";
  const source = diagram.nodes.find((n) => n.id === edge.source);
  const target = diagram.nodes.find((n) => n.id === edge.target);

  const applyPreset = (id) => {
    const next = presetPatch(id);
    if (next) patch(next);
  };

  return (
    <form className="prop-form" onSubmit={(e) => e.preventDefault()}>
      <div className="props-header">
        Connector
        <span className="props-note">
          {source?.label || "?"} → {target?.label || "?"}
        </span>
      </div>

      <label>
        Connector
        <select value={presetOf(edge)} onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Custom</option>
          {CONNECTOR_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Label
        <input value={edge.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>

      <div className="prop-section-title">End markers</div>
      <div className="prop-row">
        <label>
          Start
          <select
            value={edge.startMarker || "none"}
            onChange={(e) => patch({ startMarker: e.target.value })}
          >
            {MARKERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          End
          <select
            value={edge.endMarker || "arrow"}
            onChange={(e) => patch({ endMarker: e.target.value })}
          >
            {MARKERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Marker size
        <input
          type="range"
          min={MIN_MARKER_SIZE}
          max={MAX_MARKER_SIZE}
          step="1"
          value={edge.markerSize ?? 16}
          onChange={(e) => patch({ markerSize: Number(e.target.value) })}
        />
      </label>

      <div className="prop-section-title">Line</div>
      <label>
        Routing
        <select value={edge.routing || "rounded"} onChange={(e) => patch({ routing: e.target.value })}>
          {ROUTINGS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <div className="prop-row">
        <label>
          Style
          <select value={edge.lineStyle} onChange={(e) => patch({ lineStyle: e.target.value })}>
            {LINE_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Width
          <input
            type="number"
            min="0.5"
            max="10"
            step="0.5"
            value={edge.style?.borderWidth ?? 1.6}
            onChange={(e) => style({ borderWidth: Number(e.target.value) })}
          />
        </label>
      </div>
      <ColorField
        label="Line colour"
        value={edge.style?.border}
        onChange={(border) => style({ border })}
      />

      {isUml && (
        <>
          <div className="prop-section-title">UML relationship</div>
          <label>
            Type
            <select
              // Derived from the markers on the canvas, so the panel can never
              // claim a notation the connector does not show.
              value={relationshipOf(edge)}
              onChange={(e) => {
                const next = relationshipPatch(e.target.value);
                if (next) patch(next);
              }}
            >
              <option value="">Custom markers</option>
              {UML_RELATIONSHIPS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div className="prop-row">
            <label>
              Source multiplicity
              <input
                list="uml-multiplicities"
                value={edge.sourceMultiplicity || ""}
                placeholder="1"
                onChange={(e) => patch({ sourceMultiplicity: e.target.value })}
              />
            </label>
            <label>
              Target multiplicity
              <input
                list="uml-multiplicities"
                value={edge.targetMultiplicity || ""}
                placeholder="*"
                onChange={(e) => patch({ targetMultiplicity: e.target.value })}
              />
            </label>
          </div>
          <datalist id="uml-multiplicities">
            {MULTIPLICITIES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="props-hint">
            Multiplicities are drawn at their own end of the connector.
          </p>
        </>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- pieces --- */

function ColorField({ label, value, onChange, allowTransparent }) {
  const hex = toHex(value);
  const commit = (raw) => {
    const next = normalizeHex(raw);
    if (next) onChange(next);
  };
  return (
    <div className="color-field">
      <span className="field-label">{label}</span>
      <div className="color-row">
        <input
          type="color"
          value={hex}
          aria-label={`${label} colour`}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          key={hex}
          className="hex-input"
          defaultValue={hex}
          spellCheck={false}
          aria-label={`${label} hex value`}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
        />
        {allowTransparent ? (
          <button
            type="button"
            className="btn-mini"
            title="No fill"
            onClick={() => onChange("transparent")}
          >
            None
          </button>
        ) : null}
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${hex === c ? "active" : ""}`}
            style={{ background: c }}
            title={c}
            aria-label={c}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}

function splitMembers(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function toHex(color) {
  const value = String(color || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return expandHex(value);
  return "#1e2a3a";
}

function expandHex(value) {
  return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
}

function normalizeHex(raw) {
  const value = String(raw || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return expandHex(value);
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
  return null;
}
