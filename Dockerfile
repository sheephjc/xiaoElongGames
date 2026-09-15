# 小鳄龙之家：游戏工作区 + 同源静态文件 / Socket.IO
# 构建：docker build -t trouble-magician .
# 运行：docker run -d -p 8080:8080 -e PORT=8080 trouble-magician
FROM node:22-alpine3.22 AS base
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app

# ---- 依赖层（利用缓存） ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/rules/package.json packages/rules/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY games/trouble-magician/package.json games/trouble-magician/
COPY games/corcodragon-fire/package.json games/corcodragon-fire/
COPY games/corcodragon-fight/package.json games/corcodragon-fight/
COPY games/anqi/package.json games/anqi/
COPY games/zhangzhou-mahjong/package.json games/zhangzhou-mahjong/
RUN pnpm install --frozen-lockfile

# ---- 构建前端 ----
FROM deps AS build
COPY packages/rules packages/rules
COPY apps/web apps/web
COPY games games
RUN pnpm --filter @tm/web build

# ---- 运行时（仅生产依赖） ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/rules packages/rules
COPY apps/server apps/server
COPY apps/web/package.json apps/web/package.json
COPY games games
COPY --from=build /app/apps/web/dist apps/web/dist
RUN pnpm install --frozen-lockfile --prod
EXPOSE 8080
CMD ["pnpm", "--filter", "@tm/server", "start"]
