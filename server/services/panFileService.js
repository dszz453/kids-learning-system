const axios = require('axios');
const db = require('../database');

/**
 * 网盘文件服务
 * 调用各网盘真实接口获取目录/文件列表与下载直链，支撑：
 *   1) 转存时的目标目录选择（只列目录）
 *   2) 网盘文件浏览与「导入为学习资源」（列目录 + 文件）
 *   3) 客户端直接播放网盘内文件（解析直链 + 携带防盗链头回源）
 *
 *  - 夸克：GET drive.quark.cn/1/clouddrive/file/sort      (pdir_fid，根为 0)
 *          POST drive.quark.cn/1/clouddrive/file/download  (body {fids:[fid]})
 *  - UC  ：GET drive.uc.cn/1/clouddrive/file/sort          (同上)
 *  - 百度：GET pan.baidu.com/api/list                      (dir 绝对路径，根为 /)
 *  - 天翼：GET cloud.189.cn/api/open/file/listFiles.action (folderId，根为 -11)
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const ROOT_MARK = {
  quark: '0',
  uc: '0',
  baidu: '/',
  cloud189: '-11'
};

const PAN_CN = {
  quark: '夸克网盘',
  baidu: '百度网盘',
  uc: 'UC网盘',
  cloud189: '天翼云盘'
};

const VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.ts', '.m4v', '.webm', '.rmvb', '.3gp'];
const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.wma', '.ape'];
const PDF_EXT = ['.pdf'];

function extOf(name) {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.substring(i).toLowerCase() : '';
}

/** 依据扩展名推断资源类型：video / audio / pdf / file */
function guessType(name) {
  const e = extOf(name);
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (PDF_EXT.includes(e)) return 'pdf';
  return 'file';
}

class PanFileService {
  getAccount(panType) {
    const accounts = db.get('panAccounts') || [];
    return accounts.find(a => a.panType === panType);
  }

  /** 该网盘是否已授权可用 */
  isAuthorized(panType) {
    const a = this.getAccount(panType);
    return Boolean(a && a.cookies && a.status === 'active');
  }

  /**
   * 回源所需的防盗链请求头（网盘 CDN 校验 Cookie / Referer / Origin，缺失会返回 412/403）
   */
  buildUpstreamHeaders(panType) {
    const account = this.getAccount(panType);
    const cookies = account ? account.cookies : '';
    if (panType === 'quark') {
      return {
        'Cookie': cookies,
        'User-Agent': UA,
        'Referer': 'https://pan.quark.cn/',
        'Origin': 'https://pan.quark.cn'
      };
    }
    if (panType === 'uc') {
      return {
        'Cookie': cookies,
        'User-Agent': UA,
        'Referer': 'https://drive.uc.cn/',
        'Origin': 'https://drive.uc.cn'
      };
    }
    if (panType === 'baidu') {
      return {
        'Cookie': cookies,
        'User-Agent': 'netdisk;P2SP;3.0.0',
        'Referer': 'https://pan.baidu.com/'
      };
    }
    if (panType === 'cloud189') {
      return {
        'Cookie': cookies,
        'User-Agent': UA,
        'Referer': 'https://cloud.189.cn/'
      };
    }
    return { 'User-Agent': UA };
  }

  /** 供流媒体代理使用：统一的回源头 */
  getStreamHeaders(panType) {
    return this.buildUpstreamHeaders(panType);
  }

