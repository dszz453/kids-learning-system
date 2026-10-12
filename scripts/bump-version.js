#!/usr/bin/env node
/**
 * 版本升版脚本
 *
 * 用法：
 *   npm run bump -- "本次迭代说明"
 *
 * 行为：
 *   1. package.json 的 version 的 minor 位 +1（1.0.0 → 1.1.0 → 1.2.0 ...），
 *      因此展示版本依次为 V1.0 → V1.1 → V1.2；
 *   2. 在 CHANGELOG.md 顶部插入对应条目（含日期与说明）；
 *   3. 打印新版本号。
 *
 * 不传说明时会进入交互式提示，因此建议始终带上说明。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

const note = process.argv.slice(2).join(' ').trim();

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const [major, minor] = String(pkg.version || '1.0.0').split('.').map(n => parseInt(n, 10) || 0);

const nextMinor = minor + 1;
const nextSemver = `${major}.${nextMinor}.0`;
const nextDisplay = `V${major}.${nextMinor}`;

pkg.version = nextSemver;
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

const today = new Date().toISOString().slice(0, 10);
const entry = [
  `## ${nextDisplay} — ${note || '迭代更新'}`,
  '',
  `发布日期：${today}`,
  '',
  note ? `- ${note}` : '- （请在此补充本次变更要点）',
  '',
  '---',
  ''
].join('\n');

let changelog = '';
if (fs.existsSync(CHANGELOG)) {
  changelog = fs.readFileSync(CHANGELOG, 'utf8');
  // 插入到首个 `## ` 版本条目前面，保持最新版本在最上方
  const idx = changelog.search(/^##\s/m);
  if (idx >= 0) {
    changelog = changelog.slice(0, idx) + entry + '\n' + changelog.slice(idx);
  } else {
    changelog = changelog + '\n' + entry;
  }
} else {
  changelog = `# 更新日志\n\n${entry}`;
}
fs.writeFileSync(CHANGELOG, changelog, 'utf8');

console.log(`[bump] ${nextDisplay}（package.json → ${nextSemver}）`);
console.log(`[bump] 已写入 CHANGELOG.md：${note || '（待补充）'}`);
console.log('[bump] 提示：前端展示的版本号来自 /api/version，重新部署后生效。');
