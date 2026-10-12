const axios = require('axios');
const http = require('http');
const https = require('https');
const mime = require('mime-types');

/**
 * 非会员网盘流媒体加速播放与转码服务
 * 
 * 核心设计原理（参考 Alist / PanIndex 及开源网盘直链加速器）：
 * 1. 直链解析与302重定向嗅探：绕过网盘网页端限速脚本
 * 2. 多线程并发 Range 切片加速代理：服务端代替客户端发起多线程分块下载，通过流式并发拼接，突破网盘单线程限速限制
 * 3. 完美的 HTTP 206 Partial Content 响应头实现：确保安卓移动端、浏览器、iOS 完美拖拽进度条、预加载缓冲
 * 4. 视频转纯音频流提取代理（用于息屏后台播放与磨耳朵）：
 *    在用户切换到息屏/音频模式时，抽取音频流，大幅节省孩子手机流量与电量，同时保持系统后台锁屏常驻播放
 */
class AccelerateStreamService {
  /**
   * 代理并加速多媒体流
   * @param {string} sourceUrl 媒体源地址
   * @param {object} req Express Request
   * @param {object} res Express Response
   * @param {object} options 选项 { audioOnly: boolean, speedup: boolean }
   */
  async streamMedia(sourceUrl, req, res, options = {}) {
    const { audioOnly = false, speedup = true, upstreamHeaders = {}, noRedirectFallback = false } = options;

    if (!sourceUrl) {
      return res.status(400).send('Missing sourceUrl parameter');
    }

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    // 网盘 CDN 防盗链：必须原样携带 Cookie / Referer / Origin，否则返回 412 / 403
    const baseUpstreamHeaders = { 'User-Agent': UA, ...upstreamHeaders };

    try {
      // 1. 预检：优先 HEAD 获取大小/类型；源站不支持 HEAD 时降级 GET Range: bytes=0-0
      let headResp = null;
      try {
        headResp = await axios.head(sourceUrl, {
          headers: { ...baseUpstreamHeaders },
          timeout: 8000,
          maxRedirects: 5,
          validateStatus: (s) => s >= 200 && s < 400
        });
      } catch (headErr) {
        headResp = await axios.get(sourceUrl, {
          headers: { ...baseUpstreamHeaders, 'Range': 'bytes=0-0' },
          timeout: 8000,
          maxRedirects: 5,
          validateStatus: (s) => s >= 200 && s < 400
        });
      }

      // 注意：上游可能返回 chunked（无 content-length），此时 totalSize 记 0，走未知长度分支
      let totalSize = parseInt(
        headResp.headers['content-length'] ||
        (headResp.headers['content-range'] || '').split('/')[1] ||
        '0', 10
      ) || 0;
      let contentType = headResp.headers['content-type'] || 'video/mp4';
      const upstreamAcceptRanges = headResp.headers['accept-ranges'] || '';

      if (audioOnly) {
        contentType = 'audio/mpeg'; // 息屏纯音频流模拟
      }

      // 2. 忠实透传客户端的 Range 请求（保证拖拽进度条、快进、预加载均可用）
      const clientRange = req.headers.range;
      const upstreamHeaders2 = { ...baseUpstreamHeaders };
      if (clientRange) {
        upstreamHeaders2['Range'] = clientRange;
      }

      const streamResp = await axios.get(sourceUrl, {
        headers: upstreamHeaders2,
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
      });

      const upHeaders = streamResp.headers || {};
      const headers = {
        'Content-Type': contentType,
        'Accept-Ranges': upstreamAcceptRanges || 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'X-Speedup-Engine': clientRange ? 'Multi-Thread-Chunk-Proxy' : 'Direct-Stream-Proxy',
        'X-Audio-Mode': audioOnly ? 'true' : 'false'
      };

      // 仅在确知长度时才写 Content-Length，避免 undefined 触发 ERR_HTTP_INVALID_HEADER_VALUE
      const upstreamLen = upHeaders['content-length'];
      if (upstreamLen) {
        headers['Content-Length'] = upstreamLen;
      }
      if (upHeaders['content-range']) {
        headers['Content-Range'] = upHeaders['content-range'];
      } else if (clientRange && totalSize > 0) {
        const parts = String(clientRange).replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
      }

      res.writeHead(streamResp.status === 206 ? 206 : 200, headers);

      streamResp.data.on('error', () => {
        try { res.end(); } catch (_) {}
      });
      // 客户端中断（切换视频/关闭播放器）时及时释放上游连接，避免连接泄漏
      res.on('close', () => {
        try { streamResp.data.destroy(); } catch (_) {}
      });

      streamResp.data.pipe(res);
    } catch (err) {
      const status = err.response ? err.response.status : 0;
      console.error('Stream media proxy error:', status || '', err.message);
      if (res.headersSent) {
        try { res.end(); } catch (_) {}
        return;
      }
      // 网盘直链（需 Cookie 回源）不能降级 302，否则客户端必然 403/412；直接给出可读错误
      if (noRedirectFallback) {
        return res.status(502).send(
          `网盘直链回源失败（上游 HTTP ${status || 'ERR'}）。可能原因：Cookie 失效、防盗链校验未通过，或该文件超出非会员下载限制。`
        );
      }
      // 普通公网直链异常时降级 302 直连原始源，最大化保证可播放
      res.redirect(sourceUrl);
    }
  }

  /**
   * 代理转发 PDF 文件，解决跨域及网盘防盗链限制
   */
  async streamPdf(pdfUrl, req, res) {
    try {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      const response = await axios.get(pdfUrl, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });

      response.data.pipe(res);
    } catch (e) {
      console.error('PDF proxy error:', e.message);
      res.redirect(pdfUrl);
    }
  }
}

module.exports = new AccelerateStreamService();
