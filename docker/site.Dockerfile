FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/site/package.json services/site/package.json
RUN npm ci --workspace @prism-railway/site --include-workspace-root=false

COPY packages/contracts packages/contracts
COPY services/site services/site

RUN npm run build --workspace @prism-railway/site

WORKDIR /app/services/site

EXPOSE 3100

CMD ["npm", "run", "start"]
