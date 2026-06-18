import unittest

from app.openai_client import UpstreamError, UpstreamTimeout
from app.customer_text import sanitize_customer_note_text
from app.routers.images import _parse_upstream_images, _customer_failure_text


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

    def test_customer_failure_text_hides_internal_provider_words(self):
        cases = [
            _customer_failure_text(
                UpstreamError(500, "备用上游未配置（OPENAI_API_KEY_BACKUP / OPENAI_BASE_URL_BACKUP）")
            ),
            _customer_failure_text(UpstreamTimeout("request timeout")),
            _customer_failure_text(Exception("upstream_error: OPENAI_API_KEY missing")),
        ]

        for text in cases:
            self.assertIn("失败：", text)
            self.assertNotIn("上游", text)
            self.assertNotIn("API", text.upper())
            self.assertNotIn("KEY", text.upper())
            self.assertNotIn("OPENAI", text.upper())
            self.assertNotIn("upstream_error", text)

    def test_customer_note_text_hides_internal_provider_words(self):
        note = sanitize_customer_note_text(
            "生图失败退款：upstream_error: OPENAI_API_KEY missing"
        )

        self.assertEqual(note, "生图失败已退款：生成服务暂时不可用，请稍后再试。")
        self.assertNotIn("上游", note)
        self.assertNotIn("API", note.upper())
        self.assertNotIn("KEY", note.upper())
        self.assertNotIn("OPENAI", note.upper())
        self.assertNotIn("upstream_error", note)


if __name__ == "__main__":
    unittest.main()
