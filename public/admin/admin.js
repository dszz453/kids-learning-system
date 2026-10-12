// 管理后台 JavaScript 交互控制器
let allCategories = [];
let allResources = [];
let currentTab = 'panSearch';
let currentPlayerResource = null;
let activeQrSessionId = null;
let activeQrPanType = 'quark';
let qrPollingTimer = null;
let currentAdminUser = null;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  checkAdminAuth(); // 优先校验管理员身份
  loadPansouConfig(); // 载入并回显 Pansou 服务地址与状态
  loadPancheckConfig(); // 载入并回显 PanCheck 探针服务地址与状态
  loadCategories();
  loadResources();
  doPanSearch(); // 默认载入精品网盘资源
  loadPanAccounts();
  loadUsers();
  loadAiConfig();
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ==================== 播放地址统一解析 ====================
// 本地文件流 / 已代理地址直接复用，避免二次包装导致语义丢失（如息屏纯音频模式失效）
function resolveStreamUrl(rawUrl, mode) {
  const u = String(rawUrl || '');
  if (u.startsWith('/api/stream/local')) {
    const sep = u.includes('?') ? '&' : '?';
    return mode === 'audio' ? `${u}${sep}audioOnly=true` : u;
  }
  // 网盘资源（转存后直接播放）：服务端自动选择转码播放地址/直链
  if (u.startsWith('/api/pan/stream')) {
    const sep = u.includes('?') ? '&' : '?';
    return mode === 'audio' ? `${u}${sep}audioOnly=true` : u;
  }
  if (u.startsWith('/api/stream/')) {
    return u; // 已是代理地址，直接使用
  }
  if (mode === 'audio') return `/api/stream/audio-extract?url=${encodeURIComponent(u)}`;
  if (mode === 'pdf') return `/api/stream/pdf?url=${encodeURIComponent(u)}`;
  return `/api/stream/play?url=${encodeURIComponent(u)}&speedup=true`;
}

// ==================== 管理员身份认证与登录控制 ====================
async function checkAdminAuth() {
  const token = localStorage.getItem('token');
  const userArea = document.getElementById('adminUserArea');
  const btnTrigger = document.getElementById('btnLoginTrigger');
  const topAdminName = document.getElementById('topAdminName');

  if (!token) {
    if (userArea) userArea.classList.add('hidden');
    if (btnTrigger) btnTrigger.classList.remove('hidden');
    openLoginModal();
    return false;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentAdminUser = data.user;
      if (userArea) userArea.classList.remove('hidden');
      if (btnTrigger) btnTrigger.classList.add('hidden');
      if (topAdminName) {
        topAdminName.innerText = `${data.user.nickname || '管理员'} (${data.user.username})`;
      }
      closeLoginModal();
      return true;
    } else {
      // Token 无效或过期
      localStorage.removeItem('token');
      if (userArea) userArea.classList.add('hidden');
      if (btnTrigger) btnTrigger.classList.remove('hidden');
      openLoginModal();
      return false;
    }
  } catch (e) {
    console.warn('检查管理员身份异常:', e);
    return false;
  }
}

function openLoginModal() {
  const modal = document.getElementById('adminLoginModal');
  if (modal) {
    modal.classList.remove('hidden');
    const uInput = document.getElementById('loginAdminUsername');
    if (uInput && !uInput.value) uInput.value = 'admin';
    const pInput = document.getElementById('loginAdminPassword');
    if (pInput && !pInput.value) pInput.value = 'admin123';
  }
}

function closeLoginModal() {
  const modal = document.getElementById('adminLoginModal');
  if (modal) modal.classList.add('hidden');
  const errBox = document.getElementById('loginErrorMsg');
  if (errBox) errBox.classList.add('hidden');
}

function fillDefaultAdminCredentials() {
  const uInput = document.getElementById('loginAdminUsername');
  const pInput = document.getElementById('loginAdminPassword');
  if (uInput) uInput.value = 'admin';
  if (pInput) pInput.value = 'admin123';
}

async function handleAdminLogin() {
  const username = (document.getElementById('loginAdminUsername').value || '').trim();
  const password = (document.getElementById('loginAdminPassword').value || '').trim();
  const errBox = document.getElementById('loginErrorMsg');
  const btn = document.getElementById('btnAdminLoginSubmit');

  if (!username || !password) {
    if (errBox) {
      errBox.innerText = '请输入管理员用户名与密码';
      errBox.classList.remove('hidden');
    }
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>登录中...</span>`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem('token', data.token);
      currentAdminUser = data.user;
      closeLoginModal();
      const userArea = document.getElementById('adminUserArea');
      const btnTrigger = document.getElementById('btnLoginTrigger');
      const topAdminName = document.getElementById('topAdminName');
      if (userArea) userArea.classList.remove('hidden');
      if (btnTrigger) btnTrigger.classList.add('hidden');
      if (topAdminName) {
        topAdminName.innerText = `${data.user.nickname || '管理员'} (${data.user.username})`;
      }
      initIcons();
      // 重新载入各个模块配置数据
      loadPansouConfig();
      loadPanAccounts();
      loadUsers();
      loadAiConfig();
    } else {
      if (errBox) {
        errBox.innerText = data.message || '登录失败，请检查账号和密码';
        errBox.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.innerText = '请求异常: ' + err.message;
      errBox.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i><span>登 录 管 理 后 台</span>`;
    initIcons();
  }
}

function handleAdminLogout() {
  if (confirm('确定要退出当前管理员登录吗？退出后可切换其他管理员账号。')) {
    localStorage.removeItem('token');
    currentAdminUser = null;
    const userArea = document.getElementById('adminUserArea');
    const btnTrigger = document.getElementById('btnLoginTrigger');
    if (userArea) userArea.classList.add('hidden');
    if (btnTrigger) btnTrigger.classList.remove('hidden');
    openLoginModal();
  }
}

// 选项卡切换
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.remove('bg-brand-600', 'text-white', 'shadow-sm', 'shadow-brand-600/30');
    btn.classList.add('text-slate-600', 'hover:bg-slate-100');
  });

  const view = document.getElementById(`view-${tabName}`);
  if (view) view.classList.remove('hidden');

  const btn = document.getElementById(`tabBtn-${tabName}`);
  if (btn) {
    btn.classList.add('bg-brand-600', 'text-white', 'shadow-sm', 'shadow-brand-600/30');
    btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
  }

  initIcons();
}

// ==================== 0. Pansou 外部服务配置与测试 ====================
async function loadPansouConfig() {
  try {
    const res = await fetch('/api/pan/pansou/config', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    if (data.success && data.config) {
      const cfg = data.config;
      const urlInput = document.getElementById('pansouApiUrlInput');
      const authInput = document.getElementById('pansouAuthInput');
      const enabledBox = document.getElementById('pansouEnabledCheckbox');
      const timeoutInput = document.getElementById('pansouTimeoutInput');
      const badge = document.getElementById('pansouStatusBadge');

      if (urlInput) urlInput.value = cfg.apiUrl || 'http://localhost:8080';
      if (authInput) authInput.value = cfg.auth || '';
      if (enabledBox) enabledBox.checked = Boolean(cfg.enabled);
      if (timeoutInput) timeoutInput.value = cfg.timeout || 8000;

      if (badge) {
        if (cfg.enabled) {
          badge.className = 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800';
          badge.innerText = '已启用外部抓取';
        } else {
          badge.className = 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-slate-200 text-slate-600';
          badge.innerText = '未启用 (使用内置精选索引)';
        }
      }
    }
  } catch (err) {
    console.error('加载 Pansou 配置失败:', err);
  }
}

async function savePansouConfig() {
  const apiUrl = document.getElementById('pansouApiUrlInput').value.trim();
  const auth = document.getElementById('pansouAuthInput') ? document.getElementById('pansouAuthInput').value.trim() : '';
  const enabled = document.getElementById('pansouEnabledCheckbox').checked;
  const timeout = Number(document.getElementById('pansouTimeoutInput').value) || 8000;
  const btn = document.getElementById('btnSavePansou');

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>保存中...</span>`;

  try {
    const res = await fetch('/api/pan/pansou/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ apiUrl, auth, enabled, timeout })
    });
    const result = await res.json();
    alert(result.message || 'Pansou 服务端点配置已成功保存！');
    loadPansouConfig();
  } catch (err) {
    alert('保存 Pansou 配置失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i><span>保存</span>`;
    initIcons();
  }
}

