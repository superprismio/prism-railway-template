FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python-is-python3 \
    build-essential \
    pkg-config \
    libopus-dev \
    ca-certificates \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src

RUN npm run build

CMD ["sh", "-c", "node dist/index.js"]
