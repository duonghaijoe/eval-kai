FROM node:20-slim AS frontend-build
WORKDIR /app/web/frontend
COPY web/frontend/package*.json ./
RUN npm ci
COPY web/frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

# Install Node.js (needed for Claude Code CLI)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY scripts/ ./scripts/
COPY web/ ./web/

# Copy built frontend
COPY --from=frontend-build /app/web/frontend/dist ./web/frontend/dist

# Create directories for data persistence
RUN mkdir -p /app/sessions /app/results

# Pre-configure Claude Code: allow all tools, skip permission prompts
# (auth volume will overlay this, but this provides defaults)
RUN mkdir -p /root/.claude && \
    echo '{"permissions":{"allow":["Bash(*)","Read(*)","Write(*)","Edit(*)"]},"skipDangerousModePermissionPrompt":true}' > /root/.claude/settings.json

EXPOSE 8000

WORKDIR /app/web

# Entrypoint: restore .claude.json from backup if missing, then start server
CMD bash -c '\
  if [ ! -f /root/.claude.json ] && ls /root/.claude/backups/.claude.json.backup.* 1>/dev/null 2>&1; then \
    cp "$(ls -t /root/.claude/backups/.claude.json.backup.* | head -1)" /root/.claude.json; \
    echo "Restored .claude.json from backup"; \
  fi; \
  exec python3 -m uvicorn server:app --host 0.0.0.0 --port 8000'
