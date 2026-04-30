FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src

RUN npm run build \
  && npm prune --omit=dev

CMD ["npm", "run", "start"]
