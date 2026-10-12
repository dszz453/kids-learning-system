const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const localDiskService = require('../services/localDiskService');
const { authMiddleware } = require('./auth');

// 本地上传媒体存储目录
const UPLOAD_DIR = path.join(__dirname, '../../data/local_media');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // 保持原始 UTF-8 文件名
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeName = `${Date.now()}_${originalName.replace(/[^\w\s\u4e00-\u9fa5\.\-]/gi, '_')}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// 1. 扫描指定本地硬盘目录
router.post('/scan', authMiddleware, async (req, res) => {
  try {
    const { targetDir } = req.body;
    const scanDir = targetDir ? targetDir.trim() : UPLOAD_DIR;
    const result = await localDiskService.scanDirectory(scanDir);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: '扫描本地目录失败: ' + err.message });
  }
});

// 2. 批量将本地硬盘文件导入为系统资源
router.post('/import', authMiddleware, async (req, res) => {
  try {
    const { files, defaultCategoryId } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要导入的本地文件' });
    }

    const result = await localDiskService.importFiles(files, defaultCategoryId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: '导入本地文件失败: ' + err.message });
  }
});

// 3. 上传本地文件到服务器存储并自动关联
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' });
    }

    const { categoryId, title } = req.body;
    const filePath = req.file.path.replace(/\\/g, '/');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const type = localDiskService.getFileType(ext) || 'video';

    const scanItem = {
      fileName: req.file.filename,
      title: title || path.basename(req.file.originalname, ext),
      fullPath: filePath,
      extension: ext,
      type,
      sizeStr: localDiskService.formatFileSize(req.file.size),
      categoryId: categoryId || 'cat_eng'
    };

    const importRes = await localDiskService.importFiles([scanItem], categoryId);
    res.json({
      success: true,
      message: '文件上传并导入系统成功！',
      resource: importRes.resources[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '上传失败: ' + err.message });
  }
});

module.exports = router;
