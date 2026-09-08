import io
from PIL import Image

ALLOWED = {"image/png": ("PNG",), "image/jpeg": ("JPEG",), "image/jpg": ("JPEG",)}
MAX_PIXELS = 20_000_000


class InvalidImageError(Exception):
    pass


def validate_image(file_storage, max_bytes):
    filename = (file_storage.filename or "").lower()
    mime = (file_storage.mimetype or "").lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in {"image/png", "image/jpeg"} and not filename.endswith((".png", ".jpg", ".jpeg")):
        raise InvalidImageError("Unsupported file type. Use PNG, JPG, or JPEG.")

    data = file_storage.read()
    file_storage.seek(0)
    if not data:
        raise InvalidImageError("Empty file.")
    if len(data) > max_bytes:
        raise InvalidImageError("Image exceeds size limit.")
    if not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8")):
        raise InvalidImageError("File content is not a valid PNG or JPEG image.")

    try:
        image = Image.open(io.BytesIO(data))
        image.verify()
    except Exception as exc:
        raise InvalidImageError("Could not decode image.") from exc

    image = Image.open(io.BytesIO(data))
    if image.width * image.height > MAX_PIXELS:
        raise InvalidImageError("Image resolution is too large.")
    detected = "image/png" if image.format == "PNG" else "image/jpeg"
    return data, detected, image.size
