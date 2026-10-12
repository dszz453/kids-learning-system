// 智学小鹿 - 儿童手机端 / PWA 核心交互逻辑与全能播放器引擎
let categoriesTree = [];
let allCategoriesList = [];
let allResourcesList = [];
let currentParentId = null;
let currentTypeFilter = '';
let currentPlayingResource = null;
let isAudioOnlyMode = false;
let currentPlaybackRate = 1.0;

// 全局音频/视频播放器元素引用
let activeMediaEl = null;
// 当前登录的小朋友用户
let currentKidUser = null;

document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  setupMediaSessionHandlers();
  loadAppVersion(); // 拉取并展示线上真实版本号
  initKidAuth(); // 优先进行账号登录校验
});

// 版本号展示：唯一来源为服务端 package.json，经 /api/version 下发
async function loadAppVersion() {
  try {
    const r = await fetch('/api/version');
    const d = await r.json();
    if (!d || !d.success) return;
    const badge = document.getElementById('appVersionBadge');
    if (badge) badge.innerText = d.version;
    document.querySelectorAll('.appVersionText').forEach(el => { el.innerText = d.version; });
  } catch (e) {
    // 版本号展示失败不影响主流程
  }
}

// ==================== 0.1 播放地址统一解析 ====================
// 本地文件流 / 已代理地址直接复用，避免二次包装导致语义丢失（如息屏纯音频模式失效）
function resolveStreamUrl(rawUrl, mode) {
  const u = String(rawUrl || '');
  if (u.startsWith('/api/stream/local')) {
    const sep = u.includes('?') ? '&' : '?';
    return mode === 'audio' ? `${u}${sep}audioOnly=true` : u;
  }
  // 网盘资源（转存后直接播放）：服务端已按类型自动选择转码播放/直链
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

// ==================== 0. 儿童端账号登录与权限控制 ====================
function getKidToken() {
  return localStorage.getItem('kidToken') || localStorage.getItem('token') || '';
}

async function initKidAuth() {
  const token = getKidToken();
  if (!token) {
    showKidLoginModal(false);
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentKidUser = data.user;
      hideKidLoginModal();
      applyKidUserProfile();
      loadKidsCategories();
      loadKidsResources();
    } else {
      localStorage.removeItem('kidToken');
      showKidLoginModal(false);
    }
  } catch (err) {
    console.warn('儿童端身份校验异常:', err);
    showKidLoginModal(false);
  }
}

