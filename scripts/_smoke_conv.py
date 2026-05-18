"""conversations API 烟囱测试（中文 body 在 Windows shell 转义麻烦，用 Python 直跑）"""
import json
import urllib.parse
import urllib.request


def req(method, url, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


BASE = "http://127.0.0.1:8000"

# 登录
code, body = req("POST", f"{BASE}/api/auth/login",
                 {"email": "test-overlay-2026@example.com", "password": "Pass1234abc"})
print("login:", code)
token = json.loads(body)["access_token"]

# 新建会话
code, body = req("POST", f"{BASE}/api/conversations", token=token)
print("create:", code, body)
conv_id = json.loads(body)["id"]

# user msg
code, body = req("POST", f"{BASE}/api/conversations/{conv_id}/messages",
                 {"role": "user", "text": "画一只在月球上的猫"}, token=token)
print("post user msg:", code, body)

# ai msg
code, body = req("POST", f"{BASE}/api/conversations/{conv_id}/messages",
                 {"role": "ai", "text": "已生成 1 张",
                  "image_urls": ["https://example.com/a.png"],
                  "params": {"size": "1024x1024", "model": "gpt-image-2"}}, token=token)
print("post ai msg:", code, body)

# 详情
code, body = req("GET", f"{BASE}/api/conversations/{conv_id}", token=token)
print("detail:", code, body)

# rename + pin
code, body = req("PATCH", f"{BASE}/api/conversations/{conv_id}",
                 {"title": "月球猫探险", "pinned": True}, token=token)
print("patch:", code, body)

# 搜索
q = urllib.parse.quote("月球")
code, body = req("GET", f"{BASE}/api/conversations?q={q}", token=token)
print("search 月球:", code, body)

# 搜索匹配 title 而不是 message
code, body = req("GET", f"{BASE}/api/conversations?q={urllib.parse.quote('探险')}", token=token)
print("search 探险:", code, body)

# pinned 过滤
code, body = req("GET", f"{BASE}/api/conversations?pinned=1", token=token)
print("pinned=1:", code, body)

# 软删
code, body = req("DELETE", f"{BASE}/api/conversations/{conv_id}", token=token)
print("delete:", code)

# 删后列表
code, body = req("GET", f"{BASE}/api/conversations", token=token)
print("list after delete:", code, body)

# 删后详情应 404
code, body = req("GET", f"{BASE}/api/conversations/{conv_id}", token=token)
print("detail after delete:", code, body)
