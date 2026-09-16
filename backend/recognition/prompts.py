"""Shared prompt fragments for the vision recognition services.

Both Gemini and Hugging Face append these blocks so that an explicit user
selection is treated as authoritative, and auto-detection gets concrete
guidance for telling the diagram families apart.
"""

AUTO_GUIDE = """
Before extracting, decide which family this diagram belongs to:
- flowchart: start/end terminators, process boxes, decision diamonds, arrowed control flow.
- er: entities (rectangles), relationships (diamonds), attributes (ellipses/ovals) attached to entities.
- uml: class boxes with attribute/method compartments, interfaces, actors, use cases.
- dfd: processes (circles or rounded boxes), data stores (open-ended or double-lined shapes), external entities (squares), labeled data flows.
Pick the family that best matches the notation, not just the shapes present.
"""

HINT_BLOCKS = {
    "flowchart": (
        "\nThe user identified this as a FLOWCHART. Treat that as authoritative.\n"
        "Classify per flowchart notation: rounded/oval end caps = terminator, plain boxes = process,\n"
        "diamonds = decision, parallelograms/slanted boxes = io, document icons = document.\n"
        "diagram_type must be \"flowchart\".\n"
    ),
    "er": (
        "\nThe user identified this as an ER DIAGRAM. Treat that as authoritative.\n"
        "Classify per ER notation: rectangles/boxes = entity, diamonds = relationship,\n"
        "ellipses/ovals = attribute. Every attribute oval MUST appear: either as its own\n"
        "node with type \"attribute\", or as text inside the owning entity's\n"
        "\"attributes\" array. Do not omit attribute ovals even when the sketch is messy.\n"
        "Connect entities to their relationship diamonds and attributes to their owner.\n"
        "diagram_type must be \"er\".\n"
    ),
    "uml": (
        "\nThe user identified this as a UML CLASS DIAGRAM. Treat that as authoritative.\n"
        "Every class box has THREE compartments and all three must be filled:\n"
        "1) the class name -> the node's \"label\" (the name alone, nothing else);\n"
        "2) its attributes -> the node's \"attributes\" array, one string per member\n"
        "   (keep any visibility marker, e.g. \"- name: String\");\n"
        "3) its methods -> the node's \"methods\" array, one string per member\n"
        "   (e.g. \"+ enroll(): void\").\n"
        "Members ending in \"()\" or containing \"(\" are methods, everything else is an attribute.\n"
        "Never merge the name, attributes and methods into one label.\n"
        "Classify per UML notation: boxes (especially with internal compartment lines) = class,\n"
        "circles/ovals = usecase, stick figures = actor, boxes marked «interface» = interface.\n"
        "diagram_type must be \"uml\".\n"
    ),
    "dfd": (
        "\nThe user identified this as a DATA FLOW DIAGRAM (DFD). Treat that as authoritative.\n"
        "Classify per DFD notation: circles/rounded boxes/labelled process boxes = dfdProcess,\n"
        "open-ended or double-bar rectangles and cylinders = dataStore, plain outer squares = externalEntity,\n"
        "and label the arrows with the data that flows. diagram_type must be \"dfd\".\n"
    ),
}


def diagram_hint_block(diagram_type):
    t = str(diagram_type or "auto").strip().lower()
    return HINT_BLOCKS.get(t, AUTO_GUIDE)
