/**
 * Document and XML-import checks (node scripts/check-document.mjs).
 *
 * These cover the parts that are dangerous to get wrong and hard to see by
 * clicking: page isolation, per-page undo, dirty detection, the save/reopen
 * round trip, legacy files, and the mxGraph -> canonical conversion.
 *
 * The XML reader itself (DOMParser + DecompressionStream) is browser-only, so
 * it is exercised in the app; everything below it is pure and tested here.
 */

import assert from "node:assert/strict";
import {
  DOCUMENT_VERSION,
  clonePage,
  createDocument,
  documentSnapshot,
  parseDocument,
  toFilePayload,
} from "../src/schema/document.js";
import {
  convertMxCells,
  isSupportedDiagramXml,
  labelColorFor,
  mapMxShape,
  mxArrow,
  mxLineStyle,
  mxRouting,
  parseStyleString,
  stripRichText,
} from "../src/import/drawioXml.js";
import { shapesForFamily } from "../src/schema/canonical.js";
import { ACTIONS } from "../src/canvas/commands/types.js";
import { useDiagramStore } from "../src/state/diagramStore.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const store = () => useDiagramStore.getState();
const node = (id, label, extra = {}) => ({
  id,
  type: "process",
  label,
  position: { x: 0, y: 0 },
  size: { width: 160, height: 72 },
  ...extra,
});

/* ------------------------------------------------------------- document --- */

check("a new document has one clean page", () => {
  const document = createDocument("er");
  assert.equal(document.version, DOCUMENT_VERSION);
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].diagram.diagram_type, "er");
  assert.equal(document.pages[0].diagram.nodes.length, 0);
  assert.equal(document.pages[0].name, "Page 1");
  assert.equal(document.activePageId, document.pages[0].id);
});

check("pages keep independent diagrams", () => {
  const document = createDocument("flowchart");
  const first = document.pages[0];
  first.diagram.nodes.push(node("n1", "Start"));

  const second = { id: "page_2", name: "Page 2", diagram: { ...first.diagram, nodes: [node("n2", "Other")] } };
  const multi = { ...document, pages: [first, second], activePageId: second.id };

  assert.equal(multi.pages[0].diagram.nodes.length, 1);
  assert.equal(multi.pages[0].diagram.nodes[0].label, "Start");
  assert.equal(multi.pages[1].diagram.nodes[0].label, "Other");
});

check("duplicating a page remaps every id, including edge endpoints", () => {
  const page = {
    id: "page_1",
    name: "Page 1",
    diagram: {
      diagram_type: "flowchart",
      nodes: [node("a", "A"), node("b", "B"), node("g", "Group", { type: "group" }), node("child", "C", { parentId: "g" })],
      edges: [{ id: "e1", source: "a", target: "b" }],
      groups: [],
      meta: { name: "Page 1" },
    },
  };
  const copy = clonePage(page, "Page 1 copy");
  assert.equal(copy.name, "Page 1 copy");
  assert.equal(copy.diagram.nodes.length, 4);
  assert.equal(copy.diagram.edges.length, 1);

  const copyIds = new Set(copy.diagram.nodes.map((n) => n.id));
  const originalIds = new Set(page.diagram.nodes.map((n) => n.id));
  for (const id of copyIds) assert.ok(!originalIds.has(id), `id ${id} was reused`);
  assert.equal(copyIds.size, 4, "duplicate ids inside the copy");

  const edge = copy.diagram.edges[0];
  assert.ok(copyIds.has(edge.source) && copyIds.has(edge.target));
  const movedChild = copy.diagram.nodes.find((n) => n.label === "C");
  const movedGroup = copy.diagram.nodes.find((n) => n.label === "Group");
  assert.equal(movedChild.parentId, movedGroup.id, "child group link must follow the copy");
});

check("a saved document reopens identically", () => {
  const storeState = store();
  storeState.newDocument("uml");
  const page = store().document.pages[0].id;
  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "class", label: "Order", position: { x: 20, y: 30 } } });
  store().addPage("Second");
  store().dispatch({
    action: ACTIONS.ADD_NODE,
    payload: { type: "class", label: "Customer", position: { x: 200, y: 30 } },
  });
  store().setActivePage(page);

  const before = store().document;
  const payload = toFilePayload(before);
  assert.equal(payload.version, DOCUMENT_VERSION);
  assert.equal(payload.pages.length, 2);
  // The active page is mirrored at the top level for single-page readers.
  assert.equal(payload.nodes.length, before.pages[0].diagram.nodes.length);

  const reopened = parseDocument(JSON.parse(JSON.stringify(payload)));
  assert.ok(reopened.ok, reopened.error);
  assert.equal(reopened.document.pages.length, 2);
  assert.equal(documentSnapshot(reopened.document), documentSnapshot(before));
});

