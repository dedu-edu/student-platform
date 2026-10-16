"""Which lab files the browser may show inline instead of downloading."""
import os

# by extension, never by what the uploader claimed. No SVG or HTML: they can
# run scripts.
PREVIEW_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def preview_type(filename: str):
    return PREVIEW_TYPES.get(os.path.splitext(filename)[1].lower())
