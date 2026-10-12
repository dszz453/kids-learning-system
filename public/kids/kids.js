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

document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  loadKidsCategories();
  loadKidsResources();
  setupMediaSessionHandlers();
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ==================== 1. 分类目录与层级浏览 (与后台资源树严格对照) ====================
async function loadKidsCategories() {
  try {
    const res = await fetch('/api/categories/tree');
    const data = await res.json();
    categoriesTree = data.tree || [];
    allCategoriesList = data.list || [];
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

// 进入某一级目录，展示其二级子目录
function enterCategory(catId) {
  const targetCat = allCategoriesList.find(c => c.id === catId);
  if (!targetCat) return;

  currentParentId = catId;
  const children = allCategoriesList.filter(c => c.parentId === catId);

  // 更新面包屑
  const breadcrumb = document.getElementById('breadcrumbBar');
  breadcrumb.classList.remove('hidden');
  document.getElementById('breadcrumbCurrentText').innerText = targetCat.name;

  if (children.length > 0) {
    // 隐藏一级网格，显示二级网格
    document.getElementById('topModulesSection').classList.add('hidden');
    const subSec = document.getElementById('subCategoriesSection');
    subSec.classList.remove('hidden');
    document.getElementById('subCatTitle').innerText = `📂 ${targetCat.name} · 子目录`;
    document.getElementById('subCatCountTip').innerText = `共 ${children.length} 个专属分类`;

    const subGrid = document.getElementById('subCategoriesGrid');
    subGrid.innerHTML = children.map(sub => `
      <div onclick="selectCategoryFilter('${sub.id}', '${sub.name}')" 
           class="bg-white rounded-2xl p-3.5 border-2 border-indigo-100 hover:border-brand-500 shadow-sm cursor-pointer kid-card-bounce flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0" style="background-color: ${sub.bgColor || '#EEF2FF'}">
          ${sub.emoji || '📘'}
        </div>
        <div class="min-w-0">
          <h5 class="font-bold text-slate-900 text-xs truncate">${sub.name}</h5>
          <span class="text-[10px] text-brand-600 font-semibold">${sub.resourceCount || 0} 个精品课件</span>
        </div>
      </div>
    `).join('');
  }

  // 同时刷新资源列表，仅显示当前目录下的内容
  loadKidsResources(catId);
}

// 面包屑返回全部首页
function goBackToHome() {
  currentParentId = null;
  document.getElementById('breadcrumbBar').classList.add('hidden');
  document.getElementById('topModulesSection').classList.remove('hidden');
  document.getElementById('subCategoriesSection').classList.add('hidden');
  document.getElementById('resourceListTitle').innerHTML = `<span>🎯 今日精选推荐课程</span>`;
  loadKidsResources();
}

function selectCategoryFilter(catId, catName) {
  document.getElementById('breadcrumbCurrentText').innerText = catName;
  document.getElementById('resourceListTitle').innerHTML = `<span>🎯 ${catName} 资源专区</span>`;
  loadKidsResources(catId);
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
  const proxyUrl = audioExtractOnly 
    ? `/api/stream/audio-extract?url=${encodeURIComponent(res.url)}`
    : `/api/stream/play?url=${encodeURIComponent(res.url)}&speedup=true`;

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
  alert(isAudioOnlyMode 
    ? '🌙 已切换至【息屏磨耳朵模式】：已自动为您剥离画面，您现在可以放心锁屏或切换到后台，声音将继续高品质播放！' 
    : '🎬 已恢复画面播放模式。');
}

function showScreenOffTip() {
  alert('【息屏播放与后台磨耳朵技术原理】\n1. 系统通过 Web MediaSession API 占用了系统级媒体通道；\n2. 锁屏后，安卓手机与耳机按键仍可暂停/播放/换曲；\n3. 点击“息屏听书”会只拉取音频分片，帮您省下 90% 流量并彻底防止手机发热！');
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
  pdfFrame.src = `/api/stream/pdf?url=${encodeURIComponent(res.url)}`;
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
