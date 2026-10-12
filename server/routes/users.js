const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware } = require('./auth');

// 校验管理员权限
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足：仅管理员可操作用户' });
  }
  next();
}

// 1. 获取所有用户列表
router.get('/', authMiddleware, requireAdmin, (req, res) => {
  const users = db.get('users') || [];
  const safeUsers = users.map(u => ({
    id: u.id,
    username: u.username,
    nickname: u.nickname || u.username,
    role: u.role,
    grade: u.grade || '',
    expireAt: u.expireAt,
    allowedCategoryIds: u.allowedCategoryIds || ['*'],
    active: u.active !== false,
    createdAt: u.createdAt
  }));
  res.json({ success: true, users: safeUsers });
});

// 2. 新建用户（支持设定有效截止时间、允许访问的目录权限树、年级）
router.post('/', authMiddleware, requireAdmin, (req, res) => {
  const { username, password, nickname, role = 'student', grade = '', expireAt, allowedCategoryIds = ['*'] } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '账号与初始密码不能为空' });
  }

  const existing = db.find('users', u => u.username === username);
  if (existing) {
    return res.status(400).json({ success: false, message: '该用户名已存在' });
  }

  const id = `usr_${Date.now()}`;
  const newUser = {
    id,
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 8),
    role,
    nickname: nickname ? nickname.trim() : username,
    grade: grade || '全阶段',
    expireAt: expireAt || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(), // 默认1年
    allowedCategoryIds: Array.isArray(allowedCategoryIds) ? allowedCategoryIds : ['*'],
    active: true,
    createdAt: new Date().toISOString()
  };

  db.insert('users', newUser);
  res.json({
    success: true,
    message: '创建用户成功',
    user: {
      id: newUser.id,
      username: newUser.username,
      nickname: newUser.nickname,
      role: newUser.role,
      grade: newUser.grade,
      expireAt: newUser.expireAt,
      allowedCategoryIds: newUser.allowedCategoryIds
    }
  });
});

// 3. 更新用户权限与有效时间
router.put('/:id', authMiddleware, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { nickname, password, role, grade, expireAt, allowedCategoryIds, active } = req.body;

  const user = db.find('users', u => u.id === id);
  if (!user) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }

  const updates = {};
  if (nickname !== undefined) updates.nickname = nickname;
  if (role !== undefined) updates.role = role;
  if (grade !== undefined) updates.grade = grade;
  if (expireAt !== undefined) updates.expireAt = expireAt;
  if (allowedCategoryIds !== undefined) updates.allowedCategoryIds = allowedCategoryIds;
  if (active !== undefined) updates.active = active;
  if (password && password.trim()) {
    updates.passwordHash = bcrypt.hashSync(password.trim(), 8);
  }

  const updated = db.update('users', id, updates);
  res.json({
    success: true,
    message: '用户信息与权限更新成功',
    user: {
      id: updated.id,
      username: updated.username,
      nickname: updated.nickname,
      role: updated.role,
      grade: updated.grade,
      expireAt: updated.expireAt,
      allowedCategoryIds: updated.allowedCategoryIds,
      active: updated.active
    }
  });
});

// 4. 删除用户
router.delete('/:id', authMiddleware, requireAdmin, (req, res) => {
  const { id } = req.params;
  if (id === 'usr_admin') {
    return res.status(400).json({ success: false, message: '系统默认管理员不可删除' });
  }

  const deleted = db.delete('users', id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: '用户不存在' });
  }
  res.json({ success: true, message: '用户已删除' });
});

module.exports = router;
