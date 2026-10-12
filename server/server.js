const express = require('express');
const cors = require('cors');
const path = require('path');

// 引入业务路由
const { router: authRouter } = require('./routes/auth');
const categoriesRouter = require('./routes/categories');
const resourcesRouter = require('./routes/resources');
const panRouter = require('./routes/pan');
const streamRouter = require('./routes/stream');
const usersRouter = require('./routes/users');
const aiRouter = require('./routes/ai');
const localDiskRouter = require('./routes/localDisk');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 托管静态前端资源
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// API 路由挂载
app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/pan', panRouter);
app.use('/api/stream', streamRouter);
app.use('/api/users', usersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/local', localDiskRouter); // 本地硬盘资源扫描、导入与上传
app.use('/api/local-disk', localDiskRouter); // 兼容前端/脚本路径别名

// 首页与应用重定向
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 管理端页面路由
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin/index.html'));
});

// 儿童手机端 / PWA 页面路由
app.get('/kids*', (req, res) => {
  res.sendFile(path.join(publicDir, 'kids/index.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Kids Learning & Pan Resource System',
    timestamp: new Date().toISOString()
  });
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🌟 少儿智能学习系统已启动成功！`);
  console.log(`👉 统一服务入口: http://localhost:${PORT}`);
  console.log(`👉 管理后台地址: http://localhost:${PORT}/admin`);
  console.log(`👉 儿童手机端/PWA: http://localhost:${PORT}/kids`);
  console.log(`👉 本地硬盘媒体库: /app/data/local_media`);
  console.log(`====================================================`);
});
