const express = require('express');
const router = express.Router();
const aiAgentService = require('../services/aiAgentService');
const { authMiddleware } = require('./auth');

// 1. 获取 AI 配置信息 (后台管理端)
router.get('/config', authMiddleware, (req, res) => {
  const config = aiAgentService.getConfig();
  res.json({ success: true, config });
});

// 2. 保存/更新 AI 接口配置
router.post('/config', authMiddleware, (req, res) => {
  const { provider, baseUrl, apiKey, model, temperature, systemPrompt } = req.body;
  const updated = aiAgentService.updateConfig({
    provider,
    baseUrl,
    ...(apiKey ? { apiKey } : {}), // 只有传入新 key 时才更新
    model,
    temperature: Number(temperature) || 0.7,
    systemPrompt
  });
  res.json({ success: true, message: 'AI 接口配置已成功保存！', config: updated });
});

// 3. 测试 AI 接口连通性
router.post('/test', authMiddleware, async (req, res) => {
  try {
    const testResult = await aiAgentService.chatWithAgent('你好，请做个简短自我介绍');
    res.json({ success: true, message: 'AI 接口通信正常！', result: testResult });
  } catch (err) {
    res.status(500).json({ success: false, message: '接口测试失败: ' + err.message });
  }
});

// 4. 儿童/家长伴学智能体问答对话 (公开/登录均可调用)
router.post('/chat', async (req, res) => {
  try {
    const { message, context = {} } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: '请输入您想咨询的学习问题' });
    }

    const response = await aiAgentService.chatWithAgent(message, context);
    res.json({ success: true, ...response });
  } catch (err) {
    res.status(500).json({ success: false, message: '智能体对话服务异常: ' + err.message });
  }
});

module.exports = router;
