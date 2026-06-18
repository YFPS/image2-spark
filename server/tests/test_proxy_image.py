import json
import types
import unittest
from unittest import mock

import httpx
from starlette.responses import JSONResponse

from app.routers import images


async def _cache_miss(_url: str):
    return None


class _TimeoutClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def head(self, _url: str):
        raise httpx.TimeoutException("head timeout")

    def build_request(self, method: str, url: str):
        return (method, url)

    async def send(self, _request, stream: bool):
        raise httpx.TimeoutException("get timeout")

    async def aclose(self):
        pass


class ProxyImageTests(unittest.IsolatedAsyncioTestCase):
    async def test_proxy_image_returns_504_when_upstream_times_out_before_headers(self):
        settings = types.SimpleNamespace(
            proxy_image_host_allowlist=(),
            openai_base_url="",
            openai_base_url_backup="",
            proxy_image_timeout=3.0,
        )

        with (
            mock.patch.object(images, "get_settings", return_value=settings),
            mock.patch.object(images, "cache_image_get", _cache_miss),
            mock.patch.object(images.httpx, "AsyncClient", _TimeoutClient),
        ):
            response = await images.proxy_image(
                request=object(),
                url="http://67.21.86.146:3015/images/broken.png",
            )

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 504)
        body = json.loads(response.body)
        self.assertEqual(body["error"]["code"], "image_fetch_timeout")
        self.assertEqual(body["error"]["message"], "图片加载超时，请稍后重试")
        self.assertNotIn("upstream", body["error"]["code"])
        self.assertNotIn("上游", body["error"]["message"])


if __name__ == "__main__":
    unittest.main()
