const fs = require('fs');
const path = require('path');
const db = require('../database');

/**
 * 本地硬盘资源扫描与导入服务
 * 支持扫描宿主机/本地服务器任意目录，智能识别视频、音频、PDF文件并批量入库
 */
class LocalDiskService {
  constructor() {
    this.supportedExtensions = {
      video: ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv'],
      audio: ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.aac'],
      pdf: ['.pdf']
    };
  }

  /**
   * 递归扫描指定本地硬盘目录
   * @param {string} targetDir 本地硬盘目录路径
   * @param {number} maxFiles 最大扫描文件数
   */
  async scanDirectory(targetDir, maxFiles = 200) {
    if (!targetDir) {
      targetDir = path.join(__dirname, '../../data/local_media');
    }

    // 若目录不存在且为默认本地媒体目录，自动创建
    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {
        throw new Error(`本地目录不存在且无法创建: ${targetDir}`);
      }
    }

    const results = [];
    await this.walkDir(targetDir, results, maxFiles);

    return {
      scanPath: targetDir,
      totalFound: results.length,
      files: results
    };
  }

  async walkDir(currentPath, results, maxFiles) {
    if (results.length >= maxFiles) return;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // 排除隐藏目录与系统目录
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await this.walkDir(fullPath, results, maxFiles);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const type = this.getFileType(ext);

          if (type) {
            let stat = null;
            try {
              stat = fs.statSync(fullPath);
            } catch (e) {}

            const fileSize = stat ? stat.size : 0;
            const fileSizeStr = this.formatFileSize(fileSize);
            const titleWithoutExt = path.basename(entry.name, ext);
            const inferredCategory = this.inferCategory(entry.name, currentPath);

            results.push({
              fileName: entry.name,
              title: titleWithoutExt,
              fullPath: fullPath.replace(/\\/g, '/'),
              extension: ext,
              type,
              sizeBytes: fileSize,
              sizeStr: fileSizeStr,
              inferredCategoryId: inferredCategory.id,
              inferredCategoryName: inferredCategory.name,
              mtime: stat ? stat.mtime.toISOString() : new Date().toISOString()
            });
          }
        }
      }
    } catch (err) {
      console.warn(`Scan directory warning on ${currentPath}:`, err.message);
    }
  }

  getFileType(ext) {
    for (const [type, exts] of Object.entries(this.supportedExtensions)) {
      if (exts.includes(ext)) return type;
    }
    return null;
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * 根据文件名或所在文件夹名称智能推断所属分类
   */
  inferCategory(fileName, dirPath) {
    const text = (fileName + ' ' + dirPath).toLowerCase();
    const categories = db.get('categories') || [];

    if (text.includes('英') || text.includes('english') || text.includes('phonics') || text.includes('新概念') || text.includes('字母')) {
      const c = categories.find(cat => cat.id.includes('eng'));
      if (c) return { id: c.id, name: c.name };
    }
    if (text.includes('诗') || text.includes('国学') || text.includes('成语') || text.includes('论语') || text.includes('三字经')) {
      const c = categories.find(cat => cat.id.includes('classics'));
      if (c) return { id: c.id, name: c.name };
    }
    if (text.includes('故事') || text.includes('童话') || text.includes('绘本') || text.includes('睡前')) {
      const c = categories.find(cat => cat.id.includes('stories'));
      if (c) return { id: c.id, name: c.name };
    }
    if (text.includes('科学') || text.includes('宇宙') || text.includes('航天') || text.includes('为什么') || text.includes('百科')) {
      const c = categories.find(cat => cat.id.includes('science'));
      if (c) return { id: c.id, name: c.name };
    }

    // 默认第一个分类
    return { id: categories[0]?.id || 'cat_eng', name: categories[0]?.name || '默认分类' };
  }

  /**
   * 批量将扫描出的本地文件导入系统资源库
   */
  async importFiles(filesToImport, defaultCategoryId = null) {
    const importedResources = [];
    const now = new Date().toISOString();

    for (const item of filesToImport) {
      const resId = `res_local_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const catId = item.categoryId || defaultCategoryId || item.inferredCategoryId || 'cat_eng';
      
      // 生成本地播放直链 URL
      const streamUrl = `/api/stream/local?path=${encodeURIComponent(item.fullPath)}`;

      const newResource = {
        id: resId,
        title: item.title || item.fileName,
        categoryId: catId,
        type: item.type,
        url: streamUrl,
        audioUrl: item.type === 'video' ? streamUrl : null,
        localPath: item.fullPath,
        size: item.sizeStr || '10 MB',
        duration: item.type === 'pdf' ? '本地PDF' : (item.duration || '本地文件'),
        coverUrl: this.getDefaultCoverByType(item.type),
        description: `从本地硬盘导入：${item.fullPath}`,
        tags: ['本地硬盘', item.type, '免流量极速'],
        panSource: 'local_disk',
        speedupSupport: true,
        createdAt: now
      };

      db.insert('resources', newResource);
      importedResources.push(newResource);
    }

    return {
      success: true,
      count: importedResources.length,
      resources: importedResources
    };
  }

  getDefaultCoverByType(type) {
    if (type === 'video') return 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&auto=format&fit=crop';
    if (type === 'audio') return 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop';
    return 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop';
  }
}

module.exports = new LocalDiskService();
