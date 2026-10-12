# ==========================================
# 少儿智能学习系统 - 生产级 Dockerfile
# ==========================================

FROM node:22-alpine AS runner

# 设置工作目录
WORKDIR /app

# 安装必要的系统库（如构建依赖或媒体支持）
RUN apk add --no-cache tzdata curl

# 设置时区为亚洲/上海
ENV TZ=Asia/Shanghai
ENV NODE_ENV=production
ENV PORT=3000

# 拷贝依赖配置
COPY package*.json ./

# 仅安装生产依赖
RUN npm ci --only=production

# 拷贝项目源代码与前端资源
COPY server/ ./server/
COPY public/ ./public/

# 拷贝版本信息文件（/api/version 会读取 CHANGELOG.md 展示更新日志）
COPY CHANGELOG.md ./CHANGELOG.md
COPY scripts/ ./scripts/

# 创建持久化数据目录
RUN mkdir -p /app/data && chown -R node:node /app

# 切换为安全非 root 用户
USER node

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# 启动服务
CMD ["node", "server/server.js"]
