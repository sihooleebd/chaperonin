# ─── Stage 1: build frontend (Vite → static dist) ───────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ─── Stage 2: runtime (Python backend + baked frontend + docker CLI) ────────
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && arch=$(uname -m) \
 && curl -fsSL "https://download.docker.com/linux/static/stable/${arch}/docker-27.3.1.tgz" -o /tmp/docker.tgz \
 && tar -xzf /tmp/docker.tgz -C /tmp \
 && mv /tmp/docker/docker /usr/local/bin/docker \
 && rm -rf /tmp/docker /tmp/docker.tgz \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY backend/ /app/backend/
COPY --from=frontend-build /build/dist /app/frontend_dist

ENV CHAPERONIN_FRONTEND_DIST=/app/frontend_dist \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend
EXPOSE 8000
CMD ["python3", "-m", "chaperonin.server"]