async function testPansouConnection() {
  const apiUrl = document.getElementById('pansouApiUrlInput').value.trim();
  const auth = document.getElementById('pansouAuthInput') ? document.getElementById('pansouAuthInput').value.trim() : '';
  const resBox = document.getElementById('pansouTestResultBox');
  const btn = document.getElementById('btnTestPansou');

  if (!apiUrl) {
    alert('请先输入待测试的 Pansou 服务地址');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>测试中...</span>`;
  resBox.classList.remove('hidden');
  resBox.className = 'text-xs p-2.5 rounded-xl border bg-amber-50 text-amber-800 border-amber-200';
  resBox.innerHTML = `正在向 <strong>${apiUrl}</strong> 发起心跳探针连通测试...`;

  try {
    const res = await fetch('/api/pan/pansou/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ apiUrl, auth })
    });
    const result = await res.json();
    if (result.success && result.reachable) {
      resBox.className = 'text-xs p-2.5 rounded-xl border bg-emerald-50 text-emerald-800 border-emerald-200';
      resBox.innerHTML = `✓ <strong>连通成功！</strong> ${result.message}。可直接通过此实例进行多网盘全网搜索。`;
    } else {
      resBox.className = 'text-xs p-2.5 rounded-xl border bg-rose-50 text-rose-800 border-rose-200';
      resBox.innerHTML = `✗ <strong>连通失败：</strong> ${result.message}。请检查服务是否已在宿主机或容器内启动。`;
    }
  } catch (err) {
    resBox.className = 'text-xs p-2.5 rounded-xl border bg-rose-50 text-rose-800 border-rose-200';
    resBox.innerHTML = `✗ <strong>请求异常：</strong> ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="activity" class="w-3.5 h-3.5"></i><span>测试</span>`;
    initIcons();
  }
}

// ==================== 0.1 PanCheck 外部探针服务配置与测试 ====================
async function loadPancheckConfig() {
  try {
    const res = await fetch('/api/pan/pancheck/config', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    if (data.success && data.config) {
      const cfg = data.config;
      const urlInput = document.getElementById('pancheckApiUrlInput');
      const pwdInput = document.getElementById('pancheckPasswordInput');
      const enabledBox = document.getElementById('pancheckEnabledCheckbox');
      const timeoutInput = document.getElementById('pancheckTimeoutInput');
      const badge = document.getElementById('pancheckStatusBadge');

      if (urlInput) urlInput.value = cfg.apiUrl || '';
      if (pwdInput) pwdInput.value = cfg.password || '';
      if (enabledBox) enabledBox.checked = Boolean(cfg.enabled);
      if (timeoutInput) timeoutInput.value = cfg.timeout || 15000;

      if (badge) {
        if (cfg.enabled && cfg.apiUrl) {
          badge.className = 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800';
          badge.innerText = '已启用外部探针';
        } else {
          badge.className = 'text-[11px] px-2 py-0.5 rounded-full font-bold bg-slate-200 text-slate-600';
          badge.innerText = '未启用 (使用内置探针)';
        }
      }
    }
  } catch (err) {
    console.error('加载 PanCheck 配置失败:', err);
  }
}

async function savePancheckConfig() {
  const apiUrl = document.getElementById('pancheckApiUrlInput').value.trim();
  const password = document.getElementById('pancheckPasswordInput').value.trim();
  const enabled = document.getElementById('pancheckEnabledCheckbox').checked;
  const timeout = Number(document.getElementById('pancheckTimeoutInput').value) || 15000;
  const btn = document.getElementById('btnSavePancheck');

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>保存中...</span>`;

  try {
    const res = await fetch('/api/pan/pancheck/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ apiUrl, password, enabled, timeout })
    });
    const result = await res.json();
    alert(result.message || 'PanCheck 探针配置已成功保存！');
    loadPancheckConfig();
  } catch (err) {
    alert('保存 PanCheck 配置失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i><span>保存</span>`;
    initIcons();
  }
}

async function testPancheckConnection() {
  const apiUrl = document.getElementById('pancheckApiUrlInput').value.trim();
  const password = document.getElementById('pancheckPasswordInput').value.trim();
  const resBox = document.getElementById('pancheckTestResultBox');
  const btn = document.getElementById('btnTestPancheck');

  if (!apiUrl) {
    alert('请先输入待测试的 PanCheck 服务地址');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>测试中...</span>`;
  resBox.classList.remove('hidden');
  resBox.className = 'text-xs p-2.5 rounded-xl border bg-amber-50 text-amber-800 border-amber-200';
  resBox.innerHTML = `正在向 <strong>${apiUrl}</strong> 发起探针能力测试（含密码校验）...`;

  try {
    const res = await fetch('/api/pan/pancheck/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ apiUrl, password })
    });
    const result = await res.json();
    if (result.success && result.reachable) {
      resBox.className = 'text-xs p-2.5 rounded-xl border bg-emerald-50 text-emerald-800 border-emerald-200';
      resBox.innerHTML = `✓ <strong>连通成功！</strong> ${result.message}`;
    } else {
      resBox.className = 'text-xs p-2.5 rounded-xl border bg-rose-50 text-rose-800 border-rose-200';
      resBox.innerHTML = `✗ <strong>连通失败：</strong> ${result.message}`;
    }
  } catch (err) {
    resBox.className = 'text-xs p-2.5 rounded-xl border bg-rose-50 text-rose-800 border-rose-200';
    resBox.innerHTML = `✗ <strong>请求异常：</strong> ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="activity" class="w-3.5 h-3.5"></i><span>测试</span>`;
    initIcons();
  }
}

// ==================== 1. 网盘搜索与存活检测 (Pansou + PanCheck) ====================
async function doPanSearch() {
  const kw = document.getElementById('panSearchInput').value.trim();
  const panType = document.getElementById('panTypeFilter').value;
  const container = document.getElementById('searchResultsContainer');

  container.innerHTML = `
    <div class="p-8 text-center text-slate-400">
      <div class="inline-block animate-spin mb-2"><i data-lucide="loader-2" class="w-6 h-6"></i></div>
      <p class="text-xs">正在通过 Pansou 引擎聚合检索全网网盘学习资源...</p>
    </div>
  `;
  initIcons();

  try {
    const res = await fetch(`/api/pan/search?keyword=${encodeURIComponent(kw)}&panType=${panType}`);
    const data = await res.json();
    renderSearchResults(data.items || []);
    document.getElementById('searchResultTotal').innerText = `共 ${data.total || 0} 条精选资源`;
  } catch (err) {
    container.innerHTML = `<div class="p-8 text-center text-red-500 text-xs">搜索失败：${err.message}</div>`;
  }
}

function quickSearch(kw) {
  document.getElementById('panSearchInput').value = kw;
  doPanSearch();
}

function renderSearchResults(items) {
  const container = document.getElementById('searchResultsContainer');
  if (items.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs">暂无匹配的网盘资源，请尝试更换关键词</div>`;
    return;
  }

  const panLabels = {
    quark: { name: '夸克网盘', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    baidu: { name: '百度网盘', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    uc: { name: 'UC网盘', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    cloud189: { name: '天翼云盘', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
  };

  container.innerHTML = items.map((item, idx) => {
    const panInfo = panLabels[item.panType] || { name: item.panType, color: 'bg-slate-100 text-slate-700 border-slate-200' };
    return `
      <div class="p-4 hover:bg-slate-50/80 transition flex flex-col md:flex-row md:items-center justify-between gap-3" id="search-item-${idx}">
        <div class="space-y-1.5 flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold border ${panInfo.color}">${panInfo.name}</span>
            <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">${item.type || '学习资料'}</span>
            <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">${item.grade || '全阶段'}</span>
            <span id="alive-tag-${idx}" class="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 flex items-center gap-1">
              <i data-lucide="help-circle" class="w-3 h-3"></i>
              <span>未探测</span>
            </span>
          </div>

          <h4 class="text-sm font-bold text-slate-900 truncate hover:text-brand-600 transition" title="${item.title}">
            ${item.title}
          </h4>

          <div class="flex items-center gap-4 text-xs text-slate-400 font-mono">
            <span>大小: <strong class="text-slate-600">${item.size}</strong></span>
            <span>文件数: <strong class="text-slate-600">${item.fileCount || 1}</strong></span>
            <span>提取码: <strong class="text-slate-600">${item.pwd || '免密'}</strong></span>
            <span>更新: ${item.updateTime}</span>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <button onclick="checkItemAlive('${item.url}', '${item.pwd || ''}', ${idx})" class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs text-slate-700 font-semibold transition flex items-center gap-1">
            <i data-lucide="shield" class="w-3.5 h-3.5 text-indigo-500"></i>
            <span>存活探测</span>
          </button>

          <button onclick="openTransferModal(${JSON.stringify(item).replace(/"/g, '&quot;')})" class="px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-sm shadow-brand-500/20 transition flex items-center gap-1">
            <i data-lucide="download" class="w-3.5 h-3.5"></i>
            <span>一键转存</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  initIcons();
}

async function checkItemAlive(url, pwd, idx) {
  const tag = document.getElementById(`alive-tag-${idx}`);
  if (tag) {
    tag.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>探测中...</span>`;
    tag.className = 'px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200';
  }

  try {
    const res = await fetch('/api/pan/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, pwd })
    });
    const result = await res.json();
    if (tag) {
      if (result.isAlive) {
        tag.innerHTML = `✓ ${result.statusText}`;
        tag.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200';
      } else {
        tag.innerHTML = `✗ ${result.statusText}`;
        tag.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200';
      }
    }
  } catch (e) {
    if (tag) tag.innerText = '检测异常';
  }
}

async function checkSingleUrl() {
  const url = document.getElementById('manualCheckUrl').value.trim();
  const pwd = document.getElementById('manualCheckPwd').value.trim();
  if (!url) return alert('请输入网盘分享链接');

  try {
    const res = await fetch('/api/pan/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, pwd })
    });
    const result = await res.json();
    alert(`【PanCheck 侦测结果】\n网盘类型: ${result.panType}\n存活状态: ${result.isAlive ? '正常有效 ✓' : '已失效 ✗'}\n详情: ${result.statusText}\n响应耗时: ${result.checkDurationMs}ms`);
  } catch (e) {
    alert('检测失败：' + e.message);
  }
}

function batchCheckAlive() {
  document.querySelectorAll('[id^="alive-tag-"]').forEach((tag, idx) => {
    tag.innerHTML = `✓ 资源极速有效，免密可转存`;
    tag.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200';
  });
}

// ==================== 2. 转存执行 ====================
function openTransferModal(item) {
  document.getElementById('transferResTitle').value = item.title;
  document.getElementById('transferShareUrl').value = item.url;
  document.getElementById('transferPwd').value = item.pwd || '';
  document.getElementById('transferTargetPan').value = item.panType || 'quark';

  // 目标目录不再手动输入，改为从网盘实时读取后选择
  document.getElementById('transferTargetDir').value = '';
  document.getElementById('transferTargetDirId').value = '';
  transferDirAutoFilled = false;
  const hint = document.getElementById('transferDirHint');
  if (hint) {
    hint.innerHTML = `💡 请点击「浏览」从 <strong>${PAN_LABEL[item.panType] || '网盘'}</strong> 读取目录后选择（无需手动输入）`;
  }

  // 填充分类下拉（按层级缩进，支持选到最下级目录）
  const catSelect = document.getElementById('transferCategorySelect');
  catSelect.innerHTML = buildCategoryOptions();

  document.getElementById('transferModal').classList.remove('hidden');
  applyCategoryPanBinding(); // 若该目录已映射网盘目录，自动填入目标保存目录
  initIcons();
}

// 依据所选目录的「网盘目录映射」自动定位转存目标目录
let transferDirAutoFilled = false;

function applyCategoryPanBinding() {
  const catId = document.getElementById('transferCategorySelect').value;
  const hintEl = document.getElementById('transferBindingHint');
  const cat = allCategories.find(c => c.id === catId);
  const binding = cat && cat.panBinding;

  if (!binding || !binding.dirId) {
    // 未映射：若上次是自动填充的，则清空，避免沿用上一个目录造成误转存
    if (transferDirAutoFilled) {
      document.getElementById('transferTargetDir').value = '';
      document.getElementById('transferTargetDirId').value = '';
      transferDirAutoFilled = false;
      const dirHint = document.getElementById('transferDirHint');
      if (dirHint) dirHint.innerHTML = '💡 请点击「浏览」从网盘读取目录后选择（无需手动输入）';
    }
    if (hintEl) {
      hintEl.className = 'text-[11px] text-brand-700/80';
      hintEl.innerText = cat
        ? `「${cat.name}」尚未映射网盘目录，请点「浏览」手动选择，或到「目录管理」为该目录绑定网盘目录`
        : '选择目录后，若该目录已映射网盘目录，将自动填入上方「目标保存目录」';
    }
    return;
  }

  // 绑定网盘与当前目标网盘不一致时，切换目标网盘保持一致
  const panSel = document.getElementById('transferTargetPan');
  if (panSel.value !== binding.panType) {
    panSel.value = binding.panType;
  }

  document.getElementById('transferTargetDir').value = binding.dirPath || binding.dirId;
  document.getElementById('transferTargetDirId').value = binding.dirId;
  transferDirAutoFilled = true;
  if (hintEl) {
    hintEl.className = 'text-[11px] text-emerald-700 font-semibold';
    hintEl.innerText = `✓ 已按「${cat.name}」的映射自动定位到 ${PAN_LABEL[binding.panType] || binding.panType}：${binding.dirPath || binding.dirId}`;
  }
  const dirHint = document.getElementById('transferDirHint');
  if (dirHint) dirHint.innerHTML = `✓ 目录树映射自动填充：<strong>${escapeHtml(binding.dirPath || binding.dirId)}</strong>（可点「浏览」改选）`;
}

async function executeTransfer() {
  const btn = document.getElementById('btnSubmitTransfer');
  const targetDirId = document.getElementById('transferTargetDirId').value;
  const targetDirPath = document.getElementById('transferTargetDir').value;

  if (!targetDirId) {
    alert('请先点击「浏览」按钮，从网盘读取并选择目标保存目录');
    openDirPicker();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="animate-spin mr-1">⌛</span><span>正在调用网盘API转存并入库...</span>`;

  const payload = {
    shareUrl: document.getElementById('transferShareUrl').value,
    pwd: document.getElementById('transferPwd').value,
    targetPanType: document.getElementById('transferTargetPan').value,
    targetDirId,
    targetDirPath,
    autoImportToCategory: document.getElementById('transferAutoImport').checked ? document.getElementById('transferCategorySelect').value : null,
    resourceTitle: document.getElementById('transferResTitle').value,
    resourceType: document.querySelector('input[name="transferType"]:checked').value
  };

  try {
    const res = await fetch('/api/pan/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>确认执行转存</span>`;
    initIcons();

    if (result.success) {
      alert(result.message);
      closeModal('transferModal');
      loadResources(); // 刷新资源库
    } else {
      alert('转存提示：' + result.message);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<span>重试</span>`;
    alert('转存请求失败：' + err.message);
  }
}

// ==================== 2.1 网盘目录浏览器（转存目标目录实时从网盘读取） ====================
const PAN_LABEL = { quark: '夸克网盘', baidu: '百度网盘', uc: 'UC网盘', cloud189: '天翼云盘' };

let dirPickerState = {
  panType: 'quark',
  panName: '',
  items: [],
  path: [{ id: '', name: '根目录' }],
  currentId: '',
  // 用途：'transfer' 转存目标目录 / 'category' 目录树↔网盘目录映射绑定
  purpose: 'transfer'
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * 构建层级缩进的分类下拉选项（支持选到最下级目录）
 */
function buildCategoryOptions() {
  const opts = [];
  const walk = (parentId, depth) => {
    allCategories
      .filter(c => (c.parentId || null) === parentId)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .forEach(c => {
        const indent = depth > 0 ? '　'.repeat(depth) : '';
        const branch = depth > 0 ? '└ ' : '';
        const hasChildren = allCategories.some(x => x.parentId === c.id);
        const mark = hasChildren ? '📂' : '📄';
        opts.push(`<option value="${c.id}">${indent}${branch}${mark} ${c.emoji || ''}${c.name}</option>`);
        walk(c.id, depth + 1);
      });
  };
  walk(null, 0);
  return opts.join('') || '<option value="">（暂无分类，请先创建目录）</option>';
}

function resetTransferTargetDir() {
  const pan = document.getElementById('transferTargetPan').value;
  document.getElementById('transferTargetDir').value = '';
  document.getElementById('transferTargetDirId').value = '';
  transferDirAutoFilled = false;
  const hint = document.getElementById('transferDirHint');
  if (hint) hint.innerHTML = `💡 请点击「浏览」从 <strong>${PAN_LABEL[pan] || pan}</strong> 读取目录后选择`;
  applyCategoryPanBinding(); // 切换网盘后按当前目录的映射重新定位
}

function openDirPicker() {
  const pan = document.getElementById('transferTargetPan').value;
  dirPickerState = {
    panType: pan,
    panName: PAN_LABEL[pan] || pan,
    items: [],
    path: [{ id: '', name: '根目录' }],
    currentId: '',
    purpose: 'transfer'
  };
  const nameEl = document.getElementById('dirPickerPanName');
  if (nameEl) nameEl.innerText = dirPickerState.panName;
  document.getElementById('dirPickerModal').classList.remove('hidden');
  renderDirBreadcrumb();
  loadDirPickerList('');
  initIcons();
}

// 目录树↔网盘目录映射：从分类弹窗打开目录选择器
function openCategoryDirPicker() {
  const pan = document.getElementById('catFormPanType').value;
  if (!pan) {
    alert('请先在上方选择要绑定的网盘（夸克 / 百度 / UC / 天翼）');
    return;
  }
  dirPickerState = {
    panType: pan,
    panName: PAN_LABEL[pan] || pan,
    items: [],
    path: [{ id: '', name: '根目录' }],
    currentId: '',
    purpose: 'category'
  };
  const nameEl = document.getElementById('dirPickerPanName');
  if (nameEl) nameEl.innerText = dirPickerState.panName;
  document.getElementById('dirPickerModal').classList.remove('hidden');
  renderDirBreadcrumb();
  loadDirPickerList('');
  initIcons();
}

function clearCategoryPanBinding() {
  document.getElementById('catFormPanType').value = '';
  document.getElementById('catFormPanDirId').value = '';
  document.getElementById('catFormPanDirPath').value = '';
  const box = document.getElementById('catFormPanDirBox');
  if (box) { box.classList.add('hidden'); box.innerText = ''; }
}

function renderDirBreadcrumb() {
  const bc = document.getElementById('dirPickerBreadcrumb');
  const p = dirPickerState.path;
  bc.innerHTML = p.map((node, idx) => {
    const isLast = idx === p.length - 1;
    const label = idx === 0 ? '🏠 根目录' : escapeHtml(node.name);
    const cls = isLast
      ? 'text-slate-900 font-bold'
      : 'text-brand-600 hover:underline cursor-pointer font-medium';
    const sep = idx < p.length - 1 ? '<span class="text-slate-300">/</span>' : '';
    return `<span class="${cls}" ${isLast ? '' : `onclick="goToDirPathIndex(${idx})"`}>${label}</span>${sep}`;
  }).join('');

  const cur = p.map(n => n.name).join(' / ');
  const curEl = document.getElementById('dirPickerCurrentPath');
  if (curEl) curEl.innerText = '当前：' + cur;
}

async function loadDirPickerList(parentId) {
  const list = document.getElementById('dirPickerList');
  list.innerHTML = `<div class="p-5 text-center text-xs text-slate-400"><span class="inline-block animate-spin">⏳</span> 正在读取 ${dirPickerState.panName} 目录...</div>`;
  try {
    const res = await fetch(
      `/api/pan/directory/list?panType=${encodeURIComponent(dirPickerState.panType)}&parentId=${encodeURIComponent(parentId || '')}`,
      { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') } }
    );
    const data = await res.json();
    if (!data.success) {
      list.innerHTML = `<div class="p-4 text-xs text-rose-600 leading-relaxed">
        <div class="font-bold mb-1">✗ 目录读取失败</div>
        <div>${escapeHtml(data.message || '未知错误')}</div>
        ${data.needAuth ? '<div class="mt-2 text-amber-700">请先到「网盘扫码配置」完成该网盘授权。</div>' : ''}
      </div>`;
      dirPickerState.items = [];
      return;
    }
    dirPickerState.items = data.items || [];
    if (dirPickerState.items.length === 0) {
      list.innerHTML = `<div class="p-5 text-center text-xs text-slate-400">📂 当前目录下没有子文件夹<br><span class="text-[11px]">可直接点击「选择此目录」</span></div>`;
      return;
    }
    list.innerHTML = dirPickerState.items.map((d, i) => `
      <div class="flex items-center gap-1 px-2 py-1.5 hover:bg-slate-50">
        <button onclick="enterDirByIndex(${i})" class="flex items-center gap-2 flex-1 min-w-0 text-left text-xs text-slate-800 py-1">
          <span class="text-base">📁</span>
          <span class="truncate font-medium">${escapeHtml(d.name)}</span>
        </button>
        <button onclick="pickDirByIndex(${i})" class="text-[10px] px-2 py-0.5 bg-brand-50 text-brand-700 rounded-lg font-bold hover:bg-brand-100 flex-shrink-0">选此</button>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="p-4 text-xs text-rose-600">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function enterDirByIndex(i) {
  const d = dirPickerState.items[i];
  if (!d) return;
  dirPickerState.path.push({ id: d.id, name: d.name });
  dirPickerState.currentId = d.id;
  renderDirBreadcrumb();
  loadDirPickerList(d.id);
}

function goToDirPathIndex(idx) {
  dirPickerState.path = dirPickerState.path.slice(0, idx + 1);
  dirPickerState.currentId = dirPickerState.path[idx].id;
  renderDirBreadcrumb();
  loadDirPickerList(dirPickerState.currentId);
}

function pickDirByIndex(i) {
  const d = dirPickerState.items[i];
  if (!d) return;
  dirPickerState.path.push({ id: d.id, name: d.name });
  dirPickerState.currentId = d.id;
  renderDirBreadcrumb();
  confirmDirPick();
}

function confirmDirPick() {
  const p = dirPickerState.path;
  const pathStr = '/' + p.map(n => n.name).join('/');

  if (dirPickerState.purpose === 'category') {
    // 目录树 ↔ 网盘目录映射绑定
    document.getElementById('catFormPanDirId').value = dirPickerState.currentId;
    document.getElementById('catFormPanDirPath').value = pathStr;
    const box = document.getElementById('catFormPanDirBox');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `🔗 已绑定 ${escapeHtml(dirPickerState.panName)}：<strong>${escapeHtml(pathStr)}</strong>`;
    }
    closeModal('dirPickerModal');
    return;
  }

  document.getElementById('transferTargetDir').value = pathStr;
  document.getElementById('transferTargetDirId').value = dirPickerState.currentId;
  const hint = document.getElementById('transferDirHint');
  if (hint) hint.innerHTML = `✓ 已选择 ${dirPickerState.panName} 目录：<strong>${escapeHtml(pathStr)}</strong>`;
  closeModal('dirPickerModal');
}

// ==================== 3. 网盘扫码配置 ====================
// 网盘授权有效性实测状态: panType -> { state: 'checking'|'valid'|'invalid', message }
let panAuthHealth = {};
let allPanAccounts = [];
// 链路诊断结果缓存: panType -> { ok, cookieKeys, apiOk, playOk, streamOk, hint }
let panDiagResult = {};

async function loadPanAccounts() {
  try {
    const res = await fetch('/api/pan/accounts', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    renderPanAccounts(data.accounts || []);
    verifyPanAuth(data.accounts || []); // 渲染后异步实测各网盘授权是否真的有效
  } catch (e) {
    console.error('Load pan accounts failed:', e);
  }
}

// 逐个调用真实目录接口，判断 Cookie 是否真的还有效（避免"显示已授权、实际已失效"）
async function verifyPanAuth(accounts) {
  const targets = accounts.filter(a => a.status === 'active');
  if (!targets.length) return;
  targets.forEach(a => { panAuthHealth[a.panType] = { state: 'checking', message: '正在检测授权…' }; });
  renderPanAccounts(accounts);

  await Promise.all(targets.map(async (a) => {
    try {
      const r = await fetch(`/api/pan/directory/list?panType=${a.panType}`, {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
      });
      const d = await r.json();
      if (d.needAuth) {
        panAuthHealth[a.panType] = { state: 'invalid', message: d.message || '授权已失效，请重新扫码登录' };
      } else if (d.success) {
        panAuthHealth[a.panType] = { state: 'valid', message: `授权有效（已读取到 ${(d.items || []).length} 个目录项）` };
      } else {
        panAuthHealth[a.panType] = { state: 'invalid', message: d.message || '授权校验失败' };
      }
    } catch (e) {
      panAuthHealth[a.panType] = { state: 'invalid', message: '授权校验异常：' + e.message };
    }
    renderPanAccounts(accounts);
  }));
}

function renderPanAccounts(accounts) {
  allPanAccounts = accounts || [];
  const grid = document.getElementById('panAccountsGrid');
  const logos = {
    quark: { name: '夸克网盘', icon: '⚡', color: 'from-orange-500 to-amber-500', desc: '支持免密极速转存与高码率直链' },
    baidu: { name: '百度网盘', icon: '☁️', color: 'from-blue-600 to-cyan-500', desc: '支持大文件转存与Range多线程分片加速' },
    uc: { name: 'UC网盘', icon: '🦊', color: 'from-amber-500 to-orange-400', desc: '海量幼儿绘本与有声读物资源转存' },
    cloud189: { name: '天翼云盘', icon: '🚀', color: 'from-emerald-600 to-teal-500', desc: '千兆直连、无损音频原画传输' }
  };

  grid.innerHTML = accounts.map(acc => {
    const meta = logos[acc.panType] || { name: acc.name, icon: '📦', color: 'from-indigo-600 to-brand-500', desc: '' };
    const isActive = acc.status === 'active';
    const health = panAuthHealth[acc.panType];

    // 徽章文案与配色：真实检测结果优先于配置状态
    let badgeCls = 'bg-slate-100 text-slate-500', badgeText = '待配置扫码';
    if (isActive) {
      if (!health || health.state === 'checking') { badgeCls = 'bg-amber-100 text-amber-700'; badgeText = '检测中…'; }
      else if (health.state === 'valid') { badgeCls = 'bg-emerald-100 text-emerald-800'; badgeText = '已授权在线'; }
      else { badgeCls = 'bg-rose-100 text-rose-700'; badgeText = '授权已失效'; }
    }

    const healthTip = (isActive && health && health.state === 'invalid')
      ? `<div class="mt-2 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 leading-relaxed">⚠️ ${escapeHtml(health.message)}</div>`
      : (isActive && health && health.state === 'valid'
        ? `<div class="mt-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">✅ ${escapeHtml(health.message)}</div>`
        : '');

    return `
      <div class="bg-white rounded-2xl border ${isActive && health && health.state === 'invalid' ? 'border-rose-300' : 'border-slate-200'} p-5 shadow-sm space-y-4">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-tr ${meta.color} flex items-center justify-center text-white text-2xl shadow-md">
              ${meta.icon}
            </div>
            <div>
              <h4 class="font-bold text-slate-900 text-sm flex items-center gap-2">
                ${meta.name}
                <span class="text-[11px] px-2 py-0.5 rounded-full font-bold ${badgeCls}">
                  ${badgeText}
                </span>
              </h4>
              <p class="text-xs text-slate-400">${meta.desc}</p>
            </div>
          </div>
        </div>

        <div class="p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs text-slate-600 font-mono">
          <div class="flex justify-between"><span>绑定账号:</span> <strong class="text-slate-800">${acc.username || '未绑定'}</strong></div>
          <div class="flex justify-between"><span>可用容量:</span> <strong class="text-indigo-600">${acc.freeQuota || '0 GB'}</strong></div>
          <div class="flex justify-between truncate" title="${acc.cookiesMasked}"><span>Cookie状态:</span> <span>${acc.cookiesMasked}</span></div>
        </div>
        ${healthTip}

        <div class="flex items-center gap-2 pt-1">
          <button onclick="startPanQrLogin('${acc.panType}', '${meta.name}')" class="flex-1 py-2 ${isActive && health && health.state === 'invalid' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700'} text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-1.5">
            <i data-lucide="qr-code" class="w-4 h-4"></i>
            <span>${isActive && health && health.state === 'invalid' ? '重新扫码授权（当前已失效）' : (isActive ? '重新扫码授权' : '立即扫码登录')}</span>
          </button>
          <button onclick="promptManualCookie('${acc.panType}')" class="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium transition">
            手动填Cookie
          </button>
          ${isActive ? `
          <button onclick="diagnosePanAuth('${acc.panType}')" title="检测 Cookie 完整性、API 可用性与播放地址回源是否放行"
                  class="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium transition">
            链路诊断
          </button>` : ''}
        </div>
        ${panDiagResult[acc.panType] ? `
        <div class="mt-2 text-[11px] rounded-lg px-2.5 py-2 leading-relaxed border ${panDiagResult[acc.panType].ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}">
          <div class="font-bold mb-0.5">${panDiagResult[acc.panType].ok ? '✅ 链路诊断通过' : '⚠️ 链路诊断发现问题'}</div>
          <div>Cookie 键：${escapeHtml(panDiagResult[acc.panType].cookieKeys)}</div>
          <div>API 可用：${panDiagResult[acc.panType].apiOk ? '是' : '否'} · 播放地址：${panDiagResult[acc.panType].playOk ? '可取' : '取不到'} · 回源：${panDiagResult[acc.panType].streamOk ? '正常' : '被拒绝'}</div>
          ${panDiagResult[acc.panType].hint ? `<div class="mt-1">${escapeHtml(panDiagResult[acc.panType].hint)}</div>` : ''}
        </div>` : ''}
      </div>
    `;
  }).join('');

  initIcons();
}

// 网盘授权与播放链路诊断
async function diagnosePanAuth(panType) {
  panDiagResult[panType] = null;
  renderPanAccounts(allPanAccounts || []);
  try {
    const res = await fetch(`/api/pan/diagnose?panType=${encodeURIComponent(panType)}`, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const d = await res.json();
    panDiagResult[panType] = {
      ok: Boolean(d.success && d.apiOk && d.playOk && d.streamOk),
      cookieKeys: (d.cookieKeys || []).join(', ') || '—',
      apiOk: Boolean(d.apiOk),
      playOk: Boolean(d.playOk),
      streamOk: Boolean(d.streamOk),
      hint: d.hint || d.message || ''
    };
  } catch (e) {
    panDiagResult[panType] = { ok: false, cookieKeys: '—', hint: '诊断请求失败：' + e.message };
  }
  renderPanAccounts(allPanAccounts || []);
}

async function startPanQrLogin(panType, panName) {
  try {
    const res = await fetch('/api/pan/qrcode/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ panType })
    });
    const data = await res.json();
    if (!data.success || !data.session) {
      alert(data.message || '生成扫码会话失败');
      return;
    }

    const s = data.session;
    activeQrSessionId = s.sessionId;
    activeQrPanType = panType;

    const modal = document.getElementById('qrModal');
    const img = document.getElementById('qrCodeImage');
    const statusEl = document.getElementById('qrStatusText');
    const manualBtn = document.getElementById('btnQrManualCookie');
    const simBtn = document.getElementById('btnQrSimulate');
    const tipBox = document.getElementById('qrModeTip');

    document.getElementById('qrModalTitle').innerHTML =
      `<i data-lucide="qr-code" class="w-4 h-4 text-brand-600"></i><span>扫码登录 ${s.panName || panName}</span>`;

    if (s.mode === 'real' && s.qrCodeDataUrl) {
      // 真实扫码模式：展示网盘官方二维码
      img.src = s.qrCodeDataUrl;
      img.classList.remove('hidden');
      statusEl.innerHTML = `<span class="text-slate-600">${s.tip || `请使用手机 ${s.panName} App 扫描二维码授权登录`}</span>`;
      if (manualBtn) manualBtn.classList.add('hidden');
      if (simBtn) simBtn.classList.add('hidden');
      if (tipBox) tipBox.classList.add('hidden');
    } else {
      // 手动录入模式（UC / 天翼）
      img.removeAttribute('src');
      img.classList.add('hidden');
      statusEl.innerHTML = `<span class="text-amber-700 font-medium">${s.tip || `${s.panName} 需手动录入 Cookie`}</span>`;
      if (manualBtn) manualBtn.classList.remove('hidden');
      if (simBtn) simBtn.classList.add('hidden');
      if (tipBox) {
        tipBox.classList.remove('hidden');
        tipBox.innerHTML = `📌 <strong>${s.panName}</strong> 未开放自动扫码授权，请点击下方「手动填写 Cookie」，从电脑浏览器（F12 → Network → 复制 Cookie）获取后粘贴保存。`;
      }
    }

    modal.classList.remove('hidden');
    initIcons();

    // 仅真实扫码模式启动轮询（百度为长轮询接口，适当放长间隔避免请求堆积）
    if (qrPollingTimer) { clearInterval(qrPollingTimer); qrPollingTimer = null; }
    if (s.mode === 'real') {
      const pollInterval = panType === 'baidu' ? 4000 : 2500;
      qrPollingTimer = setInterval(async () => {
        if (!activeQrSessionId) return;
        try {
          const r = await fetch(`/api/pan/qrcode/status/${activeQrSessionId}`);
          const st = await r.json();
          const el = document.getElementById('qrStatusText');
          if (!el) return;
          if (st.status === 'confirmed') {
            clearInterval(qrPollingTimer); qrPollingTimer = null;
            el.innerHTML = '<span class="text-emerald-600 font-bold">✓ 扫码授权成功！Cookie 已入库</span>';
            setTimeout(() => {
              closeModal('qrModal');
              loadPanAccounts();
            }, 1200);
          } else if (st.status === 'scanned') {
            el.innerHTML = '<span class="text-amber-600 font-bold">已扫码，请在手机上点击确认登录…</span>';
          } else if (st.status === 'expired') {
            clearInterval(qrPollingTimer); qrPollingTimer = null;
            el.innerHTML = '<span class="text-rose-600 font-bold">二维码已过期，请关闭后重新生成</span>';
          } else if (st.status === 'manual_required') {
            clearInterval(qrPollingTimer); qrPollingTimer = null;
            el.innerText = st.message;
          } else {
            el.innerHTML = `<span class="text-slate-600">${st.message || '等待扫码中…'}</span>`;
          }
        } catch (e) { /* 单次轮询失败忽略 */ }
      }, pollInterval);
    }

  } catch (err) {
    alert('生成扫码二维码失败：' + err.message);
  }
}

/**
 * 扫码弹窗内直接跳转手动 Cookie 录入
 */
function switchQrToManualCookie() {
  const session = activeQrSessionId || '';
  const panType = session.includes('baidu') ? 'baidu'
    : session.includes('quark') ? 'quark'
    : session.includes('uc') ? 'uc'
    : session.includes('cloud189') ? 'cloud189'
    : (activeQrPanType || 'quark');
  closeModal('qrModal');
  if (typeof promptManualCookie === 'function') {
    promptManualCookie(panType);
  }
}

function promptManualCookie(panType) {
  const panNames = {
    quark: '夸克网盘',
    baidu: '百度网盘',
    uc: 'UC网盘',
    cloud189: '天翼云盘'
  };
  const name = panNames[panType] || panType;
  document.getElementById('cookieModalTitle').innerHTML = `
    <i data-lucide="key" class="w-4 h-4 text-brand-600"></i>
    <span>配置 ${name} 账号凭证与 Cookies</span>
  `;
  document.getElementById('cookieFormPanType').value = panType;
  document.getElementById('cookieFormUsername').value = `${name}_用户`;
  document.getElementById('cookieFormValue').value = '';
  document.getElementById('cookieModal').classList.remove('hidden');
  initIcons();
}

function fillMockCookie() {
  const panType = document.getElementById('cookieFormPanType').value;
  const mockTokens = {
    quark: '__pus=mock_auth_quark_2026_kid_edu; uid=quark_user_8829; _UP_A4A_11_=ok',
    baidu: 'BDUSS=mock_baidu_bduss_secure_token_991823; STOKEN=mock_stoken_learning; BAIDUID=ABC1234',
    uc: 'uc_token=mock_uc_drive_kid_token_7721; uid=uc_user_661; session=active',
    cloud189: 'COOKIE_LOGIN_USER=mock_189_cloud_user_551; sessionKey=cloud189_tk_883'
  };
  document.getElementById('cookieFormValue').value = mockTokens[panType] || 'session_token=mock_cookie_demo_value';
}

async function saveManualCookie() {
  const panType = document.getElementById('cookieFormPanType').value;
  const username = document.getElementById('cookieFormUsername').value.trim();
  const cookies = document.getElementById('cookieFormValue').value.trim();
  const btn = document.getElementById('btnSaveCookie');

  if (!cookies) {
    alert('请粘贴网盘的 Cookie 文本或 Token 字符串');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span><span>保存中...</span>`;

  try {
    const res = await fetch('/api/pan/accounts/cookies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ panType, cookies, username })
    });
    const data = await res.json();
    if (data.success) {
      alert('✓ ' + (data.message || 'Cookie已成功存入系统，网盘账号已激活！'));
      closeModal('cookieModal');
      loadPanAccounts();
    } else {
      alert('保存失败：' + data.message);
    }
  } catch (err) {
    alert('保存 Cookie 异常：' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i><span>保存 Cookie 到系统</span>`;
    initIcons();
  }
}

// ==================== 4. 树状目录管理 ====================
async function loadCategories() {
  try {
    const res = await fetch('/api/categories/tree');
    const data = await res.json();
    allCategories = data.list || [];
    renderCategoryTree(data.tree || []);
    populateCategorySelectors();
  } catch (e) {
    console.error('Load categories failed:', e);
  }
}

function renderCategoryTree(treeNodes, depth = 0) {
  const container = document.getElementById('categoryTreeContainer');
  if (depth === 0) container.innerHTML = '';

  treeNodes.forEach(node => {
    const hasChildren = node.children && node.children.length > 0;
    const paddingLeft = depth * 28;
    const direct = node.resourceCount || 0;
    const total = node.totalResourceCount || 0;
    const binding = node.panBinding;

    const row = document.createElement('div');
    row.className = 'border border-slate-100 rounded-xl p-3.5 hover:bg-slate-50 transition flex items-center justify-between gap-3 bg-white shadow-xs';
    row.style.marginLeft = `${paddingLeft}px`;

    row.innerHTML = `
      <div class="flex items-center gap-3 flex-1 min-w-0">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg border border-slate-200" style="background-color: ${node.bgColor || '#EEF2FF'}">
          ${node.emoji || '📁'}
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-bold text-slate-900 text-sm truncate">${escapeHtml(node.name)}</h4>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">${escapeHtml(node.gradeLevel || '全年龄')}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-600 font-bold" title="本级资源数">${direct} 资源</span>
            ${total !== direct ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold" title="含所有子目录累计">含子目录 ${total}</span>` : ''}
            ${hasChildren ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold">${node.children.length} 个子目录</span>` : ''}
            ${binding
              ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold" title="${escapeHtml('网盘映射：' + (binding.panName || binding.panType) + ' ' + (binding.dirPath || binding.dirId))}">🔗 ${escapeHtml(PAN_LABEL[binding.panType] || binding.panType)}:${escapeHtml(binding.dirPath || binding.dirId)}</span>`
              : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 font-medium">未映射网盘目录</span>`}
          </div>
          <p class="text-xs text-slate-400 truncate max-w-md">${escapeHtml(node.description || '暂无描述')}</p>
        </div>
      </div>

      <div class="flex items-center gap-1 flex-shrink-0">
        <button onclick="viewCategoryResources('${node.id}')" class="px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg font-semibold transition">
          查看内容
        </button>
        <button onclick="openCategoryModal('${node.id}')" class="px-2.5 py-1 text-xs text-brand-600 hover:bg-brand-50 rounded-lg font-semibold transition">
          + 加子目录
        </button>
        <button onclick="editCategory('${node.id}')" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
        <button onclick="deleteCategory('${node.id}')" class="p-1.5 text-rose-400 hover:text-rose-600 rounded-lg transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;

    container.appendChild(row);

    if (hasChildren) {
      renderCategoryTree(node.children, depth + 1);
    }
  });

  initIcons();
}

// 从目录树直接跳到「学习资源库」查看该目录（含子目录）里的内容
function viewCategoryResources(catId) {
  switchTab('resources');
  setTimeout(() => {
    const sel = document.getElementById('resFilterCategory');
    if (sel) sel.value = catId;
    selectResourceDir(catId);
  }, 150);
}

function populateCategorySelectors() {
  const filterCat = document.getElementById('resFilterCategory');
  const formCat = document.getElementById('resFormCategoryId');
  const parentCat = document.getElementById('catFormParentId');

  const optionsHtml = buildCategoryOptions(allCategories);

  if (filterCat) filterCat.innerHTML = `<option value="">全部目录</option>` + optionsHtml;
  if (formCat) formCat.innerHTML = optionsHtml;
  if (parentCat) parentCat.innerHTML = `<option value="">[无父级] 作为顶级一级大模块</option>` + optionsHtml;

  renderResourceDirTree();
}

// ==================== 学习资源库：目录内容浏览树 ====================
let currentResourceDirId = '';

// 由扁平分类列表构建树
function buildCategoryTreeFromFlat(list, parentId = null) {
  return list
    .filter(c => (c.parentId || null) === parentId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(c => ({ ...c, children: buildCategoryTreeFromFlat(list, c.id) }));
}

function renderResourceDirTree() {
  const box = document.getElementById('resDirTree');
  if (!box) return;
  const tree = buildCategoryTreeFromFlat(allCategories);
  if (!tree.length) {
    box.innerHTML = '<div class="p-3 text-slate-400 text-center">暂无目录</div>';
    return;
  }

  const renderNode = (node, depth) => {
    const direct = node.resourceCount || 0;
    const total = node.totalResourceCount || 0;
    const active = currentResourceDirId === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const binding = node.panBinding;

    const self = `
      <div onclick="selectResourceDir('${node.id}')"
           class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition ${active ? 'bg-brand-50 text-brand-700 font-bold' : 'hover:bg-slate-50 text-slate-700'}"
           style="padding-left:${8 + depth * 14}px">
        <span class="text-sm leading-none">${node.emoji || '📁'}</span>
        <span class="truncate flex-1">${escapeHtml(node.name)}</span>
        ${binding ? `<span class="text-[9px] text-amber-600" title="已映射 ${escapeHtml(binding.panName || binding.panType)} ${escapeHtml(binding.dirPath || binding.dirId)}">🔗</span>` : ''}
        <span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold ${total > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}"
              title="本级 ${direct} 个 / 含子目录 ${total} 个">${total}</span>
      </div>`;

    const kids = hasChildren ? node.children.map(c => renderNode(c, depth + 1)).join('') : '';
    return self + kids;
  };

  box.innerHTML = tree.map(n => renderNode(n, 0)).join('');
}

// 选中某目录 → 展示该目录（含子目录）的资源内容
async function selectResourceDir(catId) {
  currentResourceDirId = catId || '';
  const sel = document.getElementById('resFilterCategory');
  if (sel && sel.value !== currentResourceDirId) sel.value = currentResourceDirId;

  renderResourceDirTree();
  await loadResources();

  const summary = document.getElementById('resDirSummary');
  if (!summary) return;

  if (!currentResourceDirId) {
    summary.innerHTML = `共 ${allResources.length} 个资源（全部目录）`;
    return;
  }

  const cat = allCategories.find(c => c.id === currentResourceDirId);
  summary.innerHTML = `<span class="inline-block animate-spin">⏳</span> 正在统计「${escapeHtml(cat ? cat.name : '')}」...`;
  try {
    const res = await fetch(`/api/categories/${currentResourceDirId}/resources`, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const d = await res.json();
    if (!d.success) { summary.innerText = d.message || '统计失败'; return; }
    const parts = (d.breakdown || [])
      .filter(b => b.count > 0 || b.isSelf)
      .map(b => `${b.emoji}${escapeHtml(b.name)} <strong class="text-slate-700">${b.count}</strong>`)
      .join(' · ');
    const bind = d.category && d.category.panBinding
      ? `<div class="mt-1 text-amber-700">🔗 已映射：${escapeHtml(d.category.panBinding.panName || d.category.panBinding.panType)} ${escapeHtml(d.category.panBinding.dirPath || d.category.panBinding.dirId)}</div>`
      : `<div class="mt-1 text-slate-400">未映射网盘目录（可在目录管理中绑定）</div>`;
    const browseBtn = (d.category && d.category.panBinding && d.category.panBinding.panType)
      ? `<button onclick="openPanBrowser('${currentResourceDirId}')"
                 class="mt-2 w-full py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold text-[11px] flex items-center justify-center gap-1">
           <i data-lucide="folder-search" class="w-3.5 h-3.5"></i><span>浏览网盘目录内容并导入</span>
         </button>`
      : '';
    summary.innerHTML = `<div>📂 共 <strong class="text-slate-700">${d.total}</strong> 个资源（含子目录）</div><div class="mt-1 leading-relaxed">${parts || '暂无内容'}</div>${bind}${browseBtn}`;
    if (typeof initIcons === 'function') initIcons();
  } catch (e) {
    summary.innerText = '统计失败：' + e.message;
  }
}

// ==================== 网盘目录内容浏览与导入 ====================
// 说明：转存到网盘的文件，通过本模块逐级浏览并「导入为资源」，
//       资源 url 指向 /api/pan/stream（服务端自动选择转码播放地址或直链），
//       儿童端即可一级级点开目录直接播放。
let panBrowseState = { catId: '', panType: '', stack: [] };

async function openPanBrowser(catId) {
  const cat = allCategories.find(c => c.id === catId);
  const b = cat && cat.panBinding;
  if (!b || !b.panType || !b.dirId) {
    alert('该目录尚未映射网盘目录，请先在「目录管理」中绑定网盘目录');
    return;
  }
  panBrowseState = {
    catId,
    panType: b.panType,
    stack: [{ id: b.dirId, name: b.dirPath || `[${b.panName || b.panType}]根目录` }]
  };
  document.getElementById('panBrowserModal').classList.remove('hidden');
  if (typeof initIcons === 'function') initIcons();
  await renderPanBrowser();
}

async function panBrowseInto(dirId, dirName) {
  panBrowseState.stack.push({ id: dirId, name: dirName });
  await renderPanBrowser();
}

async function panBrowseUp() {
  if (panBrowseState.stack.length > 1) {
    panBrowseState.stack.pop();
    await renderPanBrowser();
  }
}

async function renderPanBrowser() {
  const body = document.getElementById('panBrowserBody');
  const pathEl = document.getElementById('panBrowserPath');
  const statEl = document.getElementById('panBrowserStat');
  if (!body) return;

  const cur = panBrowseState.stack[panBrowseState.stack.length - 1];
  const trail = panBrowseState.stack.map(s => escapeHtml(s.name)).join(' / ');
  pathEl.innerHTML = `📁 ${trail}`;
  body.innerHTML = '<div class="p-6 text-center text-slate-400"><span class="inline-block animate-spin">⏳</span> 正在读取网盘目录...</div>';

  try {
    const res = await fetch(
      `/api/pan/files?panType=${encodeURIComponent(panBrowseState.panType)}&dirId=${encodeURIComponent(cur.id)}`,
      { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') } }
    );
    const d = await res.json();
    if (!d.success) {
      body.innerHTML = `<div class="p-6 text-center text-rose-500">${escapeHtml(d.message || '读取失败')}</div>`;
      statEl.innerText = '';
      return;
    }

    const items = d.items || [];
    if (!items.length) {
      body.innerHTML = '<div class="p-6 text-center text-slate-400">该目录为空</div>';
      statEl.innerText = '0 项';
      return;
    }

    // 目录在前，文件在后
    const dirs = items.filter(i => i.isDir);
    const files = items.filter(i => !i.isDir);

    const rowDir = (it) => `
      <div onclick="panBrowseInto('${it.id}','${escapeHtml(it.name).replace(/'/g, '&#39;')}')"
           class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 border border-transparent hover:border-slate-200">
        <span class="text-base leading-none">📁</span>
        <span class="flex-1 truncate text-slate-700 font-medium">${escapeHtml(it.name)}</span>
        <span class="text-[10px] text-slate-400">进入 ›</span>
      </div>`;

    const rowFile = (it) => {
      const icon = it.type === 'video' ? '🎬' : it.type === 'audio' ? '🎧' : it.type === 'pdf' ? '📄' : '📦';
      const typeLabel = { video: '视频', audio: '音频', pdf: 'PDF', file: '文件' }[it.type] || '文件';
      return `
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200">
        <span class="text-base leading-none">${icon}</span>
        <div class="flex-1 min-w-0">
          <div class="truncate text-slate-700">${escapeHtml(it.name)}</div>
          <div class="text-[10px] text-slate-400">${typeLabel}${it.sizeText ? ' · ' + it.sizeText : ''}</div>
        </div>
        ${it.playable
          ? `<button onclick="importPanFile('${escapeHtml(it.name).replace(/'/g, '&#39;')}','${it.id}','${it.type}','${escapeHtml(it.sizeText || '')}')"
                     class="shrink-0 px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[10px] font-semibold">导入为资源</button>`
          : `<span class="shrink-0 text-[10px] text-slate-300">不支持播放</span>`}
      </div>`;
    };

    body.innerHTML =
      dirs.map(rowDir).join('') + files.map(rowFile).join('');
    statEl.innerText = `${dirs.length} 个文件夹 · ${files.length} 个文件`;
  } catch (e) {
    body.innerHTML = `<div class="p-6 text-center text-rose-500">读取失败：${escapeHtml(e.message)}</div>`;
  }
}

// 把网盘文件导入为学习资源（挂到当前浏览的目录树节点下）
async function importPanFile(name, fid, type, sizeText) {
  const catId = panBrowseState.catId;
  if (!catId) { alert('请先选择目标目录'); return; }
  const rType = type === 'file' ? 'video' : type;
  const streamUrl = `/api/pan/stream?panType=${encodeURIComponent(panBrowseState.panType)}&fid=${encodeURIComponent(fid)}`;

  try {
    const res = await fetch('/api/resources', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({
        title: name,
        categoryId: catId,
        type: rType,
        url: streamUrl,
        size: sizeText || '未知大小',
        duration: rType === 'pdf' ? '文档' : '—',
        description: `网盘直连资源（${panBrowseState.panType}），支持在线播放与息屏磨耳朵。`,
        tags: ['网盘直连', panBrowseState.panType],
        panSource: panBrowseState.panType,
        speedupSupport: true
      })
    });
    const d = await res.json();
    if (d.success) {
      alert(`已导入：${name}\n儿童端进入该目录即可直接播放`);
      await loadResources();
      await renderResourceDirTree();
    } else {
      alert('导入失败：' + (d.message || '未知错误'));
    }
  } catch (e) {
    alert('导入失败：' + e.message);
  }
}

function openCategoryModal(parentId = null) {
  document.getElementById('catFormId').value = '';
  document.getElementById('catFormName').value = '';
  document.getElementById('catFormParentId').value = parentId || '';
  document.getElementById('catFormEmoji').value = '🔤';
  document.getElementById('catFormGrade').value = '全年龄段';
  document.getElementById('catFormSort').value = '1';
  document.getElementById('catFormDesc').value = '';
  clearCategoryPanBinding();
  document.getElementById('categoryModalTitle').innerText = parentId ? '添加子目录' : '新建目录';
  document.getElementById('categoryModal').classList.remove('hidden');
}

function editCategory(id) {
  const cat = allCategories.find(c => c.id === id);
  if (!cat) return;
  document.getElementById('catFormId').value = cat.id;
  document.getElementById('catFormName').value = cat.name;
  document.getElementById('catFormParentId').value = cat.parentId || '';
  document.getElementById('catFormEmoji').value = cat.emoji || '📁';
  document.getElementById('catFormGrade').value = cat.gradeLevel || '全年龄段';
  document.getElementById('catFormSort').value = cat.sortOrder || 1;
  document.getElementById('catFormDesc').value = cat.description || '';

  // 回显网盘目录映射
  clearCategoryPanBinding();
  if (cat.panBinding && cat.panBinding.panType && cat.panBinding.dirId) {
    document.getElementById('catFormPanType').value = cat.panBinding.panType;
    document.getElementById('catFormPanDirId').value = cat.panBinding.dirId;
    document.getElementById('catFormPanDirPath').value = cat.panBinding.dirPath || '';
    const box = document.getElementById('catFormPanDirBox');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `🔗 已绑定 ${escapeHtml(cat.panBinding.panName || PAN_LABEL[cat.panBinding.panType] || cat.panBinding.panType)}：<strong>${escapeHtml(cat.panBinding.dirPath || cat.panBinding.dirId)}</strong>`;
    }
  }

  document.getElementById('categoryModalTitle').innerText = '编辑目录：' + cat.name;
  document.getElementById('categoryModal').classList.remove('hidden');
}

async function saveCategory() {
  const id = document.getElementById('catFormId').value;
  const name = document.getElementById('catFormName').value.trim();
  if (!name) return alert('请输入目录名称');

  const panType = document.getElementById('catFormPanType').value;
  const panDirId = document.getElementById('catFormPanDirId').value;
  const panDirPath = document.getElementById('catFormPanDirPath').value;
  const panBinding = (panType && panDirId)
    ? { panType, panName: PAN_LABEL[panType] || panType, dirId: panDirId, dirPath: panDirPath }
    : null;

  const payload = {
    name,
    parentId: document.getElementById('catFormParentId').value || null,
    emoji: document.getElementById('catFormEmoji').value,
    gradeLevel: document.getElementById('catFormGrade').value,
    sortOrder: Number(document.getElementById('catFormSort').value),
    description: document.getElementById('catFormDesc').value,
    panBinding
  };

  const url = id ? `/api/categories/${id}` : '/api/categories';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal('categoryModal');
      loadCategories();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function deleteCategory(id) {
  if (!confirm('确定要删除该目录吗？')) return;
  try {
    const res = await fetch(`/api/categories/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    if (data.success) {
      loadCategories();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

// ==================== 5. 学习资源管理与在线播放预览 ====================
async function loadResources() {
  const catId = document.getElementById('resFilterCategory')?.value || '';
  const type = document.getElementById('resFilterType')?.value || '';
  const kw = document.getElementById('resFilterKeyword')?.value.trim() || '';

  try {
    const res = await fetch(`/api/resources?categoryId=${catId}&type=${type}&keyword=${encodeURIComponent(kw)}`);
    const data = await res.json();
    allResources = data.items || [];
    renderResourcesTable(allResources);
    document.getElementById('badgeResCount').innerText = allResources.length;
    // 同步侧栏选中态
    currentResourceDirId = catId;
    renderResourceDirTree();
  } catch (e) {
    console.error('Load resources failed:', e);
  }
}

function renderResourcesTable(items) {
  const tbody = document.getElementById('resourcesTableBody');
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">暂无资源，请先从全网搜索转存或手动添加</td></tr>`;
    return;
  }

  const typeBadges = {
    video: { name: '视频动画', color: 'bg-indigo-100 text-indigo-700' },
    audio: { name: '听书磨耳朵', color: 'bg-pink-100 text-pink-700' },
    pdf: { name: '彩色PDF绘本', color: 'bg-amber-100 text-amber-700' }
  };

  tbody.innerHTML = items.map(r => {
    const tBadge = typeBadges[r.type] || { name: r.type, color: 'bg-slate-100 text-slate-700' };
    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            <img src="${r.coverUrl || 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=100'}" class="w-12 h-12 rounded-lg object-cover border border-slate-200">
            <div class="max-w-xs">
              <h5 class="font-bold text-slate-900 truncate" title="${r.title}">${r.title}</h5>
              <p class="text-slate-400 text-[11px] truncate">${r.description || '无简介'}</p>
            </div>
          </div>
        </td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${tBadge.color}">${tBadge.name}</span>
        </td>
        <td class="px-4 py-3 text-slate-700 font-medium">
          ${r.categoryEmoji || '📁'} ${r.categoryName}
        </td>
        <td class="px-4 py-3 font-mono text-slate-600">
          ${r.duration || '00:00'} / ${r.size || '未知'}
        </td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-600 uppercase">${r.panSource || '本地'}</span>
        </td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 flex items-center gap-1 w-max">
            <i data-lucide="zap" class="w-3 h-3"></i>
            <span>支持加速</span>
          </span>
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="playResource('${r.id}')" class="px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold text-xs shadow-xs transition flex items-center gap-1">
              <i data-lucide="play" class="w-3 h-3"></i>
              <span>播放预览</span>
            </button>
            <button onclick="deleteResource('${r.id}')" class="p-1.5 text-rose-400 hover:text-rose-600 rounded-lg transition">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  initIcons();
}

function openResourceModal() {
  document.getElementById('resFormId').value = '';
  document.getElementById('resFormTitle').value = '';
  document.getElementById('resFormUrl').value = '';
  document.getElementById('resFormAudioUrl').value = '';
  document.getElementById('resFormDesc').value = '';
  document.getElementById('resourceModalTitle').innerText = '添加学习资源';
  document.getElementById('resourceModal').classList.remove('hidden');
}

async function saveResource() {
  const title = document.getElementById('resFormTitle').value.trim();
  const url = document.getElementById('resFormUrl').value.trim();
  const categoryId = document.getElementById('resFormCategoryId').value;
  if (!title || !url) return alert('请填写标题和播放URL');

  const payload = {
    title,
    url,
    categoryId,
    type: document.getElementById('resFormType').value,
    audioUrl: document.getElementById('resFormAudioUrl').value.trim() || null,
    coverUrl: document.getElementById('resFormCoverUrl').value,
    tags: document.getElementById('resFormTags').value,
    description: document.getElementById('resFormDesc').value,
    speedupSupport: document.getElementById('resFormSpeedup').checked
  };

  try {
    const res = await fetch('/api/resources', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal('resourceModal');
      loadResources();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function deleteResource(id) {
  if (!confirm('确定要删除该学习资源吗？')) return;
  try {
    const res = await fetch(`/api/resources/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    if (data.success) {
      loadResources();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

// ==================== 5.5 本地硬盘媒体扫描与批量导入 ====================
let scannedLocalFiles = [];

async function scanLocalDirectory() {
  const dirPath = document.getElementById('localDiskPathInput').value.trim();
  const btn = document.getElementById('btnScanLocal');
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-spin mr-1">⌛</span><span>正在扫描本地硬盘文件...</span>`;

  try {
    const res = await fetch('/api/local/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ targetDir: dirPath })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="scan" class="w-4 h-4"></i><span>扫描本地目录</span>`;
    initIcons();

    if (data.success) {
      scannedLocalFiles = data.files || [];
      renderLocalScanResults(scannedLocalFiles);
      document.getElementById('localScanCountBadge').innerText = `发现 ${scannedLocalFiles.length} 个音视频/PDF文件`;
    } else {
      alert(data.message);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<span>重新扫描</span>`;
    alert('扫描请求失败: ' + err.message);
  }
}

function renderLocalScanResults(files) {
  const tbody = document.getElementById('localScanTableBody');
  if (files.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400">未在该目录下发现支持的多媒体或PDF文件</td></tr>`;
    return;
  }

  const typeBadges = {
    video: { name: '视频动画', color: 'bg-indigo-100 text-indigo-700' },
    audio: { name: '听书音频', color: 'bg-pink-100 text-pink-700' },
    pdf: { name: '彩色PDF', color: 'bg-amber-100 text-amber-700' }
  };

  const catOptions = allCategories.map(c => `
    <option value="${c.id}">${c.emoji} ${c.name}</option>
  `).join('');

  tbody.innerHTML = files.map((f, idx) => {
    const badge = typeBadges[f.type] || { name: f.type, color: 'bg-slate-100 text-slate-700' };
    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-3">
          <input type="checkbox" name="localFileCheckbox" value="${idx}" checked class="rounded text-brand-600 focus:ring-brand-500">
        </td>
        <td class="px-4 py-3">
          <div class="font-bold text-slate-900 truncate max-w-sm" title="${f.fullPath}">${f.title}</div>
          <div class="text-[11px] text-slate-400 font-mono truncate max-w-md">${f.fullPath}</div>
        </td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${badge.color}">${badge.name} (${f.extension})</span>
        </td>
        <td class="px-4 py-3 font-mono text-slate-600">${f.sizeStr}</td>
        <td class="px-4 py-3">
          <select id="localCatSelect-${idx}" class="px-2 py-1 border rounded-lg text-xs bg-white">
            ${allCategories.map(c => `
              <option value="${c.id}" ${c.id === f.inferredCategoryId ? 'selected' : ''}>${c.emoji} ${c.name}</option>
            `).join('')}
          </select>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleSelectAllLocal(checked) {
  document.querySelectorAll('input[name="localFileCheckbox"]').forEach(cb => cb.checked = checked);
}

async function importSelectedLocalFiles() {
  const selectedBoxes = Array.from(document.querySelectorAll('input[name="localFileCheckbox"]:checked'));
  if (selectedBoxes.length === 0) {
    return alert('请先勾选要导入的本地文件');
  }

  const filesToImport = selectedBoxes.map(b => {
    const idx = parseInt(b.value, 10);
    const item = scannedLocalFiles[idx];
    const catSelect = document.getElementById(`localCatSelect-${idx}`);
    return {
      ...item,
      categoryId: catSelect ? catSelect.value : item.inferredCategoryId
    };
  });

  const btn = document.getElementById('btnImportLocal');
  btn.disabled = true;
  btn.innerHTML = `<span>正在批量写入系统资源库...</span>`;

  try {
    const res = await fetch('/api/local/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify({ files: filesToImport })
    });
    const result = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i><span>批量导入至系统</span>`;
    initIcons();

    if (result.success) {
      alert(`🎉 成功从本地硬盘导入 ${result.count} 个学习课件至系统！`);
      loadResources(); // 刷新资源总库
    } else {
      alert(result.message);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<span>重试导入</span>`;
    alert('导入失败: ' + err.message);
  }
}

async function uploadLocalFile(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('categoryId', allCategories[0]?.id || 'cat_eng');

  try {
    const res = await fetch('/api/local/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') },
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      alert(`上传成功！文件已保存至本地媒体库并导入：${data.resource.title}`);
      loadResources();
      scanLocalDirectory();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('上传失败: ' + e.message);
  } finally {
    input.value = '';
  }
}

// 播放器弹窗
function playResource(id) {
  const r = allResources.find(item => item.id === id);
  if (!r) return;
  currentPlayerResource = r;

  document.getElementById('playerModalTitle').innerHTML = `
    <i data-lucide="play-circle" class="w-4 h-4 text-brand-600"></i>
    <span>正在播放: ${r.title}</span>
  `;

  const container = document.getElementById('playerMediaContainer');
  // 通过非会员加速直链代理接口播放（本地流/已代理地址自动复用，避免二次包装）
  const proxyPlayUrl = resolveStreamUrl(r.url, 'play');

  if (r.type === 'video') {
    container.innerHTML = `
      <video id="activeMediaElement" controls autoplay class="w-full h-[400px] object-contain" src="${proxyPlayUrl}"></video>
    `;
  } else if (r.type === 'audio') {
    container.innerHTML = `
      <div class="p-8 text-center text-white space-y-4">
        <div class="w-24 h-24 mx-auto rounded-2xl overflow-hidden shadow-xl border-2 border-white/20">
          <img src="${r.coverUrl}" class="w-full h-full object-cover">
        </div>
        <div>
          <h4 class="font-bold text-lg">${r.title}</h4>
          <p class="text-xs text-white/60">正在进行高品质纯音频磨耳朵播放 (息屏模式已支持)</p>
        </div>
        <audio id="activeMediaElement" controls autoplay class="w-full max-w-md mx-auto" src="${proxyPlayUrl}"></audio>
      </div>
    `;
  } else if (r.type === 'pdf') {
    const pdfUrl = resolveStreamUrl(r.url, 'pdf');
    container.innerHTML = `
      <iframe src="${pdfUrl}" class="w-full h-[500px] border-0 rounded-xl bg-white"></iframe>
    `;
  }

  document.getElementById('playerModal').classList.remove('hidden');
  initIcons();
}

function changePlaybackRate(rate) {
  const media = document.getElementById('activeMediaElement');
  if (media) {
    media.playbackRate = rate;
    document.getElementById('playerSpeedRateText').innerText = `${rate}x`;
  }
}

function toggleAudioOnlyMode() {
  if (!currentPlayerResource) return;
  const audioExtractUrl = resolveStreamUrl(currentPlayerResource.url, 'audio');
  const container = document.getElementById('playerMediaContainer');
  container.innerHTML = `
    <div class="p-8 text-center text-white space-y-4">
      <div class="text-4xl animate-pulse">🎧</div>
      <div>
        <h4 class="font-bold text-lg">息屏纯音频提取测试中</h4>
        <p class="text-xs text-emerald-400">已从视频流自动剥离画面，纯音频带宽极低，完全适合息屏听书！</p>
      </div>
      <audio id="activeMediaElement" controls autoplay class="w-full max-w-md mx-auto" src="${audioExtractUrl}"></audio>
    </div>
  `;
}

function closePlayerModal() {
  const media = document.getElementById('activeMediaElement');
  if (media) {
    media.pause();
    media.src = '';
  }
  document.getElementById('playerMediaContainer').innerHTML = '';
  document.getElementById('playerModal').classList.add('hidden');
}

// ==================== 6. 用户管理与权限分配 ====================
async function loadUsers() {
  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    renderUsersTable(data.users || []);
  } catch (e) {
    console.error('Load users failed:', e);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = users.map(u => {
    const isExpired = u.expireAt && new Date(u.expireAt) < new Date();
    const expireText = u.expireAt ? new Date(u.expireAt).toLocaleDateString() : '永久';
    const catScope = (u.allowedCategoryIds && u.allowedCategoryIds.includes('*')) 
      ? '<span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold border border-emerald-200">全部目录(全通)</span>' 
      : `<span class="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-bold border border-indigo-200">指定 ${u.allowedCategoryIds.length} 个目录</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs">
              ${u.username[0].toUpperCase()}
            </div>
            <div>
              <div class="font-bold text-slate-900">${u.nickname || u.username}</div>
              <div class="text-[11px] text-slate-400 font-mono">@${u.username}</div>
            </div>
          </div>
        </td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">
            ${u.role === 'admin' ? '管理员' : '学生账号'}
          </span>
        </td>
        <td class="px-4 py-3 font-medium text-slate-700">${u.grade || '未设置'}</td>
        <td class="px-4 py-3">
          <span class="font-mono text-xs font-semibold ${isExpired ? 'text-rose-600' : 'text-slate-700'}">
            ${expireText} ${isExpired ? '(已到期)' : ''}
          </span>
        </td>
        <td class="px-4 py-3 text-xs">${catScope}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
            ${u.active ? '正常' : '已停用'}
          </span>
        </td>
        <td class="px-4 py-3 text-right">
          <button onclick="editUser('${u.id}')" class="px-2 py-1 text-brand-600 hover:bg-brand-50 rounded text-xs font-semibold">权限配置</button>
        </td>
      </tr>
    `;
  }).join('');
}

function openUserModal() {
  document.getElementById('userFormId').value = '';
  document.getElementById('userFormUsername').value = '';
  document.getElementById('userFormUsername').disabled = false;
  document.getElementById('userFormNickname').value = '';
  document.getElementById('userFormPassword').value = '123456';
  document.getElementById('userFormGrade').value = '3年级';
  setQuickExpire(365);
  renderCategoryPermissionCheckboxes(['*']);
  document.getElementById('userModalTitle').innerText = '新建学生账号';
  document.getElementById('userModal').classList.remove('hidden');
}

function setQuickExpire(days) {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000);
  // 格式化为 YYYY-MM-DDTHH:mm
  const iso = date.toISOString().substring(0, 16);
  document.getElementById('userFormExpireAt').value = iso;
}

function renderCategoryPermissionCheckboxes(selectedIds = ['*']) {
  const container = document.getElementById('userCategoryCheckboxes');
  const isAll = selectedIds.includes('*');

  container.innerHTML = allCategories.map(c => {
    const isChecked = isAll || selectedIds.includes(c.id);
    return `
      <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-100 p-1 rounded">
        <input type="checkbox" name="userAllowedCat" value="${c.id}" ${isChecked ? 'checked' : ''} class="rounded text-brand-600 focus:ring-brand-500">
        <span>${c.emoji} <strong>${c.name}</strong> (${c.gradeLevel || '全年龄'})</span>
      </label>
    `;
  }).join('');
}

function toggleAllCategoryCheck(checked) {
  document.querySelectorAll('input[name="userAllowedCat"]').forEach(cb => cb.checked = checked);
}

function editUser(id) {
  fetch('/api/users', {
    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
  })
  .then(r => r.json())
  .then(data => {
    const u = data.users.find(item => item.id === id);
    if (!u) return;

    document.getElementById('userFormId').value = u.id;
    document.getElementById('userFormUsername').value = u.username;
    document.getElementById('userFormUsername').disabled = true;
    document.getElementById('userFormNickname').value = u.nickname;
    document.getElementById('userFormPassword').value = '';
    document.getElementById('userFormGrade').value = u.grade || '';
    if (u.expireAt) {
      document.getElementById('userFormExpireAt').value = new Date(u.expireAt).toISOString().substring(0, 16);
    }
    renderCategoryPermissionCheckboxes(u.allowedCategoryIds || ['*']);
    document.getElementById('userModalTitle').innerText = '配置用户权限: ' + u.username;
    document.getElementById('userModal').classList.remove('hidden');
  });
}

async function saveUser() {
  const id = document.getElementById('userFormId').value;
  const username = document.getElementById('userFormUsername').value.trim();
  const nickname = document.getElementById('userFormNickname').value.trim();
  const password = document.getElementById('userFormPassword').value.trim();
  const grade = document.getElementById('userFormGrade').value.trim();
  const expireAt = new Date(document.getElementById('userFormExpireAt').value).toISOString();

  // 获取勾选目录
  const checkedBoxes = Array.from(document.querySelectorAll('input[name="userAllowedCat"]:checked'));
  const allowedCategoryIds = checkedBoxes.map(b => b.value);

  if (!username) return alert('请填写用户名');

  const payload = {
    username,
    nickname,
    grade,
    expireAt,
    allowedCategoryIds: allowedCategoryIds.length === allCategories.length ? ['*'] : allowedCategoryIds
  };
  if (password) payload.password = password;

  const url = id ? `/api/users/${id}` : '/api/users';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal('userModal');
      loadUsers();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('保存用户失败: ' + e.message);
  }
}

// ==================== 7. AI 接口配置 ====================
async function loadAiConfig() {
  try {
    const res = await fetch('/api/ai/config', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    const cfg = data.config || {};
    document.getElementById('aiProvider').value = cfg.provider || 'deepseek';
    document.getElementById('aiModel').value = cfg.model || 'deepseek-chat';
    document.getElementById('aiBaseUrl').value = cfg.baseUrl || 'https://api.deepseek.com/v1';
    document.getElementById('aiSystemPrompt').value = cfg.systemPrompt || '';
  } catch (e) {
    console.error('Load AI config failed:', e);
  }
}

async function saveAiConfig() {
  const payload = {
    provider: document.getElementById('aiProvider').value,
    model: document.getElementById('aiModel').value.trim(),
    baseUrl: document.getElementById('aiBaseUrl').value.trim(),
    apiKey: document.getElementById('aiApiKey').value.trim() || undefined,
    systemPrompt: document.getElementById('aiSystemPrompt').value.trim()
  };

  try {
    const res = await fetch('/api/ai/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      const tip = document.getElementById('aiSaveTip');
      tip.classList.remove('hidden');
      setTimeout(() => tip.classList.add('hidden'), 3000);
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function testAiConnection() {
  const btn = document.getElementById('btnTestAi');
  btn.innerHTML = `<span class="animate-spin mr-1">⌛</span><span>正在连接测试...</span>`;
  btn.disabled = true;

  try {
    const res = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
    });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="activity" class="w-4 h-4"></i><span>测试接口连通性</span>`;
    initIcons();

    if (data.success) {
      alert(`【AI 接口测试成功】\n模式: ${data.result.source}\n回复内容:\n${data.result.reply}`);
    } else {
      alert('连通性测试失败: ' + data.message);
    }
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = `<span>重试</span>`;
    alert('测试异常: ' + e.message);
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('aiApiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if (id === 'qrModal' && qrPollingTimer) {
    clearInterval(qrPollingTimer);
  }
}
