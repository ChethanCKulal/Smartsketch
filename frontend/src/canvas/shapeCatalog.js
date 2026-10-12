export const SHAPE_LIBRARY = [
  {
    category: "General & Freeform",
    family: null,
    items: [
      { type: "rectangle", label: "Rectangle" },
      { type: "roundedRectangle", label: "Rounded Rectangle" },
      { type: "ellipse", label: "Ellipse / Circle" },
      { type: "diamond", label: "Diamond" },
      { type: "triangle", label: "Triangle" },
      { type: "hexagon", label: "Hexagon" },
      { type: "parallelogram", label: "Parallelogram" },
      { type: "cylinder", label: "Cylinder" },
      { type: "document", label: "Document" },
      { type: "star", label: "Star" },
      { type: "cloud", label: "Cloud" },
      { type: "stickyNote", label: "Sticky Note" },
      { type: "callout", label: "Callout / Bubble" },
      { type: "text", label: "Text / Word" },
    ],
  },
  {
    category: "Arrow Shapes",
    family: null,
    items: [
      { type: "arrowRight", label: "Right Arrow" },
      { type: "arrowLeft", label: "Left Arrow" },
      { type: "arrowUp", label: "Up Arrow" },
      { type: "arrowDown", label: "Down Arrow" },
      { type: "arrowBoth", label: "Double Arrow" },
    ],
  },
  {
    category: "Flowchart",
    family: "flowchart",
    items: [
      { type: "process", label: "Process" },
      { type: "decision", label: "Decision" },
      { type: "terminator", label: "Terminator" },
      { type: "io", label: "Input/Output" },
      { type: "document", label: "Document" },
      { type: "database", label: "Database" },
      { type: "predefinedProcess", label: "Predefined Process" },
    ],
  },
  {
    category: "UML",
    family: "uml",
    items: [
      { type: "class", label: "Class" },
      { type: "interface", label: "Interface" },
      { type: "package", label: "Package" },
      { type: "actor", label: "Actor" },
      { type: "usecase", label: "Use Case" },
    ],
  },
  {
    category: "ER",
    family: "er",
    items: [
      { type: "entity", label: "Entity" },
      { type: "attribute", label: "Attribute" },
      { type: "relationship", label: "Relationship" },
      { type: "weakEntity", label: "Weak Entity" },
    ],
  },
  {
    category: "DFD",
    family: "dfd",
    items: [
      { type: "dfdProcess", label: "Process" },
      { type: "dataStore", label: "Data Store" },
      { type: "externalEntity", label: "External Entity" },
      { type: "dataFlow", label: "Data Flow" },
    ],
  },
];

export const TYPE_LABELS = Object.fromEntries(
  SHAPE_LIBRARY.flatMap((g) => g.items.map((i) => [i.type, i.label]))
);
