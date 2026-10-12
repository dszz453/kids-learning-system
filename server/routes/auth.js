const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../database');

const JWT_SECRET = 'kids_learning_secret_jwt_2026';

// 登录接口
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '请输入账号和密码' });
  }

  const user = db.find('users', u => u.username === username);
  if (!user) {
    return res.status(401).json({ success: false, message: '账号或密码错误' });
  }

  const isMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: '账号或密码错误' });
  }

  // 检查账号是否启用
  if (user.active === false) {
    return res.status(403).json({ success: false, message: '该账号已被停用，请联系管理员' });
  }

  // 检查账号有效期
  if (user.expireAt) {
    const expireDate = new Date(user.expireAt);
    if (expireDate < new Date()) {
      return res.status(403).json({ 
        success: false, 
        message: `账号权限已于 ${expireDate.toLocaleDateString()} 到期，请联系管理员续期` 
      });
    }
  }

  const token = jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      allowedCategoryIds: user.allowedCategoryIds 
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      grade: user.grade,
      expireAt: user.expireAt,
      allowedCategoryIds: user.allowedCategoryIds
    }
  });
});

// 获取当前用户个人信息与权限
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  try {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.find('users', u => u.id === decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 检查有效期
    if (user.expireAt && new Date(user.expireAt) < new Date()) {
      return res.status(403).json({ success: false, message: '账号权限已过期' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        grade: user.grade,
        expireAt: user.expireAt,
        allowedCategoryIds: user.allowedCategoryIds
      }
    });
  } catch (err) {
    res.status(401).json({ success: false, message: '凭证无效或已过期' });
  }
});

module.exports = {
  router,
  JWT_SECRET,
  authMiddleware: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: '需要登录后操作' });
    }
    try {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (e) {
      res.status(401).json({ success: false, message: '登录已失效，请重新登录' });
    }
  }
};
