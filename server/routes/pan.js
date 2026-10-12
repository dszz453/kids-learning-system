const express = require('express');
const router = express.Router();
const axios = require('axios');
const panSearchService = require('../services/panSearchService');
const panCheckService = require('../services/panCheckService');
const panAccountService = require('../services/panAccountService');
const panTransferService = require('../services/panTransferService');
const { authMiddleware } = require('./auth');

// 1. pansou 网盘资源聚合搜索接口
router.get('/search', async (req, res) => {
  try {
    const { keyword, panType = 'all', page = 1, pageSize = 20 } = req.query;
    const result = await panSearchService.search(keyword, {
      panType,
      page: Number(page),
      pageSize: Number(pageSize)
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: '搜索服务异常: ' + err.message });
  }
});

// 2. PanCheck 单个网盘链接存活与密码侦测
router.post('/check', async (req, res) => {
  try {
    const { url, pwd = '' } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: '请提供网盘链接' });
    }

    const checkResult = await panCheckService.checkUrl(url, pwd);
    res.json({ success: true, ...checkResult });
  } catch (err) {
    res.status(500).json({ success: false, message: '存活检测异常: ' + err.message });
  }
});

// 3. 批量存活检测
router.post('/batch-check', async (req, res) => {
  try {
    const { items = [] } = req.body;
    const checkPromises = items.map(item => panCheckService.checkUrl(item.url, item.pwd || ''));
    const results = await Promise.all(checkPromises);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: '批量检测异常: ' + err.message });
  }
});

// 4. 获取各大网盘账号配置状态（夸克、百度、UC、天翼）
router.get('/accounts', authMiddleware, (req, res) => {
  const accounts = panAccountService.getAccounts();
  res.json({ success: true, accounts });
});

// 5. 创建扫码登录二维码会话 (夸克/百度/UC/天翼)
const handleQrCreate = async (req, res) => {
  try {
    const { panType } = req.body;
    if (!panType) {
      return res.status(400).json({ success: false, message: '请指定网盘类型' });
    }

    const session = await panAccountService.createQrSession(panType);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: '生成扫码会话失败: ' + err.message });
  }
};
router.post('/qrcode/create', authMiddleware, handleQrCreate);
router.post('/qrcode/generate', authMiddleware, handleQrCreate); // 兼容别名路由

// 6. 轮询二维码扫码状态
router.get('/qrcode/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const status = panAccountService.checkQrStatus(sessionId);
  res.json({ success: true, ...status });
});

// 7. 确认扫码并绑定（模拟完成手机授权并入库Cookie）
router.post('/qrcode/confirm', authMiddleware, (req, res) => {
  const { sessionId, customCookies } = req.body;
  if (!sessionId) {
    return res.status(400).json({ success: false, message: '缺少会话ID' });
  }

  const result = panAccountService.confirmLogin(sessionId, customCookies);
  res.json(result);
});

// 8. 手动配置/更新网盘Cookie
router.post('/accounts/cookies', authMiddleware, (req, res) => {
  const { panType, cookies, username } = req.body;
  if (!panType || !cookies) {
    return res.status(400).json({ success: false, message: '网盘类型与Cookie不能为空' });
  }

  const updated = panAccountService.updateCookies(panType, cookies, username);
  if (!updated) {
    return res.status(404).json({ success: false, message: '未找到对应网盘账号' });
  }

  res.json({ success: true, account: updated, message: 'Cookie配置成功更新！' });
});

// 9. 一键转存资源到指定网盘与目录
router.post('/transfer', authMiddleware, async (req, res) => {
  try {
    const result = await panTransferService.transfer(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: '转存失败: ' + err.message });
  }
});

// 10. 获取转存任务历史列表
router.get('/transfer/tasks', authMiddleware, (req, res) => {
  const tasks = panTransferService.getTasks();
  res.json({ success: true, tasks });
});

// 11. 获取 Pansou 搜索端点配置
router.get('/pansou/config', authMiddleware, (req, res) => {
  const db = require('../database');
  const config = db.get('pansouConfig') || {
    apiUrl: 'http://localhost:8080',
    enabled: false,
    timeout: 10000,
    sources: ['quark', 'baidu', 'uc', 'cloud189']
  };
  res.json({ success: true, config });
});

// 12. 更新 Pansou 搜索端点配置与连通性测试
router.post('/pansou/config', authMiddleware, async (req, res) => {
  try {
    const { apiUrl, enabled, timeout, sources } = req.body;
    const db = require('../database');
    const oldConfig = db.get('pansouConfig') || {};
    const newConfig = {
      apiUrl: (apiUrl || 'http://localhost:8080').trim().replace(/\/+$/, ''),
      enabled: Boolean(enabled),
      timeout: Number(timeout) || 10000,
      sources: Array.isArray(sources) ? sources : ['quark', 'baidu', 'uc', 'cloud189'],
      updatedAt: new Date().toISOString()
    };
    db.set('pansouConfig', newConfig);
    res.json({ success: true, config: newConfig, message: 'Pansou 端点配置已成功保存！' });
  } catch (err) {
    res.status(500).json({ success: false, message: '保存 Pansou 配置失败: ' + err.message });
  }
});

// 13. 测试 Pansou 实例连通性
router.post('/pansou/test', authMiddleware, async (req, res) => {
  const { apiUrl } = req.body;
  if (!apiUrl) {
    return res.status(400).json({ success: false, message: '请输入待测试的 Pansou 服务地址' });
  }
  const cleanUrl = apiUrl.trim().replace(/\/+$/, '');
  try {
    const start = Date.now();
    // 探测 Pansou 的根路径或 /api/search 或 ping 接口
    const resp = await axios.get(cleanUrl, { timeout: 4000 }).catch(e => {
      // 即使404也说明服务连通且有响应
      if (e.response) return e.response;
      throw e;
    });
    const duration = Date.now() - start;
    res.json({
      success: true,
      reachable: true,
      status: resp.status,
      durationMs: duration,
      message: `连接成功 (HTTP ${resp.status})，响应耗时 ${duration}ms`
    });
  } catch (err) {
    res.json({
      success: false,
      reachable: false,
      message: `无法连接到该地址 (${cleanUrl}): ${err.message}`
    });
  }
});

module.exports = router;
