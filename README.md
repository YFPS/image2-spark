# image2

最小空架子。

- `client/` — React + Vite + TypeScript + Tailwind
- `server/` — FastAPI

## 前端

```bash
cd client
npm install
npm run dev
```

## 后端

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