  /**
   * 列出指定网盘、指定父目录下的全部条目（目录 + 文件）
   * @param {string} panType
   * @param {string} parentId 父目录标识（夸克/UC 为 fid，百度为路径，天翼为 folderId）
   */
  async listAll(panType, parentId = null) {
    const account = this.getAccount(panType);
    if (!account) {
      return { success: false, message: `未找到 ${PAN_CN[panType] || panType} 账号配置` };
    }
    if (!account.cookies || account.status !== 'active') {
      return {
        success: false,
        needAuth: true,
        message: `${PAN_CN[panType] || panType} 尚未授权，请先扫码或手动录入 Cookie`
      };
    }

    const pid = parentId || ROOT_MARK[panType] || '0';
    try {
      let raw;
      if (panType === 'quark') raw = await this.rawQuark(account, pid);
      else if (panType === 'uc') raw = await this.rawUc(account, pid);
      else if (panType === 'baidu') raw = await this.rawBaidu(account, pid);
      else if (panType === 'cloud189') raw = await this.rawCloud189(account, pid);
      else return { success: false, message: '不支持的网盘类型' };

      if (!raw.success) return raw;

      const items = raw.items.map(it => {
        const t = it.isDir ? 'dir' : guessType(it.name);
        return {
          ...it,
          type: t,
          playable: !it.isDir && (t === 'video' || t === 'audio' || t === 'pdf'),
          sizeText: it.isDir ? '' : this.humanSize(it.size)
        };
      });

      return {
        success: true,
        panType,
        panName: PAN_CN[panType],
        parentId: pid,
        dirCount: items.filter(i => i.isDir).length,
        fileCount: items.filter(i => !i.isDir).length,
        items
      };
    } catch (e) {
      return { success: false, message: `目录获取异常: ${e.message}` };
    }
  }

  /**
   * 仅列出子目录（转存目标目录选择用），保持向后兼容
   */
  async listDirectories(panType, parentId = null) {
    const r = await this.listAll(panType, parentId);
    if (!r.success) return r;
    return { ...r, items: r.items.filter(i => i.isDir) };
  }

  /**
   * 解析网盘文件的可播放直链
   * @returns {{success:boolean, url?:string, name?:string, size?:number, message?:string, needVip?:boolean}}
   */
  async getDownloadUrl(panType, fid) {
    const account = this.getAccount(panType);
    if (!account || !account.cookies || account.status !== 'active') {
      return { success: false, needAuth: true, message: `${PAN_CN[panType] || panType} 尚未授权` };
    }

    try {
      if (panType === 'quark') return await this.dlQuark(account, fid);
      if (panType === 'uc') return await this.dlUc(account, fid);
      if (panType === 'baidu') return await this.dlBaidu(account, fid);
      if (panType === 'cloud189') return await this.dlCloud189(account, fid);
      return { success: false, message: '不支持的网盘类型' };
    } catch (e) {
      return { success: false, message: `直链解析异常: ${e.message}` };
    }
  }