function applyKidUserProfile() {
  const greet = document.getElementById('kidGreetingText');
  if (greet && currentKidUser) {
    const name = currentKidUser.nickname || currentKidUser.username;
    const grade = currentKidUser.grade || '';
    // 昵称中已包含年级或括号说明时不再重复追加
    const needGrade = grade && !name.includes(grade) && !/[（(]/.test(name);
    greet.innerText = needGrade ? `${name} (${grade})` : name;
  }
  // 更新 AI 聊天欢迎语中的称呼
  const welcome = document.getElementById('aiWelcomeName');
  if (welcome && currentKidUser) {
    welcome.innerText = currentKidUser.nickname || currentKidUser.username;
  }
}

function showKidLoginModal(isSwitching) {
  const modal = document.getElementById('kidLoginModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const errBox = document.getElementById('kidLoginErrorMsg');
  if (errBox) errBox.classList.add('hidden');
  const logoutBtn = document.getElementById('btnKidLogoutInline');
  if (logoutBtn) {
    if (isSwitching && currentKidUser) {
      logoutBtn.classList.remove('hidden');
    } else {
      logoutBtn.classList.add('hidden');
    }
  }
  initIcons();
}

function hideKidLoginModal() {
  const modal = document.getElementById('kidLoginModal');
  if (modal) modal.classList.add('hidden');
}

function openKidLoginModal() {
  showKidLoginModal(true);
}

function fillKidCredentials(username, password) {
  const uInput = document.getElementById('kidLoginUsername');
  const pInput = document.getElementById('kidLoginPassword');
  if (uInput) uInput.value = username;
  if (pInput) pInput.value = password;
}

async function handleKidLogin() {
  const username = (document.getElementById('kidLoginUsername').value || '').trim();
  const password = (document.getElementById('kidLoginPassword').value || '').trim();
  const errBox = document.getElementById('kidLoginErrorMsg');
  const btn = document.getElementById('btnKidLoginSubmit');

  if (!username || !password) {
    if (errBox) {
      errBox.innerText = '请输入小朋友账号和密码哦～';
      errBox.classList.remove('hidden');
    }
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block animate-spin">⌛</span><span>正在进入乐园...</span>`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem('kidToken', data.token);
      currentKidUser = data.user;
      hideKidLoginModal();
      applyKidUserProfile();
      loadKidsCategories();
      loadKidsResources();
    } else {
      if (errBox) {
        errBox.innerText = data.message || '账号或密码不正确，请再试一次～';
        errBox.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.innerText = '网络开小差了: ' + err.message;
      errBox.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="rocket" class="w-4 h-4"></i><span>开 始 学 习</span>`;
    initIcons();
  }
}

function handleKidLogout() {
  if (!confirm('确定要退出当前小朋友的账号吗？')) return;
  localStorage.removeItem('kidToken');
  currentKidUser = null;
  const uInput = document.getElementById('kidLoginUsername');
  const pInput = document.getElementById('kidLoginPassword');
  if (uInput) uInput.value = '';
  if (pInput) pInput.value = '';
  const greet = document.getElementById('kidGreetingText');
  if (greet) greet.innerText = '请先登录';
  // 清空当前展示内容
  const grid = document.getElementById('primaryModulesGrid');
  if (grid) grid.innerHTML = '';
  const resContainer = document.getElementById('kidsResourcesContainer');
  if (resContainer) resContainer.innerHTML = '';
  showKidLoginModal(false);
}

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ==================== 1. 分类目录与层级浏览 (与后台资源树严格对照) ====================
async function loadKidsCategories() {
  try {
    const token = getKidToken();
    const res = await fetch('/api/categories/tree', {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    const data = await res.json();
    categoriesTree = data.tree || [];
    allCategoriesList = data.list || [];

    // 按当前用户权限过滤可见目录
    if (currentKidUser && Array.isArray(currentKidUser.allowedCategoryIds)
        && !currentKidUser.allowedCategoryIds.includes('*')) {
      const allowed = new Set(currentKidUser.allowedCategoryIds);
      // 收集允许的一级目录及其所有子孙目录 id
      const allowedSet = new Set();
      const collectDescendants = (node) => {
        if (allowed.has(node.id)) {
          const walk = (n) => { allowedSet.add(n.id); (n.children || []).forEach(walk); };
          walk(node);
        } else {
          (node.children || []).forEach(collectDescendants);
        }
      };
      categoriesTree.forEach(collectDescendants);

      const filterTree = (nodes) => nodes
        .filter(n => allowedSet.has(n.id))
        .map(n => ({ ...n, children: filterTree(n.children || []) }));

      categoriesTree = filterTree(categoriesTree);
      allCategoriesList = allCategoriesList.filter(c => allowedSet.has(c.id));
    }

    renderPrimaryModules();
  } catch (err) {
    console.error('加载分类目录失败:', err);
  }
}

// 渲染一级大分类模块 (儿童生动大图标卡片)
function renderPrimaryModules() {
  const container = document.getElementById('primaryModulesGrid');
  const primaryNodes = categoriesTree;

  // 卡通渐变背景与图标风格
  const stylePresets = [
    { gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20', text: 'text-white' },
    { gradient: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/20', text: 'text-white' },
    { gradient: 'from-pink-500 to-rose-500', shadow: 'shadow-pink-500/20', text: 'text-white' },
    { gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/20', text: 'text-white' },
  ];

  container.innerHTML = primaryNodes.map((cat, idx) => {
    const style = stylePresets[idx % stylePresets.length];
    return `
      <div onclick="enterCategory('${cat.id}')" 
           class="bg-gradient-to-tr ${style.gradient} rounded-3xl p-4 text-white shadow-lg ${style.shadow} cursor-pointer kid-card-bounce flex flex-col justify-between h-32 relative overflow-hidden">
        <div class="absolute -right-2 -bottom-2 opacity-15 text-6xl pointer-events-none">
          ${cat.emoji || '📁'}
        </div>
        <div class="flex items-center justify-between">
          <span class="text-2xl">${cat.emoji || '📁'}</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md font-bold">${cat.gradeLevel || '全年龄'}</span>
        </div>
        <div>
          <h4 class="font-extrabold text-base tracking-tight">${cat.name}</h4>
          <p class="text-[11px] text-white/80 line-clamp-1">${cat.description || '点击探索专区'}</p>
        </div>
      </div>
    `;
  }).join('');
}

// ==================== 多级目录导航（支持任意层级下钻） ====================
// 导航路径栈: [{id, name}]
let navPath = [];

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 收集某目录及其所有子孙目录 id
function collectSubtreeIds(catId) {
  const ids = new Set([catId]);
  const walk = (pid) => {
    allCategoriesList.filter(c => c.parentId === pid).forEach(c => {
      if (!ids.has(c.id)) { ids.add(c.id); walk(c.id); }
    });
  };
  walk(catId);
  return ids;
}

// 统计某目录（含所有子孙）下的资源数量（基于后端返回的 resourceCount 累加）
function countSubtreeResources(catId) {
  const ids = collectSubtreeIds(catId);
  return allCategoriesList
    .filter(c => ids.has(c.id))
    .reduce((sum, c) => sum + (c.resourceCount || 0), 0);
}

// 进入某一目录（支持任意层级下钻）
function enterCategory(catId) {
  const cat = allCategoriesList.find(c => c.id === catId);
  if (!cat) return;

  const last = navPath[navPath.length - 1];
  if (!last || last.id !== catId) {
    navPath.push({ id: catId, name: cat.name });
  }
  renderNavLevel(catId);
}

// 渲染指定层级的子目录与资源
function renderNavLevel(catId) {
  const cat = allCategoriesList.find(c => c.id === catId);
  if (!cat) return;

  currentParentId = catId;
  renderBreadcrumb();

  const children = allCategoriesList.filter(c => c.parentId === catId);
  const topSec = document.getElementById('topModulesSection');
  const subSec = document.getElementById('subCategoriesSection');

  topSec.classList.add('hidden');

  if (children.length > 0) {
    subSec.classList.remove('hidden');
    document.getElementById('subCatTitle').innerText = `📂 ${cat.name} · 子目录`;
    document.getElementById('subCatCountTip').innerText = `共 ${children.length} 个分类`;

    const subGrid = document.getElementById('subCategoriesGrid');
    subGrid.innerHTML = children.map(sub => {
      const subChildren = allCategoriesList.filter(c => c.parentId === sub.id);
      const count = countSubtreeResources(sub.id);
      const isLeaf = subChildren.length === 0;
      return `
        <div onclick="enterCategory('${sub.id}')"
             class="bg-white rounded-2xl p-3.5 border-2 border-indigo-100 hover:border-brand-500 shadow-sm cursor-pointer kid-card-bounce flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0" style="background-color: ${sub.bgColor || '#EEF2FF'}">
            ${sub.emoji || (isLeaf ? '📘' : '📂')}
          </div>
          <div class="min-w-0 flex-1">
            <h5 class="font-bold text-slate-900 text-xs truncate">${escapeHtml(sub.name)}</h5>
            <span class="text-[10px] ${isLeaf ? 'text-brand-600' : 'text-indigo-500'} font-semibold">
              ${isLeaf ? `${count} 个课件` : `${subChildren.length} 个子目录`}
            </span>
          </div>
          <span class="text-slate-300 text-lg leading-none">›</span>
        </div>
      `;
    }).join('');
  } else {
    // 已到最下级目录，直接展示该目录下的资源
    subSec.classList.add('hidden');
  }

  document.getElementById('resourceListTitle').innerHTML = `<span>🎯 ${escapeHtml(cat.name)} 资源</span>`;
  loadKidsResources(catId);
}

// 渲染多级面包屑路径
function renderBreadcrumb() {
  const bar = document.getElementById('breadcrumbBar');
  const pathEl = document.getElementById('breadcrumbPath');
  if (navPath.length === 0) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  const parts = ['<span class="text-brand-600 font-bold cursor-pointer hover:underline flex-shrink-0" onclick="goBackToHome()">🏠 首页</span>'];
  navPath.forEach((n, i) => {
    const isLast = i === navPath.length - 1;
    if (isLast) {
      parts.push(`<span class="text-slate-900 font-bold truncate">${escapeHtml(n.name)}</span>`);
    } else {
      parts.push(`<span class="text-brand-600 font-medium cursor-pointer hover:underline truncate" onclick="jumpToNavLevel(${i})">${escapeHtml(n.name)}</span>`);
      parts.push('<span class="text-slate-300 flex-shrink-0">/</span>');
    }
  });
  pathEl.innerHTML = parts.join('');

  const upBtn = document.getElementById('btnUpOneLevel');
  if (upBtn) upBtn.classList.toggle('hidden', navPath.length <= 1);
}

// 返回上一级目录
function goUpOneLevel() {
  if (navPath.length === 0) return;
  navPath.pop();
  if (navPath.length === 0) {
    goBackToHome();
  } else {
    renderNavLevel(navPath[navPath.length - 1].id);
  }
}

// 点击面包屑跳转到指定层级
function jumpToNavLevel(idx) {
  navPath = navPath.slice(0, idx + 1);
  renderNavLevel(navPath[idx].id);
}

// 返回首页大模块
function goBackToHome() {
  navPath = [];
  currentParentId = null;
  document.getElementById('breadcrumbBar').classList.add('hidden');
  document.getElementById('topModulesSection').classList.remove('hidden');
  document.getElementById('subCategoriesSection').classList.add('hidden');
  document.getElementById('resourceListTitle').innerHTML = `<span>🎯 今日精选推荐课程</span>`;
  loadKidsResources();
}

// 兼容旧调用：直接定位到某分类
function selectCategoryFilter(catId, catName) {
  const cat = allCategoriesList.find(c => c.id === catId);
  if (cat) {
    enterCategory(catId);
  }
}

// ==================== 2. 学习资源加载与渲染 ====================
async function loadKidsResources(categoryId = null, keyword = '') {
  const container = document.getElementById('kidsResourcesContainer');
  container.innerHTML = `
    <div class="p-8 text-center text-slate-400">
      <div class="inline-block animate-spin text-2xl mb-2">⏳</div>
      <p class="text-xs">小鹿正在为您准备精品课件...</p>
    </div>
  `;

  try {
    let url = `/api/resources?`;
    if (categoryId) url += `categoryId=${categoryId}&`;
    if (currentTypeFilter) url += `type=${currentTypeFilter}&`;
    if (keyword) url += `keyword=${encodeURIComponent(keyword)}&`;

    const res = await fetch(url);
    const data = await res.json();
    allResourcesList = data.items || [];

    // 按当前用户目录权限做二次过滤，确保孩子只能看到授权目录下的资源
    if (currentKidUser && Array.isArray(currentKidUser.allowedCategoryIds)
        && !currentKidUser.allowedCategoryIds.includes('*')) {
      const visibleIds = new Set(allCategoriesList.map(c => c.id));
      allResourcesList = allResourcesList.filter(r => visibleIds.has(r.categoryId));
    }

    renderKidsResources(allResourcesList);
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-rose-500 text-xs">加载失败：${err.message}</div>`;
  }
}

function filterKidsType(type) {
  currentTypeFilter = type;
  document.querySelectorAll('.res-type-btn').forEach(btn => {
    btn.classList.remove('bg-brand-600', 'text-white');
    btn.classList.add('bg-white', 'text-slate-600', 'border');
  });
  event.target.classList.add('bg-brand-600', 'text-white');
  event.target.classList.remove('bg-white', 'text-slate-600', 'border');
  loadKidsResources(currentParentId);
}

function renderKidsResources(resources) {
  const container = document.getElementById('kidsResourcesContainer');
  if (resources.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-3xl p-8 text-center border border-indigo-100 shadow-sm space-y-2">
        <div class="text-4xl">🧸</div>
        <h4 class="font-bold text-slate-700 text-sm">暂无匹配的学习资源</h4>
        <p class="text-xs text-slate-400">试试问问右上角的 AI 伴学导师「智学小鹿」吧！</p>
      </div>
    `;
    return;
  }

  const typeConfig = {
    video: { name: '高清动画', tagColor: 'bg-indigo-100 text-indigo-700', action: '观看视频', icon: 'play' },
    audio: { name: '磨耳朵听书', tagColor: 'bg-pink-100 text-pink-700', action: '息屏收听', icon: 'headphones' },
    pdf: { name: '彩色绘本', tagColor: 'bg-amber-100 text-amber-700', action: '阅读教材', icon: 'book-open' }
  };

  container.innerHTML = resources.map(item => {
    const conf = typeConfig[item.type] || { name: item.type, tagColor: 'bg-slate-100 text-slate-700', action: '打开', icon: 'play' };
    return `
      <div onclick="playKidsResource('${item.id}')" 
           class="bg-white rounded-3xl p-3.5 border-2 border-slate-100 hover:border-brand-300 shadow-sm transition flex gap-3.5 cursor-pointer kid-card-bounce">
        <div class="relative w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 shadow-md">
          <img src="${item.coverUrl}" class="w-full h-full object-cover">
          <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-lg text-[9px] font-bold ${conf.tagColor}">
            ${conf.name}
          </span>
          <span class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[9px] font-mono">
            ${item.duration || '00:00'}
          </span>
        </div>

        <div class="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <div class="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium mb-0.5">
              <span>${item.categoryEmoji || '📁'}</span>
              <span class="truncate">${item.categoryName}</span>
            </div>
            <h4 class="font-extrabold text-slate-900 text-xs leading-snug line-clamp-2" title="${item.title}">
              ${item.title}
            </h4>
          </div>

          <div class="flex items-center justify-between pt-1">
            <span class="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
              <i data-lucide="zap" class="w-3 h-3"></i>
              <span>极速免会员</span>
            </span>

            <button class="px-3 py-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-bold shadow-sm shadow-brand-500/20 flex items-center gap-1">
              <i data-lucide="${conf.icon}" class="w-3 h-3"></i>
              <span>${conf.action}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  initIcons();
}

// 顶部搜索
function doKidsSearch() {
  const kw = document.getElementById('kidsSearchInput').value.trim();
  if (kw) {
    document.getElementById('resourceListTitle').innerHTML = `<span>🔍 搜索 “${kw}” 结果</span>`;
  }
  loadKidsResources(null, kw);
}

function quickKidsSearch(kw) {
  document.getElementById('kidsSearchInput').value = kw;
  doKidsSearch();
}

// ==================== 3. 多媒体播放与核心特色：息屏播放与后台播放 ====================
function playKidsResource(resId) {
  const res = allResourcesList.find(r => r.id === resId);
  if (!res) return;
  currentPlayingResource = res;
  isAudioOnlyMode = false;

  if (res.type === 'pdf') {
    openPdfViewer(res);
    return;
  }

  // 展开底部微型控制器
  const miniPlayer = document.getElementById('bottomMiniPlayer');
  miniPlayer.classList.remove('translate-y-full');
  document.getElementById('miniPlayerCover').src = res.coverUrl;
  document.getElementById('miniPlayerTitle').innerText = res.title;
  document.getElementById('miniPlayerTypeIcon').innerText = res.type === 'video' ? '🎬' : '🎧';

  // 渲染并启动全屏播放器
  setupMediaPlayback(res, false);
  expandFullPlayer();
}

function setupMediaPlayback(res, audioExtractOnly = false) {
  const mediaContainer = document.getElementById('fullPlayerMediaContainer');
  const proxyUrl = resolveStreamUrl(res.url, audioExtractOnly ? 'audio' : 'play');

  document.getElementById('fullPlayerTitle').innerText = res.title;
  document.getElementById('fullPlayerSubtitle').innerText = `${res.categoryName} · 支持息屏后台听课`;

  if (res.type === 'video' && !audioExtractOnly) {
    mediaContainer.innerHTML = `
      <video id="fullActiveMedia" playsinline webkit-playsinline autoplay controls 
             class="w-full max-h-[380px] object-contain rounded-2xl shadow-2xl bg-black" 
             src="${proxyUrl}">
      </video>
    `;
  } else {
    // 纯音频磨耳朵 / 息屏模式
    mediaContainer.innerHTML = `
      <div class="text-center space-y-4 py-8">
        <div class="w-44 h-44 mx-auto rounded-3xl overflow-hidden shadow-2xl border-4 border-white/20 bubble-float">
          <img src="${res.coverUrl}" class="w-full h-full object-cover">
        </div>
        <div class="space-y-1">
          <h3 class="text-white font-extrabold text-base">${res.title}</h3>
          <p class="text-xs text-emerald-400 font-bold flex items-center justify-center gap-1">
            <span>🌙 息屏磨耳朵伴学模式已激活</span>
          </p>
        </div>
        <audio id="fullActiveMedia" autoplay src="${proxyUrl}"></audio>
      </div>
    `;
  }

  activeMediaEl = document.getElementById('fullActiveMedia');
  bindMediaEventListeners(activeMediaEl, res);

  // 更新 MediaSession 系统锁屏卡片 (Android / iOS 息屏控制面板)
  updateMediaSession(res);
}

// 绑定媒体时间与进度事件
function bindMediaEventListeners(media, res) {
  if (!media) return;

  media.playbackRate = currentPlaybackRate;

  media.addEventListener('timeupdate', () => {
    const cur = media.currentTime || 0;
    const dur = media.duration || 1;
    const pct = (cur / dur) * 100;

    document.getElementById('miniProgressFill').style.width = `${pct}%`;
    document.getElementById('fullPlayerSeekBar').value = pct;
    document.getElementById('fullPlayerCurrentTime').innerText = formatTime(cur);
    document.getElementById('fullPlayerDuration').innerText = formatTime(dur);

    // 同步给 MediaSession
    if ('mediaSession' in navigator && media.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: media.duration,
          playbackRate: media.playbackRate,
          position: media.currentTime
        });
      } catch (e) {}
    }
  });

  media.addEventListener('play', () => {
    updatePlayPauseIcons(true);
  });

  media.addEventListener('pause', () => {
    updatePlayPauseIcons(false);
  });

  // 网盘资源播放失败时给出可读提示（夸克非会员直链限制 / 授权失效等）
  media.addEventListener('error', async () => {
    const src = String(media.currentSrc || media.src || '');
    if (!src.includes('/api/pan/stream')) return;
    let reason = '网盘资源暂时无法播放';
    try {
      const r = await fetch(src, { headers: { 'Range': 'bytes=0-1' } });
      if (!r.ok) reason = (await r.text()).substring(0, 160) || reason;
    } catch (e) { /* 忽略 */ }
    kidToast('⚠️ ' + reason, 6000);
  });

  // 进度拖动跳转
  const seekBar = document.getElementById('fullPlayerSeekBar');
  seekBar.oninput = () => {
    if (media.duration) {
      media.currentTime = (seekBar.value / 100) * media.duration;
    }
  };
}

function updatePlayPauseIcons(isPlaying) {
  const miniBtn = document.getElementById('miniPlayBtn');
  const fullBtn = document.getElementById('fullPlayBigBtn');
  const icon = isPlaying ? 'pause' : 'play';

  if (miniBtn) miniBtn.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
  if (fullBtn) fullBtn.innerHTML = `<i data-lucide="${icon}" class="w-8 h-8"></i>`;
  initIcons();
}

function togglePlayPause() {
  if (!activeMediaEl) return;
  if (activeMediaEl.paused) {
    activeMediaEl.play();
  } else {
    activeMediaEl.pause();
  }
}

function seekOffset(seconds) {
  if (!activeMediaEl) return;
  activeMediaEl.currentTime = Math.max(0, activeMediaEl.currentTime + seconds);
}

function cycleRate() {
  const rates = [1.0, 1.25, 1.5, 2.0, 0.8];
  const nextIdx = (rates.indexOf(currentPlaybackRate) + 1) % rates.length;
  currentPlaybackRate = rates[nextIdx];
  if (activeMediaEl) activeMediaEl.playbackRate = currentPlaybackRate;
  document.getElementById('btnCycleRate').innerText = `${currentPlaybackRate}x`;
}

// 切换“息屏听书 / 纯音频模式”
function toggleScreenOffAudioMode() {
  if (!currentPlayingResource) return;
  isAudioOnlyMode = !isAudioOnlyMode;
  setupMediaPlayback(currentPlayingResource, isAudioOnlyMode);
  kidToast(isAudioOnlyMode
    ? '🌙 已切换至【息屏磨耳朵模式】：已自动剥离画面，现在可以放心锁屏或切到后台，声音继续高品质播放！'
    : '🎬 已恢复画面播放模式。', 4200);
}

function showScreenOffTip() {
  kidToast('【息屏播放与后台磨耳朵】系统已通过 MediaSession 占用系统级媒体通道：锁屏后耳机按键仍可暂停/播放/换曲；点击“息屏听书”只拉取音频分片，省约 90% 流量并防止手机发热。', 6000);
}

// 儿童端非阻塞气泡提示（替代 alert，避免打断播放与锁屏媒体通道）
let kidToastTimer = null;
function kidToast(msg, duration = 3200) {
  const box = document.getElementById('kidToast');
  const text = document.getElementById('kidToastText');
  if (!box || !text) { console.log('[kidToast]', msg); return; }
  text.innerText = msg;
  box.classList.remove('hidden');
  if (kidToastTimer) clearTimeout(kidToastTimer);
  kidToastTimer = setTimeout(() => box.classList.add('hidden'), duration);
}

// MediaSession 原生锁屏/通知栏适配
function updateMediaSession(res) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: res.title,
      artist: `智学小鹿 · ${res.categoryName}`,
      album: '少儿智能学习宝库',
      artwork: [
        { src: res.coverUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: res.coverUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: res.coverUrl, sizes: '512x512', type: 'image/jpeg' }
      ]
    });
  }
}

