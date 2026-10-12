const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('./auth');

/**
 * 构建树状目录层级结构
 */
function buildCategoryTree(categories, parentId = null) {
  return categories
    .filter(c => c.parentId === parentId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(c => ({
      ...c,
      children: buildCategoryTree(categories, c.id)
    }));
}

// 获取分类树（公开/需受权限过滤）
router.get('/tree', (req, res) => {
  const categories = db.get('categories') || [];
  const resources = db.get('resources') || [];

  // 统计每个分类下的资源数
  const withCounts = categories.map(cat => {
    const count = resources.filter(r => r.categoryId === cat.id).length;
    return { ...cat, resourceCount: count };
  });

  const tree = buildCategoryTree(withCounts);
  res.json({ success: true, tree, list: withCounts });
});

// 获取所有分类列表
router.get('/list', (req, res) => {
  const categories = db.get('categories') || [];
  const sorted = [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  res.json({ success: true, categories: sorted });
});

// 新建目录分类 (管理端)
router.post('/', authMiddleware, (req, res) => {
  const { name, parentId, icon, emoji, color, bgColor, sortOrder, description, gradeLevel } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: '目录名称不能为空' });
  }

  const id = `cat_${Date.now()}`;
  const newCat = {
    id,
    name: name.trim(),
    parentId: parentId || null,
    icon: icon || 'folder',
    emoji: emoji || '📁',
    color: color || '#4F46E5',
    bgColor: bgColor || '#EEF2FF',
    sortOrder: Number(sortOrder) || 1,
    description: description || '',
    gradeLevel: gradeLevel || '全年龄段',
    createdAt: new Date().toISOString()
  };

  db.insert('categories', newCat);
  res.json({ success: true, category: newCat, message: '新建目录成功' });
});

// 更新目录分类
router.put('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const existing = db.find('categories', c => c.id === id);
  if (!existing) {
    return res.status(404).json({ success: false, message: '未找到该目录' });
  }

  const updated = db.update('categories', id, updates);
  res.json({ success: true, category: updated, message: '目录更新成功' });
});

// 删除目录分类
router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;

  // 检查是否有子目录
  const children = db.filter('categories', c => c.parentId === id);
  if (children.length > 0) {
    return res.status(400).json({ success: false, message: '该目录下存在子目录，请先删除或移动子目录' });
  }

  // 检查是否有资源绑定
  const resources = db.filter('resources', r => r.categoryId === id);
  if (resources.length > 0) {
    return res.status(400).json({ success: false, message: `该目录下还有 ${resources.length} 个学习资源，请先迁移后再删除` });
  }

  const deleted = db.delete('categories', id);
  res.json({ success: true, message: '目录已删除' });
});

module.exports = router;
