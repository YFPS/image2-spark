import unittest

from pydantic import ValidationError

from app.openai_client import UpstreamError, UpstreamTimeout
from app.customer_text import sanitize_customer_note_text
from app.routers.images import (
    _apply_multi_view_grid_prompt,
    _apply_view_angle_prompt,
    _customer_failure_text,
    _parse_upstream_images,
)
from app.schemas import GenerateRequest


class ImageTaskResultParsingTests(unittest.TestCase):
    def test_view_angle_prompt_appends_basic_direction_instruction(self):
        prompt = _apply_view_angle_prompt("一名宇航员站在雨夜街头", 4)

        self.assertIn("一名宇航员站在雨夜街头", prompt)
        self.assertIn("Camera/view instruction: right side view.", prompt)

    def test_view_angle_prompt_supports_top_and_bottom_views(self):
        top_prompt = _apply_view_angle_prompt("一台复古机器人", 5)
        bottom_prompt = _apply_view_angle_prompt("一台复古机器人", 6)

        self.assertIn("Camera/view instruction: top view, overhead view.", top_prompt)
        self.assertIn("Camera/view instruction: bottom view, low underside view.", bottom_prompt)

    def test_view_angle_prompt_supports_45_degree_views(self):
        front_left = _apply_view_angle_prompt("一台复古机器人", 7)
        rear_right = _apply_view_angle_prompt("一台复古机器人", 10)

        self.assertIn("front-left 45-degree three-quarter view", front_left)
        self.assertIn("rear-right 45-degree three-quarter back view", rear_right)

    def test_view_angle_prompt_supports_multiview_ranges(self):
        basic = _apply_view_angle_prompt("角色设定图", 11)
        full = _apply_view_angle_prompt("角色设定图", 12)

        self.assertIn("numbered multi-view reference sheet covering views 0 through 6", basic)
        self.assertIn("numbered multi-view reference sheet covering views 0 through 10", full)

    def test_multi_view_grid_prompt_adds_crop_friendly_grid_instruction(self):
        prompt = _apply_multi_view_grid_prompt("角色设定图", True, 12)

        self.assertIn("clean multi-panel grid", prompt)
        self.assertIn("visible gutters", prompt)
        self.assertIn("crop-safe padding", prompt)

    def test_multi_view_grid_prompt_only_applies_to_multi_view_angles(self):
        prompt = "角色设定图"

        self.assertEqual(_apply_multi_view_grid_prompt(prompt, True, 4), prompt)
        self.assertEqual(_apply_multi_view_grid_prompt(prompt, False, 12), prompt)

    def test_view_angle_zero_keeps_prompt_unchanged(self):
        prompt = "一名宇航员站在雨夜街头"

        self.assertEqual(_apply_view_angle_prompt(prompt, 0), prompt)

    def test_generate_request_rejects_unknown_view_angle(self):
        with self.assertRaises(ValidationError):
            GenerateRequest(prompt="测试", view_angle=13)

    def test_generate_request_accepts_extended_view_angle_options(self):
        self.assertEqual(GenerateRequest(prompt="测试", view_angle=10).view_angle, 10)
        self.assertEqual(GenerateRequest(prompt="测试", view_angle=12).view_angle, 12)

    def test_generate_request_accepts_multi_view_grid_flag(self):
        req = GenerateRequest(prompt="测试", view_angle=12, multi_view_grid=True)

        self.assertTrue(req.multi_view_grid)

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

    def test_parse_upstream_images_accepts_feiyu_image_url_variants(self):
        images, _usage, count = _parse_upstream_images(
            {
                "data": [
                    {"image_url": "https://cdn.example/a.png"},
                    {"image_url": {"url": "https://cdn.example/b.png"}},
                ]
            }
        )

        self.assertEqual(
            images,
            ["https://cdn.example/a.png", "https://cdn.example/b.png"],
        )
        self.assertEqual(count, 2)

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

    def test_customer_failure_text_explains_credit_unavailable_without_internal_words(self):
        text = _customer_failure_text(UpstreamError(402, "上游返回 402"))

        self.assertEqual(text, "失败：当前无法完成生成，请联系管理员处理。")
        self.assertNotIn("上游", text)
        self.assertNotIn("服务器", text)
        self.assertNotIn("额度", text)
        self.assertNotIn("API", text.upper())
        self.assertNotIn("KEY", text.upper())

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

    def test_customer_note_text_explains_credit_unavailable(self):
        note = sanitize_customer_note_text("生图失败退款：upstream_error: 上游返回 402")

        self.assertEqual(note, "生图失败已退款：当前无法完成生成，请联系管理员处理。")
        self.assertNotIn("上游", note)
        self.assertNotIn("服务器", note)
        self.assertNotIn("额度", note)
        self.assertNotIn("upstream_error", note)


if __name__ == "__main__":
    unittest.main()
