const axios = require('axios');
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../database');

/**
 * 网盘扫码登录与 Cookie 授权管理服务
 * 支持：夸克网盘、百度网盘（真实扫码协议）、UC网盘、天翼云盘（官方登录 + 手动 Cookie）
 *
 * 真实协议参考：
 *  - 夸克：uop.quark.cn/cas/ajax/getTokenForQrcodeLogin -> 扫码 -> getServiceTicketByQrcodeToken -> pan.quark.cn/account/info 换 Cookie
 *  - 百度：passport.baidu.com/v2/api/getqrcode -> 扫码 -> channel/unicast 轮询取 BDUSS -> 换取 STOKEN
 */

// 存放扫码轮询中的临时会话
const qrSessions = new Map();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const PAN_NAME = {
  quark: '夸克网盘',
  baidu: '百度网盘',
  uc: 'UC网盘',
  cloud189: '天翼云盘'
};

// 二维码有效期（秒）
const QR_TTL = 300;

class PanAccountService {
  /**
   * 获取所有网盘账号配置状态
   */
  getAccounts() {
    const accounts = db.get('panAccounts') || [];
    return accounts.map(acc => ({
      ...acc,
      cookiesMasked: acc.cookies ? `${acc.cookies.substring(0, 12)}...${acc.cookies.substring(acc.cookies.length - 8)}` : '未配置',
      isConfigured: acc.status === 'active' && Boolean(acc.cookies)
    }));
  }

  getAccountByType(panType) {
    const accounts = db.get('panAccounts') || [];
    return accounts.find(acc => acc.panType === panType);
  }

  // ==================== 扫码会话创建 ====================
  async createQrSession(panType) {
    if (panType === 'quark') return this.createQuarkQr();
    if (panType === 'baidu') return this.createBaiduQr();
    return this.createManualModeSession(panType);
  }

