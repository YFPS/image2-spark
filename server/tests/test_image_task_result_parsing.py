import unittest

from app.routers.images import _parse_upstream_images


class ImageTaskResultParsingTests(unittest.TestCase):
    def test_parse_upstream_images_keeps_b64_json_as_data_uri(self):
        images, usage, count = _parse_upstream_images(
            {
                "data": [{"b64_json": "abc123"}],
                "usage": {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3},
            },
            output_format="webp",
        )

        self.assertEqual(images, ["data:image/webp;base64,abc123"])
        self.assertEqual(usage["total_tokens"], 3)
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