check("legacy single-page files still open", () => {
  const legacy = {
    diagram_type: "er",
    nodes: [node("e1", "Customer"), node("e2", "Order")],
    edges: [{ id: "r1", source: "e1", target: "e2", label: "places" }],
    groups: [],
    meta: { name: "Old diagram" },
  };
  const parsed = parseDocument(legacy);
  assert.ok(parsed.ok, parsed.error);
  assert.equal(parsed.document.pages.length, 1);
  assert.equal(parsed.document.pages[0].name, "Page 1");
  assert.equal(parsed.document.pages[0].diagram.nodes.length, 2);
  assert.equal(parsed.document.pages[0].diagram.edges.length, 1);
  assert.equal(parsed.document.name, "Old diagram");
});

check("opening a file repairs what it can and reports the rest", () => {
  const parsed = parseDocument({
    version: DOCUMENT_VERSION,
    pages: [
      {
        id: "p1",
        name: "Broken",
        diagram: {
          diagram_type: "flowchart",
          nodes: [node("dup", "A"), node("dup", "B"), { label: "no id" }],
          edges: [{ id: "e1", source: "dup", target: "ghost" }],
        },
      },
    ],
  });
  assert.ok(parsed.ok);
  const diagram = parsed.document.pages[0].diagram;
  assert.equal(diagram.nodes.length, 3);
  assert.equal(new Set(diagram.nodes.map((n) => n.id)).size, 3, "ids must be unique after repair");
  assert.equal(diagram.edges.length, 0, "an edge without both ends is dropped");
  assert.ok(parsed.warnings.length >= 2);
});

check("files with nothing in them are rejected", () => {
  assert.equal(parseDocument(null).ok, false);
  assert.equal(parseDocument({ hello: "world" }).ok, false);
});

/* --------------------------------------------------------------- store ---- */

check("a new document starts clean and edits make it dirty", () => {
  store().newDocument("flowchart");
  assert.equal(store().isDirty(), false);
  assert.equal(store().document.pages.length, 1);
  assert.equal(store().diagram.nodes.length, 0);
  assert.equal(store().history.past.length, 0);
  assert.equal(store().history.future.length, 0);

  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "Step" } });
  assert.equal(store().isDirty(), true);
  assert.equal(store().document.pages[0].diagram.nodes.length, 1, "the page must mirror the edit");

  // Undo back to the saved state is clean again: dirtiness is not a sticky flag.
  store().undo();
  assert.equal(store().isDirty(), false);

  store().redo();
  assert.equal(store().isDirty(), true);
});

check("selecting, zooming and switching pages is not an edit", () => {
  store().newDocument("flowchart");
  const first = store().document.pages[0].id;
  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "Step" } });
  store().addPage();
  const second = store().document.pages[1].id;

  const snapshot = documentSnapshot(store().document);
  store().setSelection([store().diagram.nodes[0]?.id].filter(Boolean));
  store().setZoom(1.75);
  store().setActivePage(first);
  store().setSelection([]);
  store().setActivePage(second);
  store().setZoom(1);
  assert.equal(documentSnapshot(store().document), snapshot);
});

check("pages never share content or undo history", () => {
  store().newDocument("flowchart");
  const firstPage = store().document.pages[0].id;

  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "On page 1" } });
  assert.equal(store().diagram.nodes.length, 1);

  store().addPage();
  const secondPage = store().document.pages[1].id;
  assert.equal(store().activePageId, secondPage);
  assert.equal(store().diagram.nodes.length, 0, "a new page starts empty");

  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "decision", label: "On page 2" } });
  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "Also page 2" } });
  assert.equal(store().diagram.nodes.length, 2);

  store().undo();
  assert.equal(store().diagram.nodes.length, 1, "undo applies to the active page");

  // Page 1 has its own nodes and its own stack: undoing there must not touch page 2.
  store().setActivePage(firstPage);
  assert.equal(store().diagram.nodes.length, 1);
  assert.equal(store().diagram.nodes[0].label, "On page 1");
  store().undo();
  assert.equal(store().diagram.nodes.length, 0);

  store().setActivePage(secondPage);
  assert.equal(store().diagram.nodes.length, 1);
  assert.equal(store().diagram.nodes[0].label, "On page 2");
  assert.equal(store().document.pages[0].diagram.nodes.length, 0);
});

