const axios = require('axios');
const db = require('../database');

/**
 * 网盘文件目录服务
 * 调用各网盘真实接口获取目录树，用于转存时的目标目录选择
 *
 *  - 夸克：GET drive.quark.cn/1/clouddrive/file/sort  (pdir_fid 标识父目录，根为 0)
 *  - UC  ：GET drive.uc.cn/1/clouddrive/file/sort     (同上)
 *  - 百度：GET pan.baidu.com/api/list                  (dir 为绝对路径，根为 /)
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

class PanFileService {
  getAccount(panType) {
    const accounts = db.get('panAccounts') || [];
    return accounts.find(a => a.panType === panType);
  }

  /**
   * 获取指定网盘、指定父目录下的子目录列表
   * @param {string} panType quark|baidu|uc|cloud189
   * @param {string} parentId 父目录标识（夸克/UC 为 fid，百度为路径，天翼为 folderId）
   */
  async listDirectories(panType, parentId = null) {
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
      if (panType === 'quark') return await this.listQuark(account, pid);
      if (panType === 'uc') return await this.listUc(account, pid);
      if (panType === 'baidu') return await this.listBaidu(account, pid);
      if (panType === 'cloud189') return await this.listCloud189(account, pid);
      return { success: false, message: '不支持的网盘类型' };
    } catch (e) {
      return { success: false, message: `目录获取异常: ${e.message}` };
    }
  }

  /**
   * 夸克网盘目录列表
   */
  async listQuark(account, pdirFid) {
    const resp = await axios.get('https://drive.quark.cn/1/clouddrive/file/sort', {
      params: {
        pr: 'ucpro',
        fr: 'pc',
        pdir_fid: pdirFid,
        _page: 1,
        _size: 200,
        _sort: 'file_type:asc,updated_at:desc',
        _fetch_total: 1
      },
      headers: {
        'Cookie': account.cookies,
        'User-Agent': UA,
        'Referer': 'https://pan.quark.cn/',
        'Origin': 'https://pan.quark.cn'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.code === 0) {
      const list = (d.data && d.data.list) || [];
      return {
        success: true,
        panType: 'quark',
        parentId: pdirFid,
        items: list.filter(f => f.dir).map(f => ({ id: f.fid, name: f.file_name, isDir: true }))
      };
    }
    return {
      success: false,
      needAuth: d.code === 31001 || d.code === 31023,
      message: this.describeQuarkError(d)
    };
  }

  /**
   * UC 网盘目录列表（与夸克同构）
   */
  async listUc(account, pdirFid) {
    const resp = await axios.get('https://drive.uc.cn/1/clouddrive/file/sort', {
      params: {
        pr: 'UCBrowser',
        fr: 'pc',
        pdir_fid: pdirFid,
        _page: 1,
        _size: 200,
        _sort: 'file_type:asc,updated_at:desc',
        _fetch_total: 1
      },
      headers: {
        'Cookie': account.cookies,
        'User-Agent': UA,
        'Referer': 'https://drive.uc.cn/'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.code === 0) {
      const list = (d.data && d.data.list) || [];
      return {
        success: true,
        panType: 'uc',
        parentId: pdirFid,
        items: list.filter(f => f.dir).map(f => ({ id: f.fid, name: f.file_name, isDir: true }))
      };
    }
    return {
      success: false,
      needAuth: d.code === 31001 || d.code === 31023,
      message: `UC 目录获取失败 (code: ${d.code || 'unknown'})，请确认 Cookie 有效`
    };
  }

  /**
   * 百度网盘目录列表（dir 为绝对路径）
   */
  async listBaidu(account, dirPath) {
    const dir = dirPath || '/';
    const resp = await axios.get('https://pan.baidu.com/api/list', {
      params: {
        dir,
        order: 'name',
        desc: '0',
        web: '5',
        page: '1',
        num: '200',
        channel: 'chunlei',
        app_id: '250528',
        clienttype: '0'
      },
      headers: {
        'Cookie': account.cookies,
        'User-Agent': UA,
        'Referer': 'https://pan.baidu.com/disk/main'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.errno === 0) {
      const list = d.list || [];
      return {
        success: true,
        panType: 'baidu',
        parentId: dir,
        items: list.filter(f => f.isdir === 1).map(f => ({
          id: f.path,           // 百度以绝对路径作为目录标识
          name: f.server_filename,
          isDir: true
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

  /**
   * 天翼云盘目录列表（folderId，根目录为 -11）
   */
  async listCloud189(account, folderId) {
    const fid = folderId || '-11';
    const resp = await axios.get('https://cloud.189.cn/api/open/file/listFiles.action', {
      params: {
        folderId: fid,
        mediaType: '0',
        iconOption: '1',
        pageSize: '200',
        pageNum: '1',
        orderBy: 'lastOpTime',
        descending: 'true'
      },
      headers: {
        'Cookie': account.cookies,
        'User-Agent': UA,
        'Referer': 'https://cloud.189.cn/web/main/file/folder/' + fid
      },
      timeout: 12000,
      validateStatus: () => true
    });

    const d = resp.data || {};
    if (d.fileListAO) {
      const list = d.fileListAO.fileList || [];
      return {
        success: true,
        panType: 'cloud189',
        parentId: fid,
        items: list.filter(f => f.isFolder).map(f => ({ id: f.id, name: f.name, isDir: true }))
      };
    }
    return {
      success: false,
      needAuth: Boolean(d.errorCode),
      message: `天翼目录获取失败 (${d.errorCode || 'unknown'})，请确认 Cookie 有效`
    };
  }

  describeQuarkError(d) {
    const code = d && d.code;
    if (code === 31001 || code === 31023) return '夸克 Cookie 已失效，请重新扫码登录';
    if (code === 0) return 'ok';
    return `夸克目录获取失败 (code: ${code || 'unknown'})，请确认 Cookie 有效`;
  }
}

module.exports = new PanFileService();
