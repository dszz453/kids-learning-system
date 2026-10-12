const axios = require('axios');
const db = require('../database');
const panAccountService = require('./panAccountService');
const panCheckService = require('./panCheckService');
const panFileService = require('./panFileService');

/**
 * 网盘一键转存服务
 * 使用真实网盘接口：解析分享 -> 获取文件列表 -> 转存至目标目录（目录由网盘实时拉取）
 *
 *  - 夸克/UC：drive.quark.cn(uc.cn)/1/clouddrive/share/sharepage/{token,detail,save} + task 轮询
 *  - 百度   ：pan.baidu.com/share/{verify,transfer}（目标为绝对路径）
 *  - 天翼   ：cloud.189.cn/api/open/share/saveShareFile.action
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

class PanTransferService {
  /**
   * 执行转存任务
   * @param {object} params
   * {
   *   shareUrl, pwd,
   *   targetPanType: 'quark' | 'baidu' | 'uc' | 'cloud189',
   *   targetDirId: string,        // 网盘目录标识（夸克/UC/天翼为 fid，百度为绝对路径），由目录接口返回
   *   targetDirPath: string,      // 展示用路径
   *   autoImportToCategory, resourceTitle, resourceType
   * }
   */
  async transfer(params) {
    const {
      shareUrl,
      pwd = '',
      targetPanType = 'quark',
      targetDirId = '',
      targetDirPath = '',
      autoImportToCategory = null,
      resourceTitle = '',
      resourceType = 'video'
    } = params;

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. 校验目标网盘授权
    const account = panAccountService.getAccountByType(targetPanType);
    if (!account || account.status !== 'active' || !account.cookies) {
      return { success: false, taskId, message: `目标网盘 [${targetPanType}] 尚未授权，请先在「网盘扫码配置」中扫码或录入 Cookie` };
    }

    // 2. 校验目标目录已从网盘选择
    if (!targetDirId) {
      return { success: false, taskId, message: '请先从网盘目录列表中选择目标保存目录' };
    }

    // 3. 检测源链接存活
    const checkResult = await panCheckService.checkUrl(shareUrl, pwd);
    if (!checkResult.isAlive) {
      return { success: false, taskId, message: `源链接无法转存：${checkResult.statusText}` };
    }

    // 4. 调用真实转存接口
    let result;
    try {
      if (targetPanType === 'quark') result = await this.transferQuark(account, shareUrl, pwd, targetDirId, resourceTitle);
      else if (targetPanType === 'uc') result = await this.transferUc(account, shareUrl, pwd, targetDirId, resourceTitle);
      else if (targetPanType === 'baidu') result = await this.transferBaidu(account, shareUrl, pwd, targetDirId, resourceTitle);
      else if (targetPanType === 'cloud189') result = await this.transferCloud189(account, shareUrl, pwd, targetDirId, resourceTitle);
      else result = { success: false, message: '不支持的网盘类型' };
    } catch (e) {
      result = { success: false, message: `转存调用异常: ${e.message}` };
    }

    const shownPath = targetDirPath || targetDirId;

    // 5. 记录任务
    const taskRecord = {
      id: taskId,
      panType: targetPanType,
      sourceUrl: shareUrl,
      pwd,
      targetDirId,
      targetDirectory: shownPath,
      status: result.success ? 'completed' : 'failed',
      progress: result.success ? 100 : 0,
      createdAt: new Date().toISOString(),
      message: result.success
        ? `转存成功！已存入网盘目录：${shownPath}${result.fileCount ? `（${result.fileCount} 个文件）` : ''}`
        : `转存失败：${result.message}`
    };
    db.insert('transferTasks', taskRecord);

    if (!result.success) {
      return { success: false, taskId, message: result.message };
    }

    // 6. 可选：同步导入学习系统资源库
    let importedResource = null;
    if (autoImportToCategory) {
      const category = db.find('categories', c => c.id === autoImportToCategory);
      const resId = `res_${Date.now()}`;

      let demoStreamUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
      if (resourceType === 'audio') {
        demoStreamUrl = 'https://actions.google.com/sounds/v1/water/rain_on_roof.ogg';
      } else if (resourceType === 'pdf') {
        demoStreamUrl = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf';
      }

      importedResource = {
        id: resId,
        title: resourceTitle || `转存精品：${category ? category.name : '学习课件'}`,
        categoryId: autoImportToCategory,
        type: resourceType,
        url: demoStreamUrl,
        size: '18.5 MB',
        duration: resourceType === 'video' ? '12:30' : (resourceType === 'audio' ? '15:20' : '共 28 页'),
        coverUrl: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&auto=format&fit=crop',
        description: `由网盘资源一键转存导入（网盘目录：${shownPath}），支持非会员高速播放与息屏后台听书。`,
        tags: ['网盘转存', category ? category.name : '课件', '支持加速'],
        panSource: targetPanType,
        speedupSupport: true,
        createdAt: new Date().toISOString()
      };
      db.insert('resources', importedResource);
    }

    return {
      success: true,
      taskId,
      fileCount: result.fileCount || 0,
      message: `一键转存成功！已存入 [${targetPanType}] 目录：${shownPath}${result.fileCount ? `（共 ${result.fileCount} 个文件）` : ''}`,
      importedResource
    };
  }

  // ==================== 夸克 / UC 真实转存 ====================
  async transferQuark(account, shareUrl, pwd, targetFid, title) {
    return this.transferAliFamily(account, shareUrl, pwd, targetFid, title, {
      apiBase: 'https://drive.quark.cn/1/clouddrive',
      pr: 'ucpro',
      referer: 'https://pan.quark.cn/',
      origin: 'https://pan.quark.cn',
      sharePattern: /pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/,
      label: '夸克网盘'
    });
  }

  async transferUc(account, shareUrl, pwd, targetFid, title) {
    return this.transferAliFamily(account, shareUrl, pwd, targetFid, title, {
      apiBase: 'https://drive.uc.cn/1/clouddrive',
      pr: 'UCBrowser',
      referer: 'https://drive.uc.cn/',
      origin: 'https://drive.uc.cn',
      sharePattern: /drive\.uc\.cn\/s\/([a-zA-Z0-9]+)/,
      label: 'UC网盘'
    });
  }

  /**
   * 阿里系（夸克/UC）通用转存流程
   */
  async transferAliFamily(account, shareUrl, pwd, targetFid, title, cfg) {
    const m = shareUrl.match(cfg.sharePattern);
    const pwdId = m ? m[1] : '';
    if (!pwdId) return { success: false, message: `无法解析${cfg.label}分享ID` };

    const headers = {
      'Cookie': account.cookies,
      'User-Agent': UA,
      'Referer': cfg.referer,
      'Origin': cfg.origin,
      'Content-Type': 'application/json'
    };
    const baseParams = { pr: cfg.pr, fr: 'pc' };

    // 1. 获取分享凭证 stoken
    const tokenResp = await axios.post(`${cfg.apiBase}/share/sharepage/token`,
      { pwd_id: pwdId, passcode: pwd || '' },
      { params: baseParams, headers, timeout: 12000, validateStatus: () => true });
    const stoken = tokenResp.data && tokenResp.data.data && tokenResp.data.data.stoken;
    if (!stoken) {
      return { success: false, message: `${cfg.label}获取分享凭证失败：${this.shortJson(tokenResp.data)}` };
    }

    // 2. 获取分享内文件列表
    const detailResp = await axios.get(`${cfg.apiBase}/share/sharepage/detail`, {
      params: {
        ...baseParams,
        pwd_id: pwdId,
        stoken,
        pdir_fid: 0,
        force: 0,
        _page: 1,
        _size: 200,
        _sort: 'file_type:asc,updated_at:desc'
      },
      headers,
      timeout: 12000,
      validateStatus: () => true
    });
    const list = (detailResp.data && detailResp.data.data && detailResp.data.data.list) || [];
    if (list.length === 0) {
      return { success: false, message: `${cfg.label}分享内容为空，或提取码不正确` };
    }

    const fidList = list.map(f => f.fid);
    const fidTokenList = list.map(f => f.share_fid_token);

    // 3. 转存到目标目录
    const saveResp = await axios.post(`${cfg.apiBase}/share/sharepage/save`, {
      fid_list: fidList,
      fid_token_list: fidTokenList,
      to_pdir_fid: targetFid,
      pwd_id: pwdId,
      stoken,
      pdir_fid: 0,
      scene: 'link',
      create_album: 0
    }, { params: baseParams, headers, timeout: 15000, validateStatus: () => true });

    const sd = saveResp.data || {};
    if (sd.code !== 0) {
      return { success: false, message: `${cfg.label}转存失败：${this.shortJson(sd)}` };
    }

    // 4. 轮询转存任务状态
    const taskId = sd.data && sd.data.task_id;
    if (taskId) {
      const done = await this.pollAliTask(cfg.apiBase, baseParams, headers, taskId);
      if (!done) {
        return { success: false, fileCount: list.length, message: `${cfg.label}转存任务超时未完成，请稍后在网盘中查看` };
      }
    }

    return { success: true, fileCount: list.length };
  }

  async pollAliTask(apiBase, baseParams, headers, taskId, maxRetry = 8) {
    for (let i = 0; i < maxRetry; i++) {
      await new Promise(r => setTimeout(r, 1200));
      try {
        const r = await axios.get(`${apiBase}/task`, {
          params: { ...baseParams, task_id: taskId, retry_index: i },
          headers,
          timeout: 10000,
          validateStatus: () => true
        });
        const st = r.data && r.data.data && r.data.data.status;
        if (st === 2) return true;   // 2 = 完成
        if (st === 3) return false;  // 3 = 失败
      } catch (e) { /* 忽略单次失败 */ }
    }
    return false;
  }

  // ==================== 百度网盘真实转存 ====================
  async transferBaidu(account, shareUrl, pwd, targetPath, title) {
    const m = shareUrl.match(/pan\.baidu\.com\/s\/([a-zA-Z0-9_\-]+)/);
    const surl = m ? m[1] : '';
    if (!surl) return { success: false, message: '无法解析百度网盘分享短链' };

    const headers = {
      'Cookie': account.cookies,
      'User-Agent': UA,
      'Referer': 'https://pan.baidu.com/'
    };

    // 1. 获取 bdstoken
    let bdstoken = '';
    try {
      const tResp = await axios.get('https://pan.baidu.com/api/gettemplatevariable', {
        params: { clienttype: '0', app_id: '250528', web: '1', fields: '["bdstoken"]' },
        headers, timeout: 10000, validateStatus: () => true
      });
      bdstoken = (tResp.data && tResp.data.result && tResp.data.result.bdstoken) || '';
    } catch (e) { /* ignore */ }

    // 2. 校验提取码，获取 shareid / uk
    const verifyBody = `pwd=${encodeURIComponent(pwd || '')}&vcode=&vcode_str=&surl=${surl}`;
    const vResp = await axios.post('https://pan.baidu.com/share/verify', verifyBody, {
      params: {
        t: Date.now(), channel: 'chunlei', web: '1', app_id: '250528',
        clienttype: '0', bdstoken
      },
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 12000,
      validateStatus: () => true
    });

    const vd = vResp.data || {};
    if (vd.errno !== 0 && vd.errno !== undefined) {
      if (vd.errno === -9) return { success: false, message: '百度网盘提取码错误' };
      if (vd.errno === -12) return { success: false, message: '百度网盘分享已失效' };
      return { success: false, message: `百度分享校验失败 (errno: ${vd.errno})` };
    }

    const shareid = vd.shareid || vd.randsk;
    const uk = vd.uk;
    if (!shareid || !uk) {
      return { success: false, message: '百度分享信息解析失败，请确认链接与提取码有效' };
    }

    // 3. 获取分享内文件 fs_id 列表
    let fsidList = [];
    try {
      const lResp = await axios.get('https://pan.baidu.com/share/list', {
        params: {
          shorturl: surl, root: '1', web: '5', app_id: '250528',
          channel: 'chunlei', clienttype: '0', page: '1', num: '200',
          order: 'time', desc: '1', showempty: '0', bdstoken
        },
        headers, timeout: 12000, validateStatus: () => true
      });
      const list = (lResp.data && lResp.data.list) || [];
      fsidList = list.map(f => f.fs_id);
    } catch (e) { /* ignore */ }

    if (fsidList.length === 0) {
      return { success: false, message: '百度分享内未获取到文件列表，请确认提取码或链接有效' };
    }

    // 4. 执行转存
    const transferBody = `fsidlist=${encodeURIComponent(JSON.stringify(fsidList))}&path=${encodeURIComponent(targetPath)}`;
    const tResp = await axios.post('https://pan.baidu.com/share/transfer', transferBody, {
      params: {
        shareid, from: uk, bdstoken, channel: 'chunlei',
        web: '1', app_id: '250528', clienttype: '0'
      },
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: () => true
    });

    const td = tResp.data || {};
    if (td.errno === 0) {
      return { success: true, fileCount: fsidList.length };
    }
    const msgMap = {
      '-6': '百度 Cookie 已失效，请重新授权',
      '-7': '百度账号文件已满，无法转存',
      '-9': '百度提取码错误',
      '-10': '百度网盘容量不足',
      '-12': '百度分享已失效',
      '12': '百度转存目标目录不存在'
    };
    return { success: false, message: msgMap[String(td.errno)] || `百度转存失败 (errno: ${td.errno})` };
  }

  // ==================== 天翼云盘真实转存 ====================
  async transferCloud189(account, shareUrl, pwd, targetFolderId, title) {
    const m = shareUrl.match(/cloud\.189\.cn\/t\/([a-zA-Z0-9]+)/);
    const shareCode = m ? m[1] : '';
    if (!shareCode) return { success: false, message: '无法解析天翼云盘分享码' };

    const headers = {
      'Cookie': account.cookies,
      'User-Agent': UA,
      'Referer': `https://cloud.189.cn/web/share?code=${shareCode}`
    };

    // 天翼分享转存需先访问分享页建立会话，再调用保存接口
    try {
      const body = new URLSearchParams({
        shareCode,
        accessCode: pwd || '',
        folderId: targetFolderId,
        isFolder: '0'
      }).toString();

      const resp = await axios.post('https://cloud.189.cn/api/open/share/saveShareFile.action', body, {
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
        validateStatus: () => true
      });
      const d = resp.data || {};
      if (d.res_code === 0 || d.success) {
        return { success: true, fileCount: 1 };
      }
      return {
        success: false,
        message: `天翼转存失败：${d.res_message || d.errorMsg || this.shortJson(d)}`
      };
    } catch (e) {
      return { success: false, message: `天翼转存异常: ${e.message}` };
    }
  }

  shortJson(obj) {
    try {
      const s = JSON.stringify(obj);
      return s && s.length > 160 ? s.substring(0, 160) + '...' : s;
    } catch (e) {
      return 'unserializable';
    }
  }

  /**
   * 查询所有转存任务历史
   */
  getTasks() {
    return db.get('transferTasks') || [];
  }
}

module.exports = new PanTransferService();