function setupMediaSessionHandlers() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { if (activeMediaEl) activeMediaEl.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (activeMediaEl) activeMediaEl.pause(); });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => { seekOffset(-(details.seekOffset || 10)); });
    navigator.mediaSession.setActionHandler('seekforward', (details) => { seekOffset(details.seekOffset || 10); });
  }
}

function expandFullPlayer() {
  document.getElementById('fullPlayerModal').classList.remove('hidden');
}

function closeFullPlayer() {
  document.getElementById('fullPlayerModal').classList.add('hidden');
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// ==================== 4. PDF 绘本教材查看器 ====================
function openPdfViewer(res) {
  document.getElementById('pdfViewerTitle').innerText = res.title;
  const pdfFrame = document.getElementById('pdfViewerFrame');
  pdfFrame.src = resolveStreamUrl(res.url, 'pdf');
  document.getElementById('pdfViewerModal').classList.remove('hidden');
}

function closePdfViewer() {
  document.getElementById('pdfViewerFrame').src = '';
  document.getElementById('pdfViewerModal').classList.add('hidden');
}

// ==================== 5. AI 伴学智能体问答 ====================
function openAiChatModal() {
  document.getElementById('aiChatModal').classList.remove('hidden');
  initIcons();
}

function closeAiChatModal() {
  document.getElementById('aiChatModal').classList.add('hidden');
}

function sendQuickAiQuery(query) {
  document.getElementById('aiUserInput').value = query;
  sendAiMessage();
}

async function sendAiMessage() {
  const input = document.getElementById('aiUserInput');
  const message = input.value.trim();
  if (!message) return;

  const chatContainer = document.getElementById('aiChatMessages');

  // 渲染用户气泡
  chatContainer.innerHTML += `
    <div class="flex items-start justify-end gap-2">
      <div class="bg-brand-600 text-white p-3 rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed font-medium">
        ${escapeHtml(message)}
      </div>
      <div class="w-8 h-8 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
        👦
      </div>
    </div>
  `;

  input.value = '';
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // 思考中占位气泡
  const loadingBubbleId = `loading-${Date.now()}`;
  chatContainer.innerHTML += `
    <div id="${loadingBubbleId}" class="flex items-start gap-2.5">
      <div class="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg flex-shrink-0">
        🦌
      </div>
      <div class="bg-indigo-50 border border-indigo-100 p-3 rounded-2xl rounded-tl-none text-slate-500 text-xs flex items-center gap-1.5">
        <span class="animate-spin">⏳</span>
        <span>小鹿正在分析学情并检索系统课程...</span>
      </div>
    </div>
  `;
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    document.getElementById(loadingBubbleId)?.remove();

    // 格式化 AI 回复 (解析 Markdown 换行与粗体)
    const formattedReply = (data.reply || '小鹿已为您整理了以下建议！')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    // 关联推荐资源卡片
    let recCardsHtml = '';
    if (data.recommendations && data.recommendations.length > 0) {
      recCardsHtml = `
        <div class="mt-2.5 pt-2 border-t border-indigo-100 space-y-1.5">
          <p class="font-bold text-indigo-900 text-[11px]">👇 点击直接学习推荐课程：</p>
          ${data.recommendations.map(r => `
            <div onclick="playKidsResource('${r.id}'); closeAiChatModal();" 
                 class="bg-white p-2 rounded-xl border border-indigo-100 shadow-xs flex items-center justify-between cursor-pointer hover:border-brand-500 transition">
              <div class="flex items-center gap-2 truncate">
                <span class="text-sm">${r.type === 'video' ? '🎬' : (r.type === 'audio' ? '🎧' : '📖')}</span>
                <span class="font-bold text-slate-800 text-[11px] truncate">${r.title}</span>
              </div>
              <span class="text-[10px] text-brand-600 font-bold whitespace-nowrap pl-2">立即打开 ➔</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    chatContainer.innerHTML += `
      <div class="flex items-start gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg flex-shrink-0 shadow-xs">
          🦌
        </div>
        <div class="bg-indigo-50/90 border border-indigo-100 p-3.5 rounded-2xl rounded-tl-none max-w-[88%] text-slate-800 space-y-1.5 leading-relaxed">
          <div>${formattedReply}</div>
          ${recCardsHtml}
        </div>
      </div>
    `;

    chatContainer.scrollTop = chatContainer.scrollHeight;
  } catch (err) {
    document.getElementById(loadingBubbleId)?.remove();
    chatContainer.innerHTML += `<div class="p-2 text-rose-500 text-xs">网络异常：${err.message}</div>`;
  }
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