  /**
   * 夸克网盘：申请真实扫码 token 并生成二维码
   */
  async createQuarkQr() {
    const requestId = crypto.randomUUID();
    let token = '';
    try {
      const resp = await axios.get('https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin', {
        params: { client_id: 532, v: '1.2', request_id: requestId },
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.quark.cn/', 'Origin': 'https://pan.quark.cn' },
        timeout: 12000,
        validateStatus: () => true
      });
      token = (resp.data && resp.data.data && resp.data.data.members && resp.data.data.members.token) || '';
    } catch (e) {
      console.warn('[PanAccount] 夸克取码异常:', e.message);
    }

    if (!token) {
      return {
        success: false,
        panType: 'quark',
        panName: PAN_NAME.quark,
        mode: 'manual',
        message: '暂时无法连接夸克扫码服务，请改用「手动填写 Cookie」方式配置夸克网盘。'
      };
    }

    const authUrl = `https://su.quark.cn/4_eMHBJ?token=${token}&client_id=532&ssb=weblogin&uc_param_str=&uc_biz_str=S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0`;
    const qrCodeDataUrl = await QRCode.toDataURL(authUrl, { width: 280, margin: 2, color: { dark: '#1E293B', light: '#FFFFFF' } });

    const sessionId = `qr_quark_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    qrSessions.set(sessionId, {
      sessionId,
      panType: 'quark',
      panName: PAN_NAME.quark,
      mode: 'real',
      token,
      requestId,
      status: 'waiting',
      createdAt: Date.now(),
      qrCodeDataUrl,
      authUrl
    });

    return {
      success: true,
      sessionId,
      panType: 'quark',
      panName: PAN_NAME.quark,
      mode: 'real',
      qrCodeDataUrl,
      authUrl,
      tip: '请使用「夸克 App」或「手机夸克浏览器」扫描二维码，并在手机上确认登录',
      expiresIn: QR_TTL
    };
  }

  /**
   * 百度网盘：申请真实二维码图片与签名
   */
  async createBaiduQr() {
    const gid = crypto.randomUUID().toUpperCase();
    let imgurl = '';
    let sign = '';
    try {
      const resp = await axios.get('https://passport.baidu.com/v2/api/getqrcode', {
        params: { lp: 'pc', qrloginfrom: 'pc', gid },
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.baidu.com/' },
        timeout: 12000,
        validateStatus: () => true
      });
      imgurl = (resp.data && resp.data.imgurl) || '';
      sign = (resp.data && resp.data.sign) || '';
    } catch (e) {
      console.warn('[PanAccount] 百度取码异常:', e.message);
    }

    if (!imgurl || !sign) {
      return {
        success: false,
        panType: 'baidu',
        panName: PAN_NAME.baidu,
        mode: 'manual',
        message: '暂时无法连接百度扫码服务，请改用「手动填写 Cookie」方式配置百度网盘。'
      };
    }

    // imgurl 为百度二维码图片地址（相对路径），下载后转 base64 供前端统一展示
    const qrImgUrl = imgurl.startsWith('http') ? imgurl : `https://${imgurl}`;
    let qrCodeDataUrl = '';
    try {
      const imgResp = await axios.get(qrImgUrl, {
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.baidu.com/' },
        responseType: 'arraybuffer',
        timeout: 12000
      });
      const b64 = Buffer.from(imgResp.data).toString('base64');
      const ctype = imgResp.headers['content-type'] || 'image/png';
      qrCodeDataUrl = `data:${ctype};base64,${b64}`;
    } catch (e) {
      console.warn('[PanAccount] 百度二维码图片下载失败:', e.message);
    }

    // 若图片下载失败，退而使用二维码内容自行绘制
    if (!qrCodeDataUrl) {
      qrCodeDataUrl = await QRCode.toDataURL(qrImgUrl, { width: 280, margin: 2 });
    }

    const sessionId = `qr_baidu_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    qrSessions.set(sessionId, {
      sessionId,
      panType: 'baidu',
      panName: PAN_NAME.baidu,
      mode: 'real',
      sign,
      gid,
      status: 'waiting',
      createdAt: Date.now(),
      qrCodeDataUrl,
      authUrl: qrImgUrl
    });

    return {
      success: true,
      sessionId,
      panType: 'baidu',
      panName: PAN_NAME.baidu,
      mode: 'real',
      qrCodeDataUrl,
      authUrl: qrImgUrl,
      tip: '请使用「百度网盘 App」扫描二维码，并在手机上确认登录',
      expiresIn: QR_TTL
    };
  }

  /**
   * UC / 天翼：官方登录页引导 + 手动 Cookie 录入
   */
  async createManualModeSession(panType) {
    const official = {
      uc: 'https://drive.uc.cn/',
      cloud189: 'https://cloud.189.cn/web/login.html'
    }[panType] || 'https://pan.baidu.com/';

    const panName = PAN_NAME[panType] || '网盘';
    return {
      success: true,
      panType,
      panName,
      mode: 'manual',
      qrCodeDataUrl: '',
      authUrl: official,
      tip: `${panName}暂未开放自动扫码授权。请点击「手动填写 Cookie」，在电脑浏览器登录 ${panName} 后按 F12 复制 Cookie 粘贴保存；或扫描下方链接在手机端完成登录后回到本页录入。`,
      message: `${panName} 需手动录入 Cookie`
    };
  }

  // ==================== 扫码状态轮询 ====================
  /**
   * 轮询扫码状态（真实调用各网盘接口）
   */
  async checkQrStatus(sessionId) {
    const session = qrSessions.get(sessionId);
    if (!session) {
      return { status: 'expired', message: '二维码已失效，请重新生成' };
    }

    const elapsed = Date.now() - session.createdAt;
    if (elapsed > QR_TTL * 1000) {
      session.status = 'expired';
      return { status: 'expired', message: '二维码已过期，请刷新重试' };
    }

    if (session.status === 'confirmed') {
      return { sessionId, panType: session.panType, status: 'confirmed', message: '登录授权成功，Cookie 已自动入库！' };
    }

    if (session.panType === 'quark') {
      return this.pollQuark(session);
    }
    if (session.panType === 'baidu') {
      return this.pollBaidu(session);
    }

    return {
      sessionId,
      panType: session.panType,
      status: 'manual_required',
      message: `${session.panName} 需手动录入 Cookie 完成配置`
    };
  }

  /**
   * 夸克轮询：getServiceTicketByQrcodeToken -> account/info 换 Cookie
   */
  async pollQuark(session) {
    try {
      const resp = await axios.get('https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken', {
        params: { client_id: 532, v: '1.2', token: session.token, request_id: crypto.randomUUID() },
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.quark.cn/' },
        timeout: 10000,
        validateStatus: () => true
      });
      const code = resp.data && resp.data.status;
      const ticket = resp.data && resp.data.data && resp.data.data.members && resp.data.data.members.service_ticket;

      if (code === 2000000 && ticket) {
        // 换取 Cookie
        const cookieStr = await this.exchangeQuarkCookie(ticket);
        if (cookieStr) {
          session.status = 'confirmed';
          this.persistAccount('quark', cookieStr, '夸克网盘扫码用户');
          return { sessionId: session.sessionId, panType: 'quark', status: 'confirmed', message: '夸克网盘扫码登录成功！Cookie 已入库。' };
        }
        return { sessionId: session.sessionId, panType: 'quark', status: 'scanned', message: '已确认登录，正在同步 Cookie...' };
      }
      if (code === 50004001) {
        return { sessionId: session.sessionId, panType: 'quark', status: 'waiting', message: '请使用夸克 App 扫描二维码登录' };
      }
      if (code === 50004002) {
        session.status = 'expired';
        return { sessionId: session.sessionId, panType: 'quark', status: 'expired', message: '二维码已过期，请刷新重试' };
      }
      if (code === 50004004) {
        return { sessionId: session.sessionId, panType: 'quark', status: 'waiting', message: '您已取消登录，可重新扫码' };
      }
      return { sessionId: session.sessionId, panType: 'quark', status: 'waiting', message: '等待扫码中...' };
    } catch (e) {
      return { sessionId: session.sessionId, panType: 'quark', status: 'waiting', message: '轮询中: ' + e.message };
    }
  }

  /**
   * 用夸克 service_ticket 换取登录 Cookie
   */
  async exchangeQuarkCookie(ticket) {
    try {
      const resp = await axios.get('https://pan.quark.cn/account/info', {
        params: { st: ticket, lw: 'scan' },
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.quark.cn/' },
        timeout: 12000,
        maxRedirects: 0,
        validateStatus: () => true
      });
      const setCookies = resp.headers['set-cookie'] || [];
      const pairs = setCookies.map(c => c.split(';')[0]).filter(Boolean);
      // 关注核心 Cookie
      const keep = pairs.filter(p => /^(__pus|__kps|__uid|__kp|__uid|b-user-id|__puus|__pus_)/.test(p.split('=')[0]));
      const finalPairs = keep.length > 0 ? keep : pairs;
      return finalPairs.join('; ');
    } catch (e) {
      console.warn('[PanAccount] 夸克换取 Cookie 失败:', e.message);
      return '';
    }
  }

  /**
   * 百度轮询：channel/unicast 取 BDUSS -> 换取 STOKEN
   */
  async pollBaidu(session) {
    try {
      const resp = await axios.get('https://passport.baidu.com/channel/unicast', {
        params: {
          channel_id: session.sign,
          tpl: 'netdisk',
          apiver: 'v3',
          gid: session.gid,
          _: Date.now()
        },
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.baidu.com/' },
        timeout: 8000,
        validateStatus: () => true
      });
      const errno = resp.data && resp.data.errno;
      if (errno !== 0) {
        return { sessionId: session.sessionId, panType: 'baidu', status: 'waiting', message: '等待扫码中...' };
      }

      let channelV = resp.data.channel_v;
      try { channelV = typeof channelV === 'string' ? JSON.parse(channelV) : channelV; } catch (e) { /* ignore */ }
      const st = channelV && channelV.status;
      const bduss = channelV && channelV.v;

      if (st === 2 && bduss) {
        const cookieStr = await this.exchangeBaiduCookie(bduss);
        session.status = 'confirmed';
        this.persistAccount('baidu', cookieStr, '百度网盘扫码用户');
        return { sessionId: session.sessionId, panType: 'baidu', status: 'confirmed', message: '百度网盘扫码登录成功！Cookie 已入库。' };
      }
      if (st === 1) {
        return { sessionId: session.sessionId, panType: 'baidu', status: 'scanned', message: '已扫码，请在手机百度网盘 App 上点击确认登录' };
      }
      return { sessionId: session.sessionId, panType: 'baidu', status: 'waiting', message: '请使用百度网盘 App 扫描二维码登录' };
    } catch (e) {
      return { sessionId: session.sessionId, panType: 'baidu', status: 'waiting', message: '轮询中: ' + e.message };
    }
  }

  /**
   * 用百度 BDUSS 换取完整 Cookie（含 STOKEN）
   */
  async exchangeBaiduCookie(bduss) {
    const baseCookie = `BDUSS=${bduss}`;
    try {
      const resp = await axios.get('https://pan.baidu.com/api/gettemplatevariable', {
        params: { clienttype: '0', app_id: '250528', web: '1', fields: '["stoken"]' },
        headers: { 'User-Agent': UA, 'Referer': 'https://pan.baidu.com/', 'Cookie': baseCookie },
        timeout: 12000,
        validateStatus: () => true
      });
      const stoken = resp.data && resp.data.result && resp.data.result.stoken;
      if (stoken) {
        return `${baseCookie}; STOKEN=${stoken}`;
      }
    } catch (e) {
      console.warn('[PanAccount] 百度换取 STOKEN 失败:', e.message);
    }
    return baseCookie;
  }

  /**
   * 将扫码获得的 Cookie 持久化到账号配置
   */
  persistAccount(panType, cookies, username) {
    const now = new Date().toISOString();
    const quotaMap = {
      quark: '已授权 / 可转存',
      baidu: '已授权 / 可转存',
      uc: '已授权 / 可转存',
      cloud189: '已授权 / 可转存'
    };
    db.update('panAccounts', `pan_${panType}`, {
      status: 'active',
      username: username || '扫码授权账号',
      cookies,
      token: `scan_${panType}_${Date.now()}`,
      freeQuota: quotaMap[panType] || '已授权',
      updatedAt: now
    });
    return true;
  }

  /**
   * 手动确认（兜底：用户在其它端登录后，前端触发写入自定义 Cookie）
   */
  confirmLogin(sessionId, customCookies = null) {
    const session = qrSessions.get(sessionId);
    if (!session) {
      return { success: false, message: '无效或过期的登录会话' };
    }
    if (!customCookies) {
      return { success: false, message: '请提供要保存的 Cookie 字符串' };
    }
    this.persistAccount(session.panType, customCookies, '手动录入账号');
    session.status = 'confirmed';
    return { success: true, panType: session.panType, message: `${session.panName} Cookie 已保存成功！` };
  }

  /**
   * 手动更新/配置网盘 Cookies
   */
  updateCookies(panType, cookies, username = '') {
    const acc = this.getAccountByType(panType);
    if (!acc) return null;

    return db.update('panAccounts', acc.id, {
      cookies: cookies.trim(),
      username: username || acc.username || '手动配置账号',
      status: cookies.trim() ? 'active' : 'not_configured',
      updatedAt: new Date().toISOString()
    });
  }
}

module.exports = new PanAccountService();
