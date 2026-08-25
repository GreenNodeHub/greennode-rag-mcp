FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
ENV TRANSPORT=http
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
