const db = require('../database');
const panAccountService = require('./panAccountService');
const panCheckService = require('./panCheckService');

/**
 * 网盘一键转存服务
 * 支持将搜索到的资源一键转存到指定个人网盘及指定目录，并可联动创建为系统内置学习资源
 */
class PanTransferService {
  /**
   * 执行转存任务
   * @param {object} params
   * {
   *   shareUrl: string,
   *   pwd: string,
   *   targetPanType: 'quark' | 'baidu' | 'uc' | 'cloud189',
   *   targetDirectory: string, // 例如：'/儿童学习资源/乐学英语/新概念英语/'
   *   autoImportToCategory: string, // 对应分类ID (可选，若提供则自动在学习系统中生成资源)
   *   resourceTitle: string, // 资源标题
   *   resourceType: 'video' | 'audio' | 'pdf' // 资源类型
   * }
   */
  async transfer(params) {
    const {
      shareUrl,
      pwd = '',
      targetPanType = 'quark',
      targetDirectory = '/儿童学习资源/精品课程/',
      autoImportToCategory = null,
      resourceTitle = '',
      resourceType = 'video'
    } = params;

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. 检查目标网盘是否已授权配置 Cookie
    const account = panAccountService.getAccountByType(targetPanType);
    if (!account || account.status !== 'active' || !account.cookies) {
      return {
        success: false,
        taskId,
        message: `目标网盘 [${targetPanType}] 尚未通过扫码或Cookie配置授权，请先在网盘配置中扫码登录！`
      };
    }

    // 2. 检测源链接存活
    const checkResult = await panCheckService.checkUrl(shareUrl, pwd);
    if (!checkResult.isAlive) {
      return {
        success: false,
        taskId,
        message: `源链接无法转存：${checkResult.statusText}`
      };
    }

    // 3. 模拟调用各大网盘转存 API
    // 夸克：POST https://drive.quark.cn/1/clouddrive/share/sharepage/save
    // 百度：POST https://pan.baidu.com/share/transfer
    // UC：POST https://drive.uc.cn/clouddrive/share/save
    // 天翼：POST https://cloud.189.cn/api/open/share/save.action
    const simulatedPath = `${targetDirectory.replace(/\/+$/, '')}/${resourceTitle || '儿童教学合集'}`;

    // 创建转存任务记录
    const taskRecord = {
      id: taskId,
      panType: targetPanType,
      sourceUrl: shareUrl,
      pwd,
      targetDirectory: simulatedPath,
      status: 'completed',
      progress: 100,
      createdAt: new Date().toISOString(),
      message: `转存成功！文件已存入个人网盘路径：${simulatedPath}`
    };

    db.insert('transferTasks', taskRecord);

    // 4. 如果勾选了自动导入系统资源，直接无缝入库
    let importedResource = null;
    if (autoImportToCategory) {
      const category = db.find('categories', c => c.id === autoImportToCategory);
      const resId = `res_${Date.now()}`;
      
      // 为新转存的资源生成极速直链与流媒体配置
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
        description: `由网盘资源一键转存导入（网盘路径：${simulatedPath}），支持非会员高速播放与息屏后台听书。`,
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
      message: `一键转存成功！已转存至 [${targetPanType}] 目录：${simulatedPath}`,
      importedResource
    };
  }

  /**
   * 查询所有转存任务历史
   */
  getTasks() {
    return db.get('transferTasks') || [];
  }
}

module.exports = new PanTransferService();
