export const SHAPE_LIBRARY = [
  {
    category: "General",
    items: [
      { type: "rectangle", label: "Rectangle" },
      { type: "roundedRectangle", label: "Rounded Rectangle" },
      { type: "ellipse", label: "Ellipse" },
      { type: "diamond", label: "Diamond" },
      { type: "triangle", label: "Triangle" },
      { type: "hexagon", label: "Hexagon" },
      { type: "parallelogram", label: "Parallelogram" },
      { type: "text", label: "Text" },
    ],
  },
  {
    category: "Flowchart",
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
    items: [
      { type: "entity", label: "Entity" },
      { type: "attribute", label: "Attribute" },
      { type: "relationship", label: "Relationship" },
      { type: "weakEntity", label: "Weak Entity" },
    ],
  },
  {
    category: "DFD",
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
