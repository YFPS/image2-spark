from datetime import datetime
from types import SimpleNamespace
import unittest

from app.routers import admin


class AdminDataTablesTests(unittest.TestCase):
    def test_all_requested_tables_are_allowlisted(self):
        self.assertEqual(
            set(admin.ADMIN_DATA_TABLES.keys()),
            {
                "conversations",
                "messages",
                "credit_transactions",
                "email_verification_tokens",
                "generated_assets",
            },
        )

    def test_email_verification_token_hash_is_masked(self):
        row = SimpleNamespace(
            id=1,
            user_id=2,
            token_hash="a" * 64,
            purpose="verify_email",
            expires_at=datetime(2026, 6, 20, 12, 0, 0),
            used_at=None,
            created_at=datetime(2026, 6, 19, 12, 0, 0),
        )

        data = admin._serialize_admin_data_table_row("email_verification_tokens", row)

        self.assertEqual(data["token_hash"], "aaaaaaaa...aaaaaa")
        self.assertNotEqual(data["token_hash"], "a" * 64)
        self.assertEqual(data["user_id"], 2)

    def test_data_table_item_contains_user_summary(self):
        row = SimpleNamespace(
            id=10,
            user_id=7,
            delta=-2,
            balance_after=18,
            reason="generate",
            ref_type="message",
            ref_id="99",
            note="generate 2 张",
            created_at=datetime(2026, 6, 19, 12, 0, 0),
        )
        user = SimpleNamespace(
            id=7,
            email="buyer@example.com",
            nickname="买家A",
            role="paid",
        )

        data = admin._serialize_admin_data_table_item("credit_transactions", row, user)

        self.assertEqual(data["_user"], {
            "id": 7,
            "email": "buyer@example.com",
            "nickname": "买家A",
            "role": "paid",
        })
        self.assertEqual(data["reason"], "generate")

    def test_data_table_item_contains_linked_conversation_id(self):
        row = SimpleNamespace(
            id=10,
            conversation_id=22,
            role="ai",
            text="完成",
            image_urls=["/api/images/assets/10.png"],
            params=None,
            status="done",
            created_at=datetime(2026, 6, 19, 12, 0, 0),
        )

        data = admin._serialize_admin_data_table_item("messages", row, None)

        self.assertEqual(data["_conversation_id"], 22)

    def test_admin_exposes_user_conversation_reader_routes(self):
        paths = {route.path for route in admin.router.routes}

        self.assertIn("/api/admin/users/{user_id}/conversations", paths)
        self.assertIn("/api/admin/conversations/{conversation_id}", paths)

    def test_admin_message_out_prefers_persisted_asset_urls(self):
        message = SimpleNamespace(
            id=12,
            role="ai",
            text="完成",
            image_urls=["data:image/png;base64,AAAA"],
            params=None,
            status="done",
            created_at=datetime(2026, 6, 19, 12, 0, 0),
        )

        data = admin._to_admin_msg_out(message, {12: ["/api/images/assets/12-0-demo.png"]})

        self.assertEqual(data["image_urls"], ["/api/images/assets/12-0-demo.png"])

    def test_admin_image_item_uses_generated_asset_shape(self):
        asset = SimpleNamespace(
            id=35,
            user_id=3,
            conversation_id=292,
            message_id=3094,
            slot_index=0,
            public_url="/api/images/assets/3094-0-demo.png",
            storage_kind="local",
            status="available",
            width=1024,
            height=1024,
            bytes=1234567,
            created_at=datetime(2026, 6, 19, 12, 0, 0),
            updated_at=datetime(2026, 6, 19, 12, 1, 0),
        )
        user = SimpleNamespace(
            id=3,
            email="admin@example.com",
            nickname="站长",
            role="admin",
        )

        data = admin._serialize_admin_image_asset_item(asset, user)

        self.assertEqual(data["id"], 35)
        self.assertEqual(data["message_id"], 3094)
        self.assertEqual(data["image_url"], "/api/images/assets/3094-0-demo.png")
        self.assertEqual(data["status"], "available")
        self.assertEqual(data["_user"]["nickname"], "站长")


if __name__ == "__main__":
    unittest.main()
