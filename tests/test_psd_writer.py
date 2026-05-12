from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from tools.psd_writer import Layer, write_psd


class PsdWriterTests(unittest.TestCase):
    def test_writes_layered_rgb_psd_that_pillow_can_open(self) -> None:
        size = (12, 10)
        background = Image.new("RGBA", size, (240, 240, 240, 255))
        red = Image.new("RGBA", size, (0, 0, 0, 0))
        red_arr = np.array(red)
        red_arr[2:7, 3:9] = (255, 0, 0, 255)
        red = Image.fromarray(red_arr, "RGBA")

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "sample.psd"
            write_psd(
                out,
                width=size[0],
                height=size[1],
                layers=[
                    Layer("background", background),
                    Layer("red square", red),
                ],
                composite=Image.alpha_composite(background, red),
            )

            with Image.open(out) as opened:
                self.assertEqual(opened.size, size)
                self.assertEqual(opened.mode, "RGB")

            data = out.read_bytes()
            self.assertIn(b"background", data)
            self.assertIn(b"red square", data)
            self.assertIn((2).to_bytes(2, "big", signed=True), data)

    def test_hidden_layers_set_hidden_flag(self) -> None:
        size = (4, 4)
        layer = Image.new("RGBA", size, (1, 2, 3, 4))

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "hidden.psd"
            write_psd(
                out,
                width=size[0],
                height=size[1],
                layers=[Layer("hidden reference", layer, visible=False)],
                composite=Image.new("RGBA", size, (0, 0, 0, 255)),
            )

            data = out.read_bytes()
            name_at = data.index(b"hidden reference")
            self.assertIn(b"\x02", data[max(0, name_at - 64) : name_at])


if __name__ == "__main__":
    unittest.main()