check("the last page cannot be deleted, and deleting the active page moves on", () => {
  store().newDocument("flowchart");
  const only = store().document.pages[0].id;
  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "Keep me" } });
  assert.equal(store().deletePage(only), false, "a document must keep one page");
  assert.equal(store().document.pages.length, 1);
  assert.equal(store().diagram.nodes.length, 1);

  store().addPage("Second");
  store().addPage("Third");
  const second = store().document.pages[1].id;
  const third = store().document.pages[2].id;
  store().setActivePage(second);
  assert.equal(store().deletePage(second), true);
  assert.equal(store().document.pages.length, 2);
  assert.equal(store().activePageId, third, "the page after the deleted one is shown");
  assert.equal(store().pageHistories[second], undefined, "its history goes with it");
});

check("page names are unique and survive saving", () => {
  store().newDocument("flowchart");
  const first = store().document.pages[0].id;
  assert.equal(store().renamePage(first, "  ER Diagram "), true);
  assert.equal(store().document.pages[0].name, "ER Diagram");

  store().addPage("Page 2");
  const second = store().document.pages[1].id;
  assert.equal(store().renamePage(second, "ER Diagram"), false, "duplicate names are refused");
  assert.equal(store().document.pages[1].name, "Page 2");
  assert.equal(store().renamePage(second, "   "), false, "an empty name is refused");

  assert.equal(store().renameDocument("  Course Work "), true);
  assert.equal(store().isDirty(), true, "renaming the document is an edit");
  assert.equal(store().renameDocument("   "), false, "an empty document name is refused");

  let written = null;
  assert.equal(
    store().saveDocument((filename, payload) => {
      written = { filename, payload };
    }),
    true
  );
  assert.equal(store().isDirty(), false, "saving marks the document clean");
  assert.equal(written.filename, "Course Work.json");
  assert.equal(written.payload.pages.length, 2);

  const reopened = parseDocument(JSON.parse(JSON.stringify(written.payload)));
  assert.deepEqual(reopened.document.pages.map((p) => p.name), ["ER Diagram", "Page 2"]);
});

check("a failed save never discards the document", () => {
  store().newDocument("flowchart");
  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "Precious" } });
  const before = documentSnapshot(store().document);

  const saved = store().saveDocument(() => {
    throw new Error("disk full");
  });

  assert.equal(saved, false, "a failed write must report failure");
  assert.equal(documentSnapshot(store().document), before, "the document is untouched");
  assert.equal(store().diagram.nodes.length, 1);
  assert.equal(store().isDirty(), true, "it is still unsaved");
  assert.ok(store().status.includes("disk full"), "the reason is reported");
});

check("moving, duplicating and importing pages keep order", () => {
  store().newDocument("flowchart");
  store().addPage();
  store().addPage();
  const [a, b, c] = store().document.pages.map((p) => p.id);
  assert.equal(store().movePage(c, -1), true);
  assert.deepEqual(store().document.pages.map((p) => p.id), [a, c, b]);
  assert.equal(store().movePage(a, -1), false, "cannot move past the start");

  store().setActivePage(a);
  store().dispatch({ action: ACTIONS.ADD_NODE, payload: { type: "process", label: "Original" } });
  const copy = store().duplicatePage(a);
  assert.equal(store().document.pages.length, 4);
  assert.equal(store().document.pages[1].id, copy.id, "the copy lands next to its source");
  assert.equal(store().activePageId, copy.id);
  assert.equal(store().diagram.nodes.length, 1);
  assert.notEqual(store().diagram.nodes[0].id, store().document.pages[0].diagram.nodes[0].id);
});

/* ------------------------------------------------------------------ xml --- */

check("only supported diagram XML is intercepted", () => {
  assert.equal(isSupportedDiagramXml('<mxfile host="app"><diagram name="Page 1"/></mxfile>'), true);
  assert.equal(isSupportedDiagramXml('<?xml version="1.0"?>\n<mxGraphModel><root/></mxGraphModel>'), true);
  assert.equal(isSupportedDiagramXml('  <bpmn:definitions xmlns:bpmn="x"/>'), false);
  assert.equal(isSupportedDiagramXml("<svg><rect/></svg>"), false);
  assert.equal(isSupportedDiagramXml("just some text"), false);
  assert.equal(isSupportedDiagramXml(""), false);
  assert.equal(isSupportedDiagramXml(null), false);
});