  /**
   * 解析网盘文件的「在线播放」信息（转码播放，非会员也能流畅播放，正是需求中的转码播放预览）
   *  - 夸克：GET drive.quark.cn/1/clouddrive/file/play?fid=&resolution=low|high|origin
   *          返回 video_list[]（多档转码 mp4/hls），取最高可用档位
   *  - 其余网盘：回退到直链
   * @returns {{success:boolean, url?:string, kind?:string, list?:Array, name?:string, message?:string}}
   */
  async getPlayInfo(panType, fid, prefer = 'auto') {
    const account = this.getAccount(panType);
    if (!account || !account.cookies || account.status !== 'active') {
      return { success: false, needAuth: true, message: `${PAN_CN[panType] || panType} 尚未授权` };
    }

    if (panType === 'quark' || panType === 'uc') {
      const apiBase = panType === 'quark' ? 'https://drive.quark.cn/1/clouddrive' : 'https://drive.uc.cn/1/clouddrive';
      const pr = panType === 'quark' ? 'ucpro' : 'UCBrowser';
      const referer = panType === 'quark' ? 'https://pan.quark.cn/' : 'https://drive.uc.cn/';
      const order = prefer === 'auto'
        ? ['low', 'high', 'super', 'origin']
        : [prefer, 'low', 'high', 'origin'];

      let lastMsg = '';

      const pickFrom = (videos) => {
        // 优先选「转码档位」（pds.quark.cn 上的 mp4/hls）；
        // resolution=raw 时给出的是原始下载直链（dl-pc-*），非会员会被 412/限额拦截，尽量不用
        const transcoded = videos.filter(v => v.resolution && v.resolution !== 'raw');
        const pool = transcoded.length ? transcoded : videos;
        return { pick: pool[pool.length - 1], transcoded: transcoded.length > 0 };
      };

      for (const resolution of order) {
        // 转码是异步任务：首次请求可能只有 raw，稍等后重试即可拿到转码档位
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await axios.get(`${apiBase}/file/play`, {
              params: { pr, fr: 'pc', fid, resolution },
              headers: {
                'Cookie': account.cookies, 'User-Agent': UA,
                'Referer': referer, 'Origin': referer.replace(/\/$/, '')
              },
              timeout: 15000, validateStatus: () => true
            });
            const d = r.data || {};
            if (d.code !== 0) {
              lastMsg = d.message || `code ${d.code}`;
              if (d.code === 31001 || d.code === 31023) {
                return { success: false, needAuth: true, message: 'Cookie 已失效，请重新授权' };
              }
              if (d.code === 21005) return { success: false, message: '该文件不是视频，无法转码播放' };
              break; // 该档位不可用，换下一档
            }

            const data = d.data || {};
            const videos = (data.video_list || []).filter(v => v && v.url);
            if (!videos.length) { lastMsg = '无可用转码档位'; break; }

            const { pick, transcoded } = pickFrom(videos);

            // 只有 raw 且还能等：等待转码完成后再取
            if (!transcoded && attempt < 2) {
              await new Promise(res => setTimeout(res, 1800));
              continue;
            }

            return {
              success: true,
              kind: 'video',
              url: pick.url,
              needTranscode: !transcoded,
              list: videos.map(v => ({
                resolution: v.resolution, width: v.width, height: v.height,
                size: v.size, format: v.format, bitrate: v.bitrate, url: v.url
              })),
              name: data.file_name,
              size: data.size,
              meta: data.meta || {},
              duration: (data.meta && data.meta.duration) || 0,
              thumbnail: data.thumbnail || ''
            };
          } catch (e) {
            lastMsg = e.message;
            break;
          }
        }
      }
      return { success: false, message: `在线播放地址解析失败：${lastMsg}` };
    }

    // 其他网盘：走直链
    const dl = await this.getDownloadUrl(panType, fid);
    if (!dl.success) return dl;
    return { success: true, kind: 'direct', url: dl.url, name: dl.name, size: dl.size };
  }

  /**
   * 获取该文件在播放时需要携带的回源请求头
   * 转码播放地址（OSS 签名）由 CDN 回调校验 Cookie，必须原样带上；直链同理
   */
  getPlayHeaders(panType) {
    return this.buildUpstreamHeaders(panType);
  }

  // ==================== 授权健康诊断 ====================

  /**
   * 诊断网盘授权状态：Cookie 完整性 + API 可用性 + 播放地址可取性与可回源性
   * 用于在管理端明确提示「为什么转存能成功但播放失败」
   */
  async diagnose(panType, probeFid = null) {
    const account = this.getAccount(panType);
    if (!account) return { success: false, message: `未配置 ${PAN_CN[panType] || panType}` };
    if (!account.cookies || account.status !== 'active') {
      return { success: false, needAuth: true, message: `${PAN_CN[panType] || panType} 尚未授权` };
    }

    const jar = {};
    String(account.cookies).split(';').forEach(s => {
      const i = s.indexOf('=');
      if (i > 0) jar[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    });
    const cookieKeys = Object.keys(jar);
    // 夸克 Web 主鉴权 Cookie：缺失时 CDN 回调会返回 require login [auth miss]
    const hasPuus = /(^|;\s*)__puus=/.test(account.cookies);

    const result = {
      success: true,
      panType,
      panName: PAN_CN[panType],
      cookieKeys,
      cookieLength: String(account.cookies).length,
      hasPuus,
      apiOk: false,
      playOk: false,
      streamOk: false,
      hint: ''
    };

    // 1) 列目录验证 API 可用性
    const list = await this.listAll(panType, null);
    result.apiOk = Boolean(list.success);
    result.apiMessage = list.message || '';
    if (!list.success) return result;

    // 2) 收集若干视频候选做探针（优先用户指定）
    let candidates = [];
    if (probeFid) {
      candidates = [probeFid];
    } else {
      const stack = [null];
      let guard = 0;
      while (stack.length && candidates.length < 3 && guard++ < 60) {
        const pid = stack.shift();
        const r = await this.listAll(panType, pid);
        if (!r.success) break;
        for (const it of r.items) {
          if (it.isDir && stack.length < 40) stack.push(it.id);
          else if (!it.isDir && it.type === 'video') candidates.push(it.id);
          if (candidates.length >= 3) break;
        }
      }
    }
    if (!candidates.length) {
      result.hint = '未在网盘中找到可用于探测的视频文件，跳过播放探测。';
      return result;
    }

    const axios = require('axios');
    let lastStatus = 0, lastBody = '', lastMsg = '';

    // 3) 逐个候选：取播放地址 → 实际回源拉一小段（这一步才能暴露 __puus 缺失 / 非会员限制）
    for (const fid of candidates) {
      result.probeFid = fid;
      const info = await this.getPlayInfo(panType, fid);
      result.playOk = Boolean(info.success);
      result.playMessage = info.message || '';
      result.playKind = info.kind || '';
      if (!info.success) { lastMsg = info.message || ''; continue; }

      try {
        const g = await axios.get(info.url, {
          headers: { ...this.getPlayHeaders(panType), 'Range': 'bytes=0-99' },
          timeout: 15000, validateStatus: () => true, responseType: 'arraybuffer'
        });
        result.streamStatus = g.status;
        if (g.status === 200 || g.status === 206) {
          result.streamOk = true;
          result.hint = '授权与播放链路完全正常。';
          return result;
        }
        const body = Buffer.from(g.data || []).toString('utf8');
        lastStatus = g.status;
        lastBody = body.replace(/\s+/g, ' ').substring(0, 220);
      } catch (e) {
        lastMsg = e.message;
      }
    }

    result.streamOk = false;
    result.streamStatus = lastStatus;
    result.streamMessage = lastBody || lastMsg;

    if (/auth miss|auth not found|require login/i.test(lastBody)) {
      result.hint = '播放地址回源被夸克 CDN 回调拒绝：当前 Cookie 缺少 Web 端主鉴权字段 __puus。'
        + '请在浏览器登录 pan.quark.cn 后复制完整 Cookie 粘贴到「网盘扫码配置 → 手动填Cookie」，'
        + '或重新扫码授权（系统已修复扫码时漏取 __puus 的问题）。';
    } else if (lastStatus === 412) {
      result.hint = '转码档位尚未生成，回退到原始直链后被夸克拒绝（HTTP 412）。'
        + '夸克对非会员大文件直链有体积限制，稍后重试转码播放即可；'
        + '若持续失败，请重新授权以补齐 __puus。';
    } else {
      result.hint = `播放地址回源失败（HTTP ${lastStatus || 'ERR'}）：${result.streamMessage}`;
    }

    return result;
  }

  // ==================== 目录/文件列举（原始） ====================

  async rawQuark(account, pdirFid) {
    const resp = await axios.get('https://drive.quark.cn/1/clouddrive/file/sort', {
      params: {
        pr: 'ucpro', fr: 'pc', pdir_fid: pdirFid,
        _page: 1, _size: 200, _sort: 'file_type:asc,updated_at:desc', _fetch_total: 1
      },
      headers: {
        'Cookie': account.cookies, 'User-Agent': UA,
        'Referer': 'https://pan.quark.cn/', 'Origin': 'https://pan.quark.cn'
      },
      timeout: 15000, validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.code === 0) {
      const list = (d.data && d.data.list) || [];
      return {
        success: true,
        items: list.map(f => ({
          id: f.fid,
          name: f.file_name,
          isDir: Boolean(f.dir),
          size: f.size || 0,
          category: f.category,
          updatedAt: f.updated_at
        }))
      };
    }
    return { success: false, needAuth: d.code === 31001 || d.code === 31023, message: this.describeQuarkError(d) };
  }

  async rawUc(account, pdirFid) {
    const resp = await axios.get('https://drive.uc.cn/1/clouddrive/file/sort', {
      params: {
        pr: 'UCBrowser', fr: 'pc', pdir_fid: pdirFid,
        _page: 1, _size: 200, _sort: 'file_type:asc,updated_at:desc', _fetch_total: 1
      },
      headers: {
        'Cookie': account.cookies, 'User-Agent': UA,
        'Referer': 'https://drive.uc.cn/', 'Origin': 'https://drive.uc.cn'
      },
      timeout: 15000, validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.code === 0) {
      const list = (d.data && d.data.list) || [];
      return {
        success: true,
        items: list.map(f => ({
          id: f.fid, name: f.file_name, isDir: Boolean(f.dir), size: f.size || 0, category: f.category
        }))
      };
    }
    return {
      success: false,
      needAuth: d.code === 31001 || d.code === 31023,
      message: `UC 目录获取失败 (code: ${d.code || 'unknown'})，请确认 Cookie 有效`
    };
  }

  async rawBaidu(account, dirPath) {
    const dir = dirPath || '/';
    const resp = await axios.get('https://pan.baidu.com/api/list', {
      params: {
        dir, order: 'name', desc: '0', web: '5', page: '1', num: '200',
        channel: 'chunlei', app_id: '250528', clienttype: '0'
      },
      headers: { 'Cookie': account.cookies, 'User-Agent': UA, 'Referer': 'https://pan.baidu.com/disk/main' },
      timeout: 15000, validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.errno === 0) {
      const list = d.list || [];
      return {
        success: true,
        items: list.map(f => ({
          id: f.isdir === 1 ? f.path : String(f.fs_id),
          name: f.server_filename,
          isDir: f.isdir === 1,
          size: f.size || 0,
          dlink: f.dlink || '',
          category: f.category
        }))
      };
    }
    return {
      success: false,
      needAuth: d.errno === -6 || d.errno === -7,
      message: d.errno === -6
        ? '百度 Cookie 已失效或缺少 STOKEN，请重新扫码/录入'
        : `百度目录获取失败 (errno: ${d.errno})`
    };
  }

  async rawCloud189(account, folderId) {
    const fid = folderId || '-11';
    const resp = await axios.get('https://cloud.189.cn/api/open/file/listFiles.action', {
      params: {
        folderId: fid, mediaType: '0', iconOption: '1',
        pageSize: '200', pageNum: '1', orderBy: 'lastOpTime', descending: 'true'
      },
      headers: {
        'Cookie': account.cookies, 'User-Agent': UA,
        'Referer': 'https://cloud.189.cn/web/main/file/folder/' + fid
      },
      timeout: 15000, validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.fileListAO) {
      const list = d.fileListAO.fileList || [];
      return {
        success: true,
        items: list.map(f => ({
          id: f.id, name: f.name, isDir: Boolean(f.isFolder), size: f.size || 0, category: f.mediaType
        }))
      };
    }
    return {
      success: false,
      needAuth: Boolean(d.errorCode),
      message: `天翼目录获取失败 (${d.errorCode || 'unknown'})，请确认 Cookie 有效`
    };
  }

  // ==================== 直链解析 ====================

  async dlQuark(account, fid) {
    const resp = await axios.post('https://drive.quark.cn/1/clouddrive/file/download',
      { fids: [fid] },
      {
        params: { pr: 'ucpro', fr: 'pc' },
        headers: {
          'Cookie': account.cookies, 'User-Agent': UA,
          'Referer': 'https://pan.quark.cn/', 'Origin': 'https://pan.quark.cn',
          'Content-Type': 'application/json'
        },
        timeout: 15000, validateStatus: () => true
      });

    const d = resp.data || {};
    if (d.code === 0) {
      const item = (d.data && d.data[0]) || {};
      if (!item.download_url) return { success: false, message: '夸克未返回下载直链' };
      return { success: true, url: item.download_url, name: item.file_name, size: item.size };
    }
    // 23018：非会员单文件体积限制
    if (d.code === 23018) {
      return {
        success: false,
        needVip: true,
        message: '夸克非会员直链限制：该文件超出免费下载体积上限，请在网盘客户端下载或升级会员'
      };
    }
    return { success: false, needAuth: d.code === 31001 || d.code === 31023, message: this.describeQuarkError(d) };
  }

  async dlUc(account, fid) {
    const resp = await axios.post('https://drive.uc.cn/1/clouddrive/file/download',
      { fids: [fid] },
      {
        params: { pr: 'UCBrowser', fr: 'pc' },
        headers: {
          'Cookie': account.cookies, 'User-Agent': UA,
          'Referer': 'https://drive.uc.cn/', 'Origin': 'https://drive.uc.cn',
          'Content-Type': 'application/json'
        },
        timeout: 15000, validateStatus: () => true
      });

    const d = resp.data || {};
    if (d.code === 0) {
      const item = (d.data && d.data[0]) || {};
      if (!item.download_url) return { success: false, message: 'UC 未返回下载直链' };
      return { success: true, url: item.download_url, name: item.file_name, size: item.size };
    }
    if (d.code === 23018) {
      return { success: false, needVip: true, message: 'UC 非会员直链限制：文件超出免费下载体积上限' };
    }
    return { success: false, needAuth: d.code === 31001 || d.code === 31023, message: `UC 直链解析失败 (code: ${d.code || 'unknown'})` };
  }

  async dlBaidu(account, fid) {
    // 百度需要先取文件元信息拿 dlink
    try {
      const mResp = await axios.get('https://pan.baidu.com/api/filemetas', {
        params: { target: `["${fid}"]`, dlink: '1', web: '5', app_id: '250528', clienttype: '0' },
        headers: { 'Cookie': account.cookies, 'User-Agent': UA, 'Referer': 'https://pan.baidu.com/disk/main' },
        timeout: 15000, validateStatus: () => true
      });
      const info = ((mResp.data || {}).info || [])[0] || {};
      if (info.dlink) {
        const sep = info.dlink.includes('?') ? '&' : '?';
        return { success: true, url: `${info.dlink}${sep}access_token=`, name: info.filename, size: info.size };
      }
    } catch (e) { /* ignore */ }
    return { success: false, needVip: true, message: '百度直链需在客户端/网页版登录后获取，当前账号未返回可播放直链' };
  }

  async dlCloud189(account, fileId) {
    const resp = await axios.get('https://cloud.189.cn/api/open/file/getFileDownloadUrl.action', {
      params: { fileId, dt: 1 },
      headers: { 'Cookie': account.cookies, 'User-Agent': UA, 'Referer': 'https://cloud.189.cn/web/main/' },
      timeout: 15000, validateStatus: () => true
    });
    const d = resp.data || {};
    if (d.fileDownloadUrl) {
      return { success: true, url: d.fileDownloadUrl };
    }
    return { success: false, message: `天翼直链解析失败 (${d.errorCode || 'unknown'})` };
  }

  // ==================== 工具 ====================

  humanSize(n) {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
    return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  describeQuarkError(d) {
    const code = d && d.code;
    if (code === 31001 || code === 31023) return '夸克 Cookie 已失效，请重新扫码登录';
    if (code === 23018) return '夸克非会员直链限制：文件超出免费下载体积上限';
    if (code === 0) return 'ok';
    return `夸克接口失败 (code: ${code || 'unknown'})，请确认 Cookie 有效`;
  }
}

module.exports = new PanFileService();
module.exports.guessType = guessType;
