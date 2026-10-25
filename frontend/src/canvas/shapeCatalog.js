/**
 * The shape library, grouped by notation.
 *
 * `family: null` marks the general shapes, which every diagram family offers
 * (see GENERAL_NODE_TYPES). The other groups hold the shapes native to one
 * notation. Nothing is listed twice, so a type id appears exactly once.
 */

export const SHAPE_LIBRARY = [
  {
    category: "General",
    family: null, // universal shapes
    items: [
      { type: "rectangle", label: "Rectangle" },
      { type: "roundedRectangle", label: "Rounded Rectangle" },
      { type: "ellipse", label: "Ellipse" },
      { type: "diamond", label: "Diamond" },
      { type: "triangle", label: "Triangle" },
      { type: "invertedTriangle", label: "Inverted Triangle" },
      { type: "hexagon", label: "Hexagon" },
      { type: "pentagon", label: "Pentagon" },
      { type: "octagon", label: "Octagon" },
      { type: "parallelogram", label: "Parallelogram" },
      { type: "trapezoid", label: "Trapezoid" },
      { type: "cylinder", label: "Cylinder" },
      { type: "multipleDocument", label: "Multiple Documents" },
      { type: "cloud", label: "Cloud" },
      { type: "star", label: "Star" },
      { type: "callout", label: "Callout" },
      { type: "stickyNote", label: "Sticky Note" },
      { type: "text", label: "Text" },
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
      { type: "manualOperation", label: "Manual Operation" },
      { type: "preparation", label: "Preparation" },
      { type: "connector", label: "Connector" },
      { type: "offPageConnector", label: "Off-page Connector" },
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
      { type: "weakEntity", label: "Weak Entity" },
      { type: "relationship", label: "Relationship" },
      { type: "attribute", label: "Attribute" },
      { type: "multivaluedAttribute", label: "Multivalued Attribute" },
      { type: "derivedAttribute", label: "Derived Attribute" },
    ],
  },
  {
    category: "DFD",
    family: "dfd",
    items: [
      { type: "dfdProcess", label: "Process" },
      { type: "externalEntity", label: "External Entity" },
      { type: "dataStore", label: "Data Store" },
      { type: "dataFlow", label: "Data Flow" },
    ],
  },
];

export const TYPE_LABELS = Object.fromEntries(
  SHAPE_LIBRARY.flatMap((g) => g.items.map((i) => [i.type, i.label]))
);

/** Every catalogued type id, in library order. */
export const CATALOG_TYPES = SHAPE_LIBRARY.flatMap((g) => g.items.map((i) => i.type));