check("mxGraph styles are read, not interpreted", () => {
  const style = parseStyleString("ellipse;fillColor=#DAE8FC;strokeColor=#6c8ebf;rounded=1;");
  assert.equal(style.ellipse, "1");
  assert.equal(style.fillColor, "#DAE8FC");
  assert.equal(style.rounded, "1");

  assert.deepEqual(mapMxShape("rhombus;whiteSpace=wrap"), { type: "diamond", known: true });
  assert.equal(mapMxShape("ellipse;").type, "ellipse");
  assert.equal(mapMxShape("shape=cylinder3;").type, "database");
  assert.equal(mapMxShape("shape=star;").type, "star");
  assert.equal(mapMxShape("shape=hexagon;").type, "hexagon");
  assert.deepEqual(mapMxShape("shape=some.custom.Kite"), {
    type: "rectangle",
    known: false,
    name: "some.custom.Kite",
  });

  assert.equal(mxArrow("block", "arrow"), "triangle");
  assert.equal(mxArrow("open", "arrow"), "openArrow");
  assert.equal(mxArrow("ERmany", "arrow"), "crowfoot");
  assert.equal(mxArrow("classic", "none"), "arrow");
  assert.equal(mxArrow("", "arrow"), "arrow");
  assert.equal(mxRouting("edgeStyle=orthogonalEdgeStyle;"), "elbow");
  assert.equal(mxRouting("edgeStyle=orthogonalEdgeStyle;rounded=1;"), "rounded");
  assert.equal(mxRouting("curved=1;"), "curved");
  assert.equal(mxRouting(""), "straight");
  assert.equal(mxLineStyle("dashed=1;"), "dashed");
  assert.equal(mxLineStyle("dashPattern=1 1;"), "dashed");
  assert.equal(mxLineStyle(""), "solid");

  // Unset label colours follow the fill so imported light shapes stay readable
  // on the dark canvas, while an explicit fontColor always wins.
  assert.equal(labelColorFor("#dae8fc"), "#1f2937");
  assert.equal(labelColorFor("#1e2a3a"), "#e8eef6");
  assert.equal(labelColorFor("transparent"), null);
  const [plain] = convertMxCells(
    [{ id: "2", value: "Light", style: "rounded=1;fillColor=#d5e8d4;", vertex: true, geometry: { x: 0, y: 0, width: 120, height: 60 } }],
    { diagramType: "flowchart" }
  ).nodes;
  assert.equal(plain.style.color, "#1f2937");
  const [dark] = convertMxCells(
    [{ id: "3", value: "Dark", style: "rounded=1;fillColor=#1e2a3a;fontColor=#ffcc00;", vertex: true, geometry: { x: 0, y: 0, width: 120, height: 60 } }],
    { diagramType: "flowchart" }
  ).nodes;
  assert.equal(dark.style.color, "#ffcc00");
});

check("rich labels lose their markup and scripts", () => {
  assert.equal(stripRichText("<b>Check</b> <i>order</i>"), "Check order");
  assert.equal(stripRichText("Line one<br>Line two"), "Line one\nLine two");
  assert.equal(stripRichText("<script>alert(1)</script>Safe"), "Safe");
  assert.equal(stripRichText("<div style=\"color:red\">A</div>"), "A");
  assert.equal(stripRichText("&lt;b&gt;x&lt;/b&gt;"), "<b>x</b>");
  assert.equal(stripRichText("Coffee &#38; tea"), "Coffee & tea");
  assert.equal(stripRichText(null), "");
});

