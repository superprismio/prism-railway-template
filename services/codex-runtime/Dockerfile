FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./

RUN npm install

RUN npm install -g @railway/cli

COPY . .

RUN npm run build \
  && npm prune --omit=dev

EXPOSE 3030

CMD ["npm", "run", "start"]
