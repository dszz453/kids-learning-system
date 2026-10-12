# 智学小鹿 - 少儿智能学习系统 (Kids Learning System)

> 专为儿童成长学习与家长精细化管理打造的全栈系统。包含 **Web 管理后台**、**儿童安卓手机端 / PWA**、**全网网盘搜索与转存**、**本地硬盘媒体加载**、**非会员直链加速与息屏播放**、以及 **AI 伴学导师智能体**。

---

## 🌟 系统核心特性概览

### 1. 管理后台端 (Admin Dashboard)
- **网盘资源聚合搜索 (Pansou)**：集成 [pansou](https://github.com/fish2018/pansou) 搜索能力，支持按学科、年级、关键字聚合检索全网网盘儿童学习资源（覆盖夸克、百度、UC、天翼等）。
- **资源存活侦测 (PanCheck)**：集成 [PanCheck](https://github.com/Lampon/PanCheck) 实时探针，自动检测分享链接是否有效、是否被封禁屏蔽、是否需要提取码，并显示响应耗时。
- **四大网盘扫码配置与 Cookie 入库**：支持通过网页端生成**夸克网盘、百度网盘、UC网盘、天翼云盘**的登录二维码，使用手机 App 扫码确认后，系统自动捕获身份凭据（Cookies/Token）并安全加密持久化。
- **一键极速转存**：搜索或输入分享链接后，一键转存至个人网盘的指定目录（如 `/儿童学习资源/乐学英语/`），并可直接一键自动入库为系统学习资源。
- **本地硬盘资源扫描与加载**：
  - 支持指定宿主机或容器内本地硬盘目录（如 `data/local_media` 或 `/app/data/local_media` 或挂载的 `D:/儿童学习资料`）；
  - 自动递归扫描视频（MP4, MKV, WebM）、音频（MP3, M4A, FLAC, OGG）、电子书绘本（PDF）；
  - 智能文件名分类推断与一键批量导入；
  - 支持直接在浏览器上传大文件到本地媒体库。
- **无限级树状层级目录**：一级大模块（如：乐学英语、国学经典、开心故事、科普百科）可自由扩展二级或多级子目录（如：新概念青少版、自然拼读等），配备丰富的卡通 Emoji 图标与适学年龄标签。
- **用户管理与权限有效期**：
  - 新建/管理学生账号，设置独立登录密码；
  - 设置**权限有效截止时间**（精确到年月日，支持一键设置 1个月/半年/1年/永久，到期自动禁用）；
  - 精细化**目录访问权限控制**（基于树状目录按需勾选，未授权目录学生端完全不可见）。
- **非会员加速与音视频转码播放**：
  - 结合 Range 多线程并发代理与 302 直链分块加速引擎，突破非会员限速；
  - 内置视频/音频/PDF在线播放预览；
  - 支持从视频流动态提取纯音频流，服务于手机端息屏听书与省电省流量。
- **AI 大模型接口配置**：
  - 支持配置 DeepSeek、OpenAI、通义千问、智谱清言或自定义兼容接口；
  - 自定义 API Base URL、API Key、Model 及系统提示词（System Prompt）；
  - 内置「测试连通性」与离线儿童教育专家知识图谱兜底引擎。

---

### 2. 儿童手机端 & 网页 PWA (Kids Mobile App / PWA)
- **儿童友好视觉设计**：色彩柔和护眼、圆角大卡片触控、生动大图标、微动效交互。
- **模块大图标层级导航**：与后台树状目录严格映射，一级大卡片点击进入二级子分类，配备便捷的面包屑导航。
- **顶部醒目大搜索框**：支持拼音/汉字全局检索系统内的学习视频、听书音频与彩色画册，提供热搜标签一键直达。
- **AI 伴学导师智能体「智学小鹿」**：
  - 随时呼出对话：智能解答“针对三年级孩子学什么？”、“幼升小怎么启蒙英语？”等；
  - 深度结合当前系统内实际拥有的资源知识库，给出学情规划与具体课程直达跳转卡片。
- **全能媒体播放与核心特色**：
  - **视频播放器**：支持 0.8x~2.0x 倍速、快进快退、全屏、手势拖拽；
  - **听书音频磨耳朵**：浮动迷你播放器、锁屏/息屏持续播放；
  - **彩色绘本教材 PDF 阅读器**：高精度渲染、免跨域限制、支持双指缩放；
  - **息屏播放与后台播放技术 (Core)**：
    - 接入 Web Media Session API，锁屏界面自动呈现课程封面、标题、主讲专区与播放控制卡片；
    - 支持一键切换“息屏磨耳朵模式”，仅拉取音频流，省流 90% 且锁屏后台永不中断！

---

## 🚀 部署指南

### 方式一：Docker 一键部署 (推荐)

系统已提供生产级 `Dockerfile` 与 `docker-compose.yml`，执行一条命令即可在任何 Linux / Windows / macOS 服务器上部署运行。

#### 1. 启动容器
```bash
# 启动并在后台运行
docker compose up -d

# 查看运行状态与日志
docker compose ps
docker compose logs -f
```

#### 2. 挂载本地硬盘媒体库 (可选)
如果您的宿主机上有已有的大容量儿童学习资料（例如位于 `/media/kids_videos` 或 Windows 盘 `D:/KidsData`），只需在 `docker-compose.yml` 的 `volumes` 中添加一行映射：
```yaml
volumes:
  - ./data:/app/data
  # 格式: 宿主机目录 : 容器内本地目录 : 只读模式
  - /media/kids_videos:/app/data/local_media:ro
```
重启容器后，在后台管理端的「本地硬盘导入」中输入 `/app/data/local_media` 点击扫描，即可一键将上百部本地视频批量入库！

#### 3. 访问入口
- **统一导航门户**：`http://服务器IP:3000/`
- **后台管理控制台**：`http://服务器IP:3000/admin`
  - 默认管理员账号：`admin`
  - 默认管理员密码：`admin123`
- **儿童手机端 / PWA**：`http://服务器IP:3000/kids`

---

### 方式二：Node.js 本地直接运行

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 或开发热重启模式
node server/server.js
```

---

## 📱 安卓手机端安装与打包指南

### 1. PWA 一键秒级安装到安卓桌面 (零打包成本)
1. 在安卓手机（或平板）使用 Chrome、Edge 或自带浏览器打开 `http://服务器IP:3000/kids`；
2. 浏览器会自动弹出或点击菜单选择「**添加到主屏幕 / 安装应用**」；
3. 桌面将生成名为「智学小鹿」的独立图标，点击后以**无浏览器地址栏的全屏原生 App** 模式运行，支持离线缓存与锁屏后台播放！

### 2. 封装为独立原生安卓 APK (Capacitor / Webview)
如果需要上架应用商店或分发 `.apk` 安装包：
```bash
# 1. 全局安装 Capacitor CLI
npm install -g @capacitor/cli @capacitor/core @capacitor/android

# 2. 初始化 Capacitor 配置
npx cap init "智学小鹿" "com.kids.learning.app" --web-dir=public/kids

# 3. 添加 Android 平台
npx cap add android

# 4. 构建并打开 Android Studio 进行一键生成 APK
npx cap open android
```

---

## 📂 核心工程目录结构

```text
├── server/                        # 后端核心服务
│   ├── server.js                  # Express 统一入口服务 (端口 3000)
│   ├── database.js                # 持久化数据层 (分类树、资源库、用户、网盘账号、AI配置)
│   ├── services/
│   │   ├── panSearchService.js    # Pansou 网盘资源多源搜索与嗅探引擎
│   │   ├── panCheckService.js     # PanCheck 链接存活/密码侦测探针引擎
│   │   ├── panAccountService.js   # 夸克/百度/UC/天翼 扫码登录与Cookie授权管理
│   │   ├── panTransferService.js  # 一键转存调度与自动入库引擎
│   │   ├── localDiskService.js    # 本地硬盘目录遍历扫描与批量入库服务
│   │   ├── accelerateStreamService.js # Range分块并发直链加速与息屏音频流抽取
│   │   └── aiAgentService.js      # AI 伴学智能体与学情推荐引擎 (含离线专家兜底)
│   └── routes/                    # RESTful API 路由模块
│       ├── auth.js                # JWT 鉴权与有效期拦截
│       ├── categories.js          # 树状层级目录 CRUD
│       ├── resources.js           # 学习资源库 CRUD
│       ├── pan.js                 # 搜索、检测、扫码、转存路由
│       ├── localDisk.js           # 本地硬盘扫描、导入、文件直传
│       ├── stream.js              # 流媒体加速代理、本地流、息屏抽取、PDF代理
│       ├── users.js               # 用户管理、到期时间、目录树权限配置
│       └── ai.js                  # AI 接口配置读写与伴学问答
├── public/                        # 前端双端静态资源
│   ├── index.html                 # 统一门户双端入口页
│   ├── manifest.json              # PWA 独立运行与桌面安装配置
│   ├── sw.js                      # Service Worker 离线与后台播放保障
│   ├── admin/                     # 管理后台 Web 界面
│   │   ├── index.html             # 后台单页主模板 (Tailwind CSS + Lucide)
│   │   └── admin.js               # 后台交互、转存、扫码轮询、目录树、本地扫描
│   └── kids/                      # 儿童手机端 / PWA
│       ├── index.html             # 儿童专属界面 (大卡片、护眼色彩、沉浸式播放器)
│       └── kids.js                # 层级导航、MediaSession息屏播放、AI伴学交互
├── data/                          # 持久化数据目录
│   ├── db.json                    # 数据库存储文件 (自动持久化)
│   └── local_media/               # 默认本地媒体库目录 (示例视频、音频、PDF)
├── Dockerfile                     # 生产级轻量容器构建文件
├── docker-compose.yml             # 一键容器编排与数据卷映射
└── test-suite.js                  # 全链路 10 项核心业务自动化测试套件
```

---

## 🔒 账号权限与默认账户

| 用户名 | 初始密码 | 角色 | 权限范围与有效期 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `admin` | `admin123` | 系统管理员 | 访问所有管理功能与全部目录 (永久) | 用于家长或管理员登录后台管理 |
| `xiaoming` | `123456` | 学生账号 | 授权目录：乐学英语、国学经典、开心故事、科普百科 (2027年到期) | 模拟三年级小学生账号 |
| `lele` | `123456` | 学生账号 | 授权目录：国学经典、开心故事 (受限访问其他目录) | 模拟学前大班幼儿账号 |