check("cells convert to family-legal nodes and valid edges", () => {
  const cells = [
    { id: "0", value: "", style: "", parent: "", vertex: false, edge: false, visible: true, geometry: null },
    {
      id: "2",
      value: "Start",
      style: "ellipse;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#112233;fontSize=13;",
      parent: "1",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 40, y: 20, width: 120, height: 60, relative: false },
    },
    {
      id: "3",
      value: "<b>Check</b><br>order",
      style: "rhombus;dashed=1;strokeWidth=2;",
      parent: "1",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 240, y: 120, width: 140, height: 80, relative: false },
    },
    {
      id: "label-e1",
      value: "yes",
      style: "edgeLabel;",
      parent: "e1",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 0, y: 0, width: 40, height: 20, relative: true },
    },
    {
      id: "e1",
      value: "",
      style: "edgeStyle=orthogonalEdgeStyle;dashed=1;strokeWidth=2;startArrow=none;endArrow=block;",
      parent: "1",
      vertex: false,
      edge: true,
      source: "2",
      target: "3",
      visible: true,
      geometry: null,
    },
    {
      id: "e2",
      value: "",
      style: "",
      parent: "1",
      vertex: false,
      edge: true,
      source: "2",
      target: "missing",
      visible: true,
      geometry: null,
    },
    {
      id: "4",
      value: "Hidden",
      style: "ellipse;",
      parent: "1",
      vertex: true,
      edge: false,
      visible: false,
      geometry: { x: 0, y: 0, width: 100, height: 40, relative: false },
    },
  ];

  const result = convertMxCells(cells, { diagramType: "flowchart" });
  assert.equal(result.nodes.length, 2, "hidden shapes and edge labels are not shapes");
  assert.equal(result.edges.length, 1, "a connector without both ends is dropped");
  assert.equal(result.stats.skippedConnectors, 1);
  assert.equal(result.stats.shapes, 2);

  const legal = new Set(shapesForFamily("flowchart"));
  for (const imported of result.nodes) {
    assert.ok(legal.has(imported.type), `${imported.type} is not a flowchart shape`);
    assert.equal(imported.autoSize, false, "imported geometry must be preserved, not refitted");
  }

  const [start, decision] = result.nodes;
  assert.equal(start.label, "Start");
  assert.deepEqual(start.position, { x: 40, y: 20 });
  assert.deepEqual(start.size, { width: 120, height: 60 });
  assert.equal(start.style.fill, "#dae8fc");
  assert.equal(start.style.border, "#6c8ebf");
  assert.equal(start.style.color, "#112233");
  assert.equal(start.style.fontSize, 13);
  assert.equal(decision.label, "Check\norder");

  const edge = result.edges[0];
  assert.ok(result.nodes.some((n) => n.id === edge.source));
  assert.ok(result.nodes.some((n) => n.id === edge.target));
  assert.equal(edge.label, "yes", "the label cell supplies the connector label");
  assert.equal(edge.routing, "elbow");
  assert.equal(edge.lineStyle, "dashed");
  assert.equal(edge.startMarker, "none");
  assert.equal(edge.endMarker, "triangle");
  assert.equal(edge.style.borderWidth, 2);
});

check("conversion is family-aware and reports what it could not map", () => {
  const cells = [
    {
      id: "1",
      value: "Customer",
      style: "rounded=0;",
      parent: "0",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 0, y: 0, width: 160, height: 60, relative: false },
    },
    {
      id: "2",
      value: "Kite",
      style: "shape=some.custom.Kite;",
      parent: "0",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 200, y: 0, width: 120, height: 60, relative: false },
    },
    {
      id: "3",
      value: "Cloud",
      style: "shape=cloud;",
      parent: "0",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 0, y: 200, width: 120, height: 80, relative: false },
    },
  ];

  const er = convertMxCells(cells, { diagramType: "er" });
  const legal = new Set(shapesForFamily("er"));
  for (const imported of er.nodes) assert.ok(legal.has(imported.type), `${imported.type} is not an er shape`);
  assert.equal(er.nodes.find((n) => n.label === "Cloud").type, "cloud", "general shapes pass through");
  assert.equal(er.stats.unsupportedShapes, 1);
  assert.ok(er.warnings.some((w) => w.includes("unsupported style")));
});

check("nested shapes are placed absolutely and ids stay unique", () => {
  const cells = [
    {
      id: "group",
      value: "Swimlane",
      style: "swimlane;",
      parent: "0",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 100, y: 50, width: 600, height: 300, relative: false },
    },
    {
      id: "child",
      value: "Inner",
      style: "",
      parent: "group",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 20, y: 40, width: 120, height: 60, relative: false },
    },
    {
      id: "child",
      value: "Duplicate id",
      style: "",
      parent: "group",
      vertex: true,
      edge: false,
      visible: true,
      geometry: { x: 200, y: 40, width: 120, height: 60, relative: false },
    },
  ];

  const result = convertMxCells(cells, { diagramType: "flowchart" });
  const inner = result.nodes.find((n) => n.label === "Inner");
  assert.deepEqual(inner.position, { x: 120, y: 90 }, "child coordinates are relative to the group");
  assert.equal(new Set(result.nodes.map((n) => n.id)).size, 3);
  assert.ok(result.warnings.some((w) => w.includes("Duplicate shape id")));
});

console.log(`\n${passed} document and import checks passed`);
