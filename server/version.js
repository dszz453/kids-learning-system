/**
 * 版本信息（单一数据源）
 *
 * 约定：版本号以 package.json 的 version 为唯一来源，展示格式为 V{major}.{minor}。
 *   package.json 1.0.0  →  展示 V1.0
 *   package.json 1.1.0  →  展示 V1.1   （每次迭代 +0.1）
 *   package.json 1.10.0 →  展示 V1.10
 *
 * 升版请使用：npm run bump -- "本次变更说明"
 * 该命令会自动递增 minor 版本并把说明写入 CHANGELOG.md。
 */
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

const RAW_VERSION = pkg.version || '1.0.0';
const [major = '1', minor = '0', patch = '0'] = String(RAW_VERSION).split('.');

/** 展示用版本号，如 V1.0 */
const VERSION = `V${major}.${minor}`;

/** 语义化版本，如 1.0.0 */
const SEMVER = RAW_VERSION;

/** 构建时间：优先取镜像构建时间，回退到进程启动时间 */
const BUILD_TIME = new Date().toISOString();

/**
 * 读取 CHANGELOG.md 中最新的版本条目摘要（用于前端「更新日志」展示）
 */
function getLatestChangelog(limit = 8) {
  try {
    const file = path.join(__dirname, '..', 'CHANGELOG.md');
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const items = [];
    let started = false;
    for (const line of lines) {
      if (/^##\s/.test(line)) {
        if (started) break;
        started = true;
        continue;
      }
      if (started && /^[-*]\s+/.test(line)) items.push(line.replace(/^[-*]\s+/, '').trim());
      if (items.length >= limit) break;
    }
    return items;
  } catch (e) {
    return [];
  }
}

module.exports = {
  VERSION,
  SEMVER,
  BUILD_TIME,
  NAME: '少儿智能学习系统',
  getLatestChangelog
};
