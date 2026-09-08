"""Lightweight OCR helper. Vision services remain the primary extractors."""

from PIL import Image
import io


def inspect_image(image_bytes):
    image = Image.open(io.BytesIO(image_bytes))
    image.load()
    return {
        "width": image.width,
        "height": image.height,
        "mode": image.mode,
        "format": image.format,
        "text_hint": None,
        "note": "OCR text is taken from vision JSON labels; missing OCR is non-fatal.",
    }
