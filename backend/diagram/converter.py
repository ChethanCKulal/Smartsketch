"""Canvas adapter helpers. Recognition never talks to React Flow directly."""

from .normalizer import to_canonical_diagram


def recognition_to_canonical(normalized):
    return to_canonical_diagram(normalized)
