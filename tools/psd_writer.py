from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Layer:
    name: str
    image: Image.Image
    visible: bool = True
    opacity: int = 255


def _u16(value: int) -> bytes:
    return struct.pack(">H", value)


def _i16(value: int) -> bytes:
    return struct.pack(">h", value)


def _u32(value: int) -> bytes:
    return struct.pack(">I", value)


def _pascal_name(name: str) -> bytes:
    raw = name.encode("macroman", errors="replace")[:255]
    data = bytes([len(raw)]) + raw
    pad = (4 - (len(data) % 4)) % 4
    return data + (b"\0" * pad)


def _unicode_name_block(name: str) -> bytes:
    encoded = name.encode("utf-16be")
    payload = _u32(len(name)) + encoded
    if len(payload) % 2:
        payload += b"\0"
    return b"8BIM" + b"luni" + _u32(len(payload)) + payload


def _rgba_bytes(image: Image.Image, width: int, height: int) -> list[bytes]:
    rgba = image.convert("RGBA")
    if rgba.size != (width, height):
        raise ValueError(
            f"Layer image size {rgba.size} does not match PSD size {(width, height)}"
        )
    arr = np.asarray(rgba, dtype=np.uint8)
    return [
        arr[:, :, 0].tobytes(),
        arr[:, :, 1].tobytes(),
        arr[:, :, 2].tobytes(),
        arr[:, :, 3].tobytes(),
    ]


def write_psd(
    path: str | Path,
    *,
    width: int,
    height: int,
    layers: list[Layer],
    composite: Image.Image,
) -> None:
    """Write a simple Photoshop PSD with full-canvas RGBA layers.

    The writer intentionally uses raw channel data. Files are larger than RLE PSDs,
    but the format is simple and reliable for generated design assets.
    """
    if width <= 0 or height <= 0:
        raise ValueError("PSD width and height must be positive")
    if not layers:
        raise ValueError("PSD requires at least one layer")
    if len(layers) > 32767:
        raise ValueError("PSD layer count exceeds signed 16-bit limit")

    path = Path(path)
    channel_len = width * height
    layer_records = bytearray()
    layer_pixel_data = bytearray()

    for layer in layers:
        channels = _rgba_bytes(layer.image, width, height)
        layer_records += _u32(0) + _u32(0) + _u32(height) + _u32(width)
        layer_records += _u16(4)
        for channel_id in (0, 1, 2, -1):
            layer_records += _i16(channel_id)
            layer_records += _u32(2 + channel_len)

        layer_records += b"8BIM" + b"norm"
        layer_records += bytes(
            [
                max(0, min(255, layer.opacity)),
                0,  # clipping
                0 if layer.visible else 2,  # bit 1 means hidden
                0,
            ]
        )

        extra = bytearray()
        extra += _u32(0)  # layer mask data
        extra += _u32(0)  # layer blending ranges
        extra += _pascal_name(layer.name)
        extra += _unicode_name_block(layer.name)
        layer_records += _u32(len(extra)) + extra

        for channel in channels:
            layer_pixel_data += _u16(0) + channel

    layer_info = bytearray()
    layer_info += _i16(len(layers))
    layer_info += layer_records
    layer_info += layer_pixel_data
    if len(layer_info) % 2:
        layer_info += b"\0"

    layer_and_mask = bytearray()
    layer_and_mask += _u32(len(layer_info)) + layer_info
    layer_and_mask += _u32(0)  # global layer mask info

    composite_rgb = composite.convert("RGB")
    if composite_rgb.size != (width, height):
        raise ValueError("Composite image size does not match PSD size")
    comp_arr = np.asarray(composite_rgb, dtype=np.uint8)
    composite_data = bytearray()
    composite_data += _u16(0)
    composite_data += comp_arr[:, :, 0].tobytes()
    composite_data += comp_arr[:, :, 1].tobytes()
    composite_data += comp_arr[:, :, 2].tobytes()

    header = bytearray()
    header += b"8BPS"
    header += _u16(1)
    header += b"\0" * 6
    header += _u16(3)
    header += _u32(height)
    header += _u32(width)
    header += _u16(8)
    header += _u16(3)

    payload = bytearray()
    payload += header
    payload += _u32(0)  # color mode data
    payload += _u32(0)  # image resources
    payload += _u32(len(layer_and_mask)) + layer_and_mask
    payload += composite_data

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
