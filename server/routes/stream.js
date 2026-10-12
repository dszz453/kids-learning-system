const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const accelerateStreamService = require('../services/accelerateStreamService');
const db = require('../database');

/**
 * 流媒体代理与加速播放接口
 * 
 * 核心特性：
 * 1. GET /api/stream/play?url=...&speedup=true
 *    通过多线程 Range 分块加速代理流媒体，突破非会员限速
 * 2. GET /api/stream/local?path=...
 *    本地硬盘文件高性能流式传输，完美支持 Range 分块拖拽、倍速播放与息屏模式
 * 3. GET /api/stream/audio-extract?url=...
 *    视频转音频模式 / 息屏播放模式：只拉取音频分片，大幅减少流量，支持安卓手机息屏和后台播放
 * 4. GET /api/stream/pdf?url=...
 *    PDF 在线跨域中继，方便绘本和教材在前端与安卓端稳定预览
 * 5. GET /api/stream/resource/:id
 *    根据资源ID自动解析并极速流式返回
 */

// 1. 直链流媒体播放加速代理 (远程网盘视频/音频)
router.get('/play', async (req, res) => {
  const { url, speedup = 'true', audioOnly = 'false' } = req.query;
  if (!url) {
    return res.status(400).send('URL is required');
  }

  // 如果传入的是本地流地址，转到本地流处理器
  if (url.startsWith('/api/stream/local') || !url.startsWith('http')) {
    const localMatch = url.match(/path=([^&]+)/);
    const localPath = localMatch ? decodeURIComponent(localMatch[1]) : url;
    return streamLocalFile(localPath, req, res, audioOnly === 'true');
  }

  await accelerateStreamService.streamMedia(url, req, res, {
    speedup: speedup === 'true',
    audioOnly: audioOnly === 'true'
  });
});

// 2. 本地硬盘文件高性能流式传输 (支持 Range 头分块、倍速播放、息屏音频模式)
router.get('/local', (req, res) => {
  const { path: filePath, audioOnly = 'false' } = req.query;
  if (!filePath) {
    return res.status(400).send('filePath is required');
  }

  streamLocalFile(filePath, req, res, audioOnly === 'true');
});

function streamLocalFile(filePath, req, res, audioOnly = false) {
  try {
    const normalizedPath = path.resolve(filePath);
    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).send('Local file not found');
    }

    const stat = fs.statSync(normalizedPath);
    const fileSize = stat.size;
    let contentType = mime.lookup(normalizedPath) || 'application/octet-stream';

    if (audioOnly && contentType.startsWith('video/')) {
      contentType = 'audio/mpeg'; // 纯音频模拟响应头
    }

    const range = req.headers.range;

    if (range) {
      // 客户端请求了 Range (如拖拽进度条、预加载)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(normalizedPath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });

      fileStream.pipe(res);
    } else {
      // 全量文件传输
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      });

      fs.createReadStream(normalizedPath).pipe(res);
    }
  } catch (err) {
    console.error('Local stream error:', err);
    if (!res.headersSent) {
      res.status(500).send('Error streaming local file: ' + err.message);
    }
  }
}

// 3. 息屏纯音频抽取流 (供后台播放、磨耳朵、锁屏常驻使用)
router.get('/audio-extract', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('URL is required');
  }

  if (url.startsWith('/api/stream/local') || !url.startsWith('http')) {
    const localMatch = url.match(/path=([^&]+)/);
    const localPath = localMatch ? decodeURIComponent(localMatch[1]) : url;
    return streamLocalFile(localPath, req, res, true);
  }

  await accelerateStreamService.streamMedia(url, req, res, {
    speedup: true,
    audioOnly: true
  });
});

// 4. 资源ID代理播放
router.get('/resource/:id', async (req, res) => {
  const { id } = req.params;
  const { mode = 'normal' } = req.query; // 'normal' | 'audio_only'

  const resource = db.find('resources', r => r.id === id);
  if (!resource) {
    return res.status(404).send('Resource not found');
  }

  if (resource.localPath) {
    return streamLocalFile(resource.localPath, req, res, mode === 'audio_only');
  }

  const targetUrl = (mode === 'audio_only' && resource.audioUrl) ? resource.audioUrl : resource.url;
  
  if (resource.type === 'pdf') {
    return accelerateStreamService.streamPdf(targetUrl, req, res);
  }

  await accelerateStreamService.streamMedia(targetUrl, req, res, {
    speedup: resource.speedupSupport !== false,
    audioOnly: mode === 'audio_only'
  });
});

// 5. PDF 在线代理
router.get('/pdf', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('PDF URL is required');
  }

  if (url.startsWith('/api/stream/local') || !url.startsWith('http')) {
    const localMatch = url.match(/path=([^&]+)/);
    const localPath = localMatch ? decodeURIComponent(localMatch[1]) : url;
    return streamLocalFile(localPath, req, res, false);
  }

  await accelerateStreamService.streamPdf(url, req, res);
});

module.exports = router;
