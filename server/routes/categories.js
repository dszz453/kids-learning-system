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

// 收集某目录及其全部子孙目录 id
function collectSubtreeIds(categories, rootId) {
  const ids = new Set([rootId]);
  const walk = (pid) => {
    categories.filter(c => c.parentId === pid).forEach(c => {
      if (!ids.has(c.id)) { ids.add(c.id); walk(c.id); }
    });
  };
  walk(rootId);
  return ids;
}

// 获取分类树（含各目录资源统计：直属 resourceCount + 含子树 totalResourceCount）
router.get('/tree', (req, res) => {
  const categories = db.get('categories') || [];
  const resources = db.get('resources') || [];

  const withCounts = categories.map(cat => {
    const direct = resources.filter(r => r.categoryId === cat.id).length;
    const subIds = collectSubtreeIds(categories, cat.id);
    const total = resources.filter(r => subIds.has(r.categoryId)).length;
    return { ...cat, resourceCount: direct, totalResourceCount: total };
  });

  const tree = buildCategoryTree(withCounts);
  res.json({ success: true, tree, list: withCounts });
});

// 获取指定目录（含所有子孙目录）下的资源内容 —— 供"学习资源库按目录查看"使用
router.get('/:id/resources', (req, res) => {
  const { id } = req.params;
  const categories = db.get('categories') || [];
  const cat = categories.find(c => c.id === id);
  if (!cat) {
    return res.status(404).json({ success: false, message: '未找到该目录' });
  }

  const subIds = collectSubtreeIds(categories, id);
  const resources = (db.get('resources') || []).filter(r => subIds.has(r.categoryId));

  // 按目录分组，便于前端展示"每个子目录里有什么"
  const children = categories.filter(c => c.parentId === id);
  const breakdown = [
    { id: cat.id, name: cat.name, emoji: cat.emoji || '📁', count: resources.filter(r => r.categoryId === cat.id).length, isSelf: true },
    ...children.map(c => ({
      id: c.id, name: c.name, emoji: c.emoji || '📁',
      count: resources.filter(r => r.categoryId === c.id).length
    }))
  ];

  const enriched = resources.map(r => {
    const c = categories.find(x => x.id === r.categoryId);
    return { ...r, categoryName: c ? c.name : '未分类', categoryEmoji: c ? (c.emoji || '📁') : '📁' };
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    success: true,
    category: { id: cat.id, name: cat.name, emoji: cat.emoji, panBinding: cat.panBinding || null },
    total: enriched.length,
    breakdown,
    items: enriched
  });
});

// 获取所有分类列表
router.get('/list', (req, res) => {
  const categories = db.get('categories') || [];
  const sorted = [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  res.json({ success: true, categories: sorted });
});

// 新建目录分类 (管理端)
router.post('/', authMiddleware, (req, res) => {
  const { name, parentId, icon, emoji, color, bgColor, sortOrder, description, gradeLevel, panBinding } = req.body;
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
    // 网盘目录映射：该目录对应哪个网盘的哪个目录，转存时可直接定位
    panBinding: normalizePanBinding(panBinding),
    createdAt: new Date().toISOString()
  };

  db.insert('categories', newCat);
  res.json({ success: true, category: newCat, message: '新建目录成功' });
});

// 更新目录分类
router.put('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  const existing = db.find('categories', c => c.id === id);
  if (!existing) {
    return res.status(404).json({ success: false, message: '未找到该目录' });
  }

  // 防止把自己设为自己的父级造成环
  if (updates.parentId === id) {
    return res.status(400).json({ success: false, message: '不能将目录的父级设置为它自己' });
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'panBinding')) {
    updates.panBinding = normalizePanBinding(updates.panBinding);
  }

  const updated = db.update('categories', id, updates);
  res.json({ success: true, category: updated, message: '目录更新成功' });
});

// 规范化网盘目录映射对象
function normalizePanBinding(raw) {
  if (!raw || !raw.panType || !raw.dirId) return null;
  return {
    panType: raw.panType,
    panName: raw.panName || raw.panType,
    dirId: String(raw.dirId),
    dirPath: raw.dirPath || '',
    boundAt: raw.boundAt || new Date().toISOString()
  };
}

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
