import unittest
from io import BytesIO
from unittest.mock import patch

import numpy as np
from PIL import Image

from app import segment_service


class SegmentServiceTests(unittest.TestCase):
    def test_filter_alpha_keeps_only_components_that_touch_selection(self):
        alpha = np.zeros((80, 120), dtype=np.uint8)
        alpha[5:20, 5:50] = 255  # Same-looking distractor outside the selected target.
        alpha[40:60, 10:55] = 255
        alpha[45:55, 54:80] = 255  # Connected spill that should remain with the target.

        filtered = segment_service._keep_components_touching_rect(
            alpha,
            x0=12,
            y0=42,
            x1=52,
            y1=58,
        )

        self.assertEqual(filtered[10, 10], 0)
        self.assertEqual(filtered[45, 20], 255)
        self.assertEqual(filtered[50, 75], 255)

    def test_filter_alpha_drops_large_component_that_only_grazes_selection(self):
        alpha = np.zeros((80, 140), dtype=np.uint8)
        alpha[40:60, 10:45] = 255  # Selected target.
        alpha[:, 100:140] = 255  # Large unrelated object.
        alpha[42:58, 50:140] = 255  # The unrelated object grazes the selection edge.

        filtered = segment_service._keep_components_touching_rect(
            alpha,
            x0=12,
            y0=42,
            x1=52,
            y1=58,
        )

        self.assertEqual(filtered[45, 20], 255)
        self.assertEqual(filtered[45, 120], 0)

    def test_segment_grabcut_crops_to_seeded_component_not_all_foreground(self):
        src = Image.new("RGB", (100, 80), "white")
        buf = BytesIO()
        src.save(buf, format="PNG")

        def fake_grabcut(_bgr, mask, _rect, _bgd_model, _fgd_model, _iters, _mode):
            mask[:, :] = segment_service.cv2.GC_BGD
            mask[5:20, 5:30] = segment_service.cv2.GC_PR_FGD
            mask[40:60, 10:50] = segment_service.cv2.GC_PR_FGD

        with patch.object(segment_service.cv2, "grabCut", side_effect=fake_grabcut):
            png = segment_service.segment_grabcut(
                buf.getvalue(),
                x=12,
                y=42,
                w=30,
                h=15,
                padding_factor=0,
            )

        out = Image.open(BytesIO(png))
        self.assertLess(out.height, 35)
        self.assertLess(out.width, 50)

    def test_segment_sync_forwards_padding_factor_to_grabcut(self):
        class Settings:
            segment_backend = "grabcut"

        with (
            patch.object(segment_service, "get_settings", return_value=Settings()),
            patch.object(segment_service, "segment_grabcut", return_value=b"png") as grabcut,
        ):
            result = segment_service.segment_sync(b"img", 1, 2, 3, 4, 1.25)

        self.assertEqual(result, b"png")
        grabcut.assert_called_once_with(b"img", 1, 2, 3, 4, 1.25)

    def test_segment_sync_routes_to_sam_backend(self):
        class Settings:
            segment_backend = "sam"

        with (
            patch.object(segment_service, "get_settings", return_value=Settings()),
            patch.object(segment_service, "segment_sam", return_value=b"png") as sam,
        ):
            result = segment_service.segment_sync(b"img", 1, 2, 3, 4, 1.25)

        self.assertEqual(result, b"png")
        sam.assert_called_once_with(b"img", 1, 2, 3, 4, 1.25)

    def test_segment_sam_uses_box_prompt_and_outputs_tight_alpha_png(self):
        src = Image.new("RGB", (100, 80), "white")
        buf = BytesIO()
        src.save(buf, format="PNG")

        class FakePredictor:
            def __init__(self):
                self.image_shape = None
                self.box = None

            def set_image(self, image):
                self.image_shape = image.shape

            def predict(self, box, multimask_output):
                self.box = box
                mask = np.zeros((80, 100), dtype=bool)
                mask[20:50, 30:70] = True
                return np.array([mask]), np.array([0.99]), None

        predictor = FakePredictor()
        with patch.object(segment_service, "get_sam_predictor", return_value=predictor):
            png = segment_service.segment_sam(
                buf.getvalue(),
                x=28,
                y=18,
                w=45,
                h=35,
                padding_factor=1.0,
            )

        out = Image.open(BytesIO(png)).convert("RGBA")
        self.assertEqual(tuple(predictor.box.tolist()), (28, 18, 73, 53))
        self.assertEqual(out.size, (48, 38))
        self.assertEqual(out.getpixel((4, 4))[3], 255)
        self.assertEqual(out.getpixel((0, 0))[3], 0)


if __name__ == "__main__":
    unittest.main()
