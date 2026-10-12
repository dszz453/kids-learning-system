const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('./auth');

// 查询资源列表 (支持按分类、关键词、资源类型筛选，并做用户目录权限过滤)
router.get('/', (req, res) => {
  const { categoryId, keyword, type, page = 1, pageSize = 50 } = req.query;
  let list = db.get('resources') || [];

  // 如果客户端传入了用户Token或携带权限过滤
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('./auth');
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role !== 'admin' && decoded.allowedCategoryIds && !decoded.allowedCategoryIds.includes('*')) {
        // 允许直接匹配或匹配父级目录
        const allCats = db.get('categories') || [];
        const allowedSet = new Set(decoded.allowedCategoryIds);

        // 如果用户有父目录权限，其子目录也属于允许范围
        allCats.forEach(c => {
          if (c.parentId && allowedSet.has(c.parentId)) {
            allowedSet.add(c.id);
          }
        });

        list = list.filter(r => allowedSet.has(r.categoryId));
      }
    } catch (e) {
      // 忽略未登录错误，继续执行公开查询
    }
  }

  // 分类筛选
  if (categoryId) {
    // 获取该分类及其所有子分类ID
    const allCats = db.get('categories') || [];
    const targetCatIds = [categoryId];
    allCats.forEach(c => {
      if (c.parentId === categoryId) targetCatIds.push(c.id);
    });

    list = list.filter(r => targetCatIds.includes(r.categoryId));
  }

  // 资源类型筛选 (video, audio, pdf)
  if (type) {
    list = list.filter(r => r.type === type);
  }

  // 关键词搜索 (支持标题、标签、描述搜索)
  if (keyword) {
    const kw = keyword.trim().toLowerCase();
    list = list.filter(r => {
      return r.title.toLowerCase().includes(kw) ||
        (r.description && r.description.toLowerCase().includes(kw)) ||
        (r.tags && r.tags.some(t => t.toLowerCase().includes(kw)));
    });
  }

  // 关联分类信息
  const allCategories = db.get('categories') || [];
  const enrichedList = list.map(r => {
    const cat = allCategories.find(c => c.id === r.categoryId);
    return {
      ...r,
      categoryName: cat ? cat.name : '未分类',
      categoryEmoji: cat ? cat.emoji : '📁'
    };
  });

  // 按创建时间倒序
  enrichedList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    success: true,
    total: enrichedList.length,
    page: Number(page),
    pageSize: Number(pageSize),
    items: enrichedList
  });
});

// 获取资源详情
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const resource = db.find('resources', r => r.id === id);
  if (!resource) {
    return res.status(404).json({ success: false, message: '资源不存在' });
  }

  const cat = db.find('categories', c => c.id === resource.categoryId);
  res.json({
    success: true,
    resource: {
      ...resource,
      categoryName: cat ? cat.name : '未分类',
      categoryEmoji: cat ? cat.emoji : '📁'
    }
  });
});

// 新建学习资源
router.post('/', authMiddleware, (req, res) => {
  const { title, categoryId, type, url, audioUrl, size, duration, coverUrl, description, tags, panSource, speedupSupport } = req.body;
  if (!title || !categoryId || !url) {
    return res.status(400).json({ success: false, message: '请填写完整的资源标题、所属分类和资源URL' });
  }

  const id = `res_${Date.now()}`;
  const newRes = {
    id,
    title: title.trim(),
    categoryId,
    type: type || 'video',
    url: url.trim(),
    audioUrl: audioUrl ? audioUrl.trim() : null,
    size: size || '未知大小',
    duration: duration || '00:00',
    coverUrl: coverUrl || 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&auto=format&fit=crop',
    description: description || '',
    tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
    panSource: panSource || 'local',
    speedupSupport: speedupSupport !== false,
    createdAt: new Date().toISOString()
  };

  db.insert('resources', newRes);
  res.json({ success: true, resource: newRes, message: '资源添加成功' });
});

// 更新学习资源
router.put('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const existing = db.find('resources', r => r.id === id);
  if (!existing) {
    return res.status(404).json({ success: false, message: '资源不存在' });
  }

  const updated = db.update('resources', id, req.body);
  res.json({ success: true, resource: updated, message: '资源更新成功' });
});

// 删除学习资源
router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('resources', id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: '资源不存在' });
  }
  res.json({ success: true, message: '资源删除成功' });
});

module.exports = router;
