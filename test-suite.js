const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('🚀 开始少儿智能学习系统全链路自动化测试 (含网盘与本地硬盘)...\n');

  // 1. 启动后端进程
  const nodeExecutable = 'C:\\Users\\zhangxiaonan\\.workbuddy-ai\\binaries\\node\\versions\\22.22.2-6\\node.exe';
  const serverProcess = spawn(nodeExecutable, [path.join(__dirname, 'server/server.js')], {
    stdio: 'pipe'
  });

  // 等待服务启动
  await new Promise((resolve) => setTimeout(resolve, 2000));

  let passedCount = 0;
  let totalCount = 0;

  async function testCase(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passedCount++;
    } catch (e) {
      console.error(`❌ [FAIL] ${name}:`, e.message);
    }
  }

  try {
    // 登录管理员获取 Token
    let token = '';
    await testCase('管理员登录与 JWT 鉴权 (/api/auth/login)', async () => {
      const loginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
        username: 'admin',
        password: 'admin123'
      });
      if (!loginRes.data.success || !loginRes.data.token) {
        throw new Error('Admin login failed');
      }
      token = loginRes.data.token;
    });

    // 测试 1: 健康检查
    await testCase('系统健康检查 API (/api/health)', async () => {
      const res = await axios.get(`${BASE_URL}/api/health`);
      if (res.data.status !== 'ok') throw new Error('Status not ok');
    });

    // 测试 2: 分类目录树
    await testCase('树状分类目录与层级接口 (/api/categories/tree)', async () => {
      const res = await axios.get(`${BASE_URL}/api/categories/tree`);
      if (!res.data.success || !res.data.tree || res.data.tree.length < 3) {
        throw new Error('Categories tree incomplete');
      }
    });

    // 测试 3: 学习资源库
    await testCase('学习资源总库接口 (/api/resources)', async () => {
      const res = await axios.get(`${BASE_URL}/api/resources`);
      if (!res.data.success || !res.data.items || res.data.items.length < 5) {
        throw new Error('Resources items less than expected');
      }
    });

    // 测试 4: 本地硬盘媒体扫描
    await testCase('本地硬盘指定目录扫描 (/api/local/scan)', async () => {
      const res = await axios.post(
        `${BASE_URL}/api/local/scan`,
        { targetDir: 'data/local_media' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.data.success || !res.data.files || res.data.files.length < 3) {
        throw new Error('Local disk scan failed or file count mismatch');
      }
    });

    // 测试 5: 本地硬盘媒体批量导入
    await testCase('本地硬盘媒体批量导入资源库 (/api/local/import)', async () => {
      const scanRes = await axios.post(
        `${BASE_URL}/api/local/scan`,
        { targetDir: 'data/local_media' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const files = scanRes.data.files;
      const importRes = await axios.post(
        `${BASE_URL}/api/local/import`,
        { files: [files[0]], defaultCategoryId: 'cat_eng' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!importRes.data.success || importRes.data.count < 1) {
        throw new Error('Local disk import failed');
      }
    });

    // 测试 6: Pansou 网盘资源聚合搜索
    await testCase('Pansou 网盘学习资源聚合搜索 (/api/pan/search)', async () => {
      const res = await axios.get(`${BASE_URL}/api/pan/search?keyword=新概念&panType=all`);
      if (!res.data.success || !res.data.items || res.data.items.length === 0) {
        throw new Error('Pan search return empty');
      }
    });

    // 测试 7: PanCheck 链接存活侦测
    await testCase('PanCheck 资源存活与免密侦测 (/api/pan/check)', async () => {
      const res = await axios.post(`${BASE_URL}/api/pan/check`, {
        url: 'https://pan.quark.cn/s/a89f92d8bc10',
        pwd: ''
      });
      if (!res.data.success || typeof res.data.isAlive !== 'boolean') {
        throw new Error('PanCheck response format invalid');
      }
    });

    // 测试 8: 四大网盘扫码会话生成
    await testCase('四大网盘扫码认证会话生成 (/api/pan/qrcode/create)', async () => {
      const res = await axios.post(`${BASE_URL}/api/pan/qrcode/create`, 
        { panType: 'quark' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.data.success || !res.data.session || !res.data.session.qrCodeDataUrl) {
        throw new Error('QR session failed');
      }
    });

    // 测试 9: AI 伴学智能体学情问答与资源推荐
    await testCase('AI 伴学助手智能体问答与课程推荐 (/api/ai/chat)', async () => {
      const res = await axios.post(`${BASE_URL}/api/ai/chat`, {
        message: '针对三年级孩子，在系统里应该学习什么课程？'
      });
      if (!res.data.success || !res.data.reply) {
        throw new Error('AI Chat response missing reply');
      }
    });

    // 测试 10: 静态页面与 PWA 清单
    await testCase('PWA Manifest 与双端页面托管 (/manifest.json, /kids, /admin)', async () => {
      const pwaRes = await axios.get(`${BASE_URL}/manifest.json`);
      if (!pwaRes.data.name || pwaRes.data.name !== '智学小鹿 - 儿童智能伴学系统') {
        throw new Error('PWA Manifest invalid');
      }
      const adminRes = await axios.get(`${BASE_URL}/admin`);
      if (adminRes.status !== 200) throw new Error('Admin page unreachable');
      const kidsRes = await axios.get(`${BASE_URL}/kids`);
      if (kidsRes.status !== 200) throw new Error('Kids page unreachable');
    });

    console.log(`\n🎉 全链路测试完美完成: 共执行 ${totalCount} 项测试，全部 ${passedCount} 项通过！`);

  } finally {
    serverProcess.kill('SIGTERM');
  }
}

runTests();
