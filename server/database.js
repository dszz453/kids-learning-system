const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, '../data/db.json');

// 初始默认数据
const initialData = {
  categories: [
    {
      id: 'cat_eng',
      name: '乐学英语',
      parentId: null,
      icon: 'sparkles',
      emoji: '🔤',
      color: '#4F46E5',
      bgColor: '#EEF2FF',
      sortOrder: 1,
      description: '趣味英语启蒙、自然拼读与动画口语',
      gradeLevel: '1-6年级'
    },
    {
      id: 'cat_eng_phonics',
      name: '自然拼读',
      parentId: 'cat_eng',
      icon: 'volume-high',
      emoji: '🗣️',
      color: '#3B82F6',
      bgColor: '#EFF6FF',
      sortOrder: 1,
      description: '26个字母发音与复合音拼读',
      gradeLevel: '幼儿园-2年级'
    },
    {
      id: 'cat_eng_concept',
      name: '新概念英语青少版',
      parentId: 'cat_eng',
      icon: 'book-open',
      emoji: '📘',
      color: '#2563EB',
      bgColor: '#DBEAFE',
      sortOrder: 2,
      description: '经典体系化课文与动画精讲',
      gradeLevel: '3-6年级'
    },
    {
      id: 'cat_classics',
      name: '国学经典',
      parentId: null,
      icon: 'bookmark',
      emoji: '📜',
      color: '#D97706',
      bgColor: '#FFFBEB',
      sortOrder: 2,
      description: '三字经、论语、唐诗三百首与成语故事',
      gradeLevel: '全年龄段'
    },
    {
      id: 'cat_classics_tang',
      name: '唐诗精选配乐诵读',
      parentId: 'cat_classics',
      icon: 'musical-notes',
      emoji: '🎵',
      color: '#B45309',
      bgColor: '#FEF3C7',
      sortOrder: 1,
      description: '声律启蒙与名家吟诵',
      gradeLevel: '1-4年级'
    },
    {
      id: 'cat_classics_idioms',
      name: '中华成语动画精讲',
      parentId: 'cat_classics',
      icon: 'film',
      emoji: '🎬',
      color: '#92400E',
      bgColor: '#FDE68A',
      sortOrder: 2,
      description: '百部成语历史故事与典故',
      gradeLevel: '2-5年级'
    },
    {
      id: 'cat_stories',
      name: '开心故事',
      parentId: null,
      icon: 'face-smile',
      emoji: '🧸',
      color: '#EC4899',
      bgColor: '#FDF2F8',
      sortOrder: 3,
      description: '睡前故事、中外著名安徒生格林童话与绘本',
      gradeLevel: '幼儿园-3年级'
    },
    {
      id: 'cat_stories_bedtime',
      name: '睡前暖心故事精选',
      parentId: 'cat_stories',
      icon: 'moon',
      emoji: '🌙',
      color: '#DB2777',
      bgColor: '#FCE7F3',
      sortOrder: 1,
      description: '适合闭眼息屏听书的舒缓睡前绘本故事',
      gradeLevel: '幼儿园-2年级'
    },
    {
      id: 'cat_science',
      name: '科普百科',
      parentId: null,
      icon: 'globe-alt',
      emoji: '🚀',
      color: '#10B981',
      bgColor: '#ECFDF5',
      sortOrder: 4,
      description: '神奇动物、宇宙太空、十万个为什么',
      gradeLevel: '2-6年级'
    },
    {
      id: 'cat_science_universe',
      name: '宇宙探秘趣味科普',
      parentId: 'cat_science',
      icon: 'star',
      emoji: '🪐',
      color: '#059669',
      bgColor: '#D1FAE5',
      sortOrder: 1,
      description: '太阳系行星、黑洞与空间站高清动画',
      gradeLevel: '3-6年级'
    }
  ],
  resources: [
    {
      id: 'res_001',
      title: '趣味自然拼读第一课：字母魔法发音',
      categoryId: 'cat_eng_phonics',
      type: 'video',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      audioUrl: 'https://www.w3schools.com/html/horse.mp3',
      size: '15.2 MB',
      duration: '09:56',
      coverUrl: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&auto=format&fit=crop',
      description: '从A到Z的魔幻自然拼读入门，互动式教学发音，节奏轻快好记。',
      tags: ['英语', '发音', '自然拼读', '视频'],
      panSource: 'quark',
      speedupSupport: true,
      createdAt: '2026-09-01T10:00:00Z'
    },
    {
      id: 'res_002',
      title: '新概念英语青少版1A：第一单元Hello动画精讲',
      categoryId: 'cat_eng_concept',
      type: 'video',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      size: '32.8 MB',
      duration: '10:54',
      coverUrl: 'https://images.unsplash.com/photo-1588072432836-e10032774350?w=500&auto=format&fit=crop',
      description: '英国原版发音录制，卡通人物生动对话情境，配套课后常用词汇。',
      tags: ['新概念', '英语语法', '听力口语'],
      panSource: 'baidu',
      speedupSupport: true,
      createdAt: '2026-09-02T11:00:00Z'
    },
    {
      id: 'res_003',
      title: '新概念青少版 1A 彩色高清课本绘本与练习册',
      categoryId: 'cat_eng_concept',
      type: 'pdf',
      url: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf',
      size: '8.4 MB',
      duration: '共 48 页',
      coverUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop',
      description: '官方配套高精度彩色PDF，支持双指缩放与高清护眼翻阅。',
      tags: ['教材', 'PDF课本', '练习册'],
      panSource: 'uc',
      speedupSupport: true,
      createdAt: '2026-09-03T12:00:00Z'
    },
    {
      id: 'res_004',
      title: '唐诗配乐美读合辑（适合晨读与息屏磨耳朵）',
      categoryId: 'cat_classics_tang',
      type: 'audio',
      url: 'https://actions.google.com/sounds/v1/water/rain_on_roof.ogg',
      size: '6.7 MB',
      duration: '18:20',
      coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop',
      description: '包含《春晓》《静夜思》《登鹳雀楼》等名篇，古琴雅乐伴奏，纯净助眠与背诵。',
      tags: ['国学', '唐诗', '息屏听书', '音频'],
      panSource: 'cloud189',
      speedupSupport: true,
      createdAt: '2026-09-05T08:30:00Z'
    },
    {
      id: 'res_005',
      title: '中华成语动画典故：拔苗助长与守株待兔',
      categoryId: 'cat_classics_idioms',
      type: 'video',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      size: '14.1 MB',
      duration: '05:15',
      coverUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=500&auto=format&fit=crop',
      description: '水墨国风卡通动画，生动讲述经典历史成语来历与深层做人哲理。',
      tags: ['成语故事', '历史', '水墨动画'],
      panSource: 'quark',
      speedupSupport: true,
      createdAt: '2026-09-08T09:40:00Z'
    },
    {
      id: 'res_006',
      title: '睡前暖心童话：小熊的月亮摇篮曲（息屏好梦版）',
      categoryId: 'cat_stories_bedtime',
      type: 'audio',
      url: 'https://actions.google.com/sounds/v1/weather/light_rain.ogg',
      size: '12.5 MB',
      duration: '15:40',
      coverUrl: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=500&auto=format&fit=crop',
      description: '温柔女声播讲，配背景轻柔摇篮曲，支持锁屏/息屏持续播放。',
      tags: ['睡前故事', '童话', '音频听书', '息屏播放'],
      panSource: 'baidu',
      speedupSupport: true,
      createdAt: '2026-09-10T21:00:00Z'
    },
    {
      id: 'res_007',
      title: '十万个为什么科普画册：地球是怎样转动的',
      categoryId: 'cat_science_universe',
      type: 'pdf',
      url: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf',
      size: '11.3 MB',
      duration: '共 32 页',
      coverUrl: 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=500&auto=format&fit=crop',
      description: '高精绘图解析昼夜交替、四季变迁与太阳系的奥秘。',
      tags: ['地球科学', '十万个为什么', 'PDF绘本'],
      panSource: 'quark',
      speedupSupport: true,
      createdAt: '2026-09-12T14:20:00Z'
    },
    {
      id: 'res_008',
      title: '中国天宫空间站揭秘（高清科普动画实录）',
      categoryId: 'cat_science_universe',
      type: 'video',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      size: '28.9 MB',
      duration: '08:45',
      coverUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500&auto=format&fit=crop',
      description: '航天员叔叔阿姨在太空中怎样生活？带孩子看真实的零重力物理实验。',
      tags: ['航天', '空间站', '科普', '物理'],
      panSource: 'quark',
      speedupSupport: true,
      createdAt: '2026-09-15T15:00:00Z'
    }
  ],
  users: [
    {
      id: 'usr_admin',
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 8),
      role: 'admin',
      nickname: '系统管理员',
      expireAt: '2099-12-31T23:59:59Z',
      allowedCategoryIds: ['*'],
      active: true,
      createdAt: '2026-09-01T00:00:00Z'
    },
    {
      id: 'usr_kid01',
      username: 'xiaoming',
      passwordHash: bcrypt.hashSync('123456', 8),
      role: 'student',
      nickname: '小明 (小学三年级)',
      grade: '3年级',
      expireAt: '2027-12-31T23:59:59Z',
      allowedCategoryIds: ['cat_eng', 'cat_classics', 'cat_stories', 'cat_science'],
      active: true,
      createdAt: '2026-09-02T00:00:00Z'
    },
    {
      id: 'usr_kid02',
      username: 'lele',
      passwordHash: bcrypt.hashSync('123456', 8),
      role: 'student',
      nickname: '乐乐 (学前大班)',
      grade: '学前',
      expireAt: '2027-06-30T23:59:59Z',
      allowedCategoryIds: ['cat_stories', 'cat_classics'],
      active: true,
      createdAt: '2026-09-03T00:00:00Z'
    }
  ],
  panAccounts: [
    {
      id: 'pan_quark',
      panType: 'quark',
      name: '夸克网盘 (主转存账号)',
      status: 'active',
      username: '用户_7894',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop',
      cookies: '__pus=fake_quark_cookie_demo_8829; uid=882901;',
      token: 'quark_tk_demo_9921',
      freeQuota: '820 GB / 1024 GB',
      updatedAt: '2026-10-10T12:00:00Z'
    },
    {
      id: 'pan_baidu',
      panType: 'baidu',
      name: '百度网盘 (备用转存账号)',
      status: 'active',
      username: '百度网盘达人',
      avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop',
      cookies: 'BDUSS=fake_baidu_bduss_token_99182; STOKEN=token_991;',
      token: 'baidu_access_token_mock',
      freeQuota: '1.2 TB / 2.0 TB',
      updatedAt: '2026-10-09T08:00:00Z'
    },
    {
      id: 'pan_uc',
      panType: 'uc',
      name: 'UC网盘',
      status: 'not_configured',
      username: '未绑定',
      avatar: '',
      cookies: '',
      token: '',
      freeQuota: '0 GB / 0 GB',
      updatedAt: '2026-09-01T00:00:00Z'
    },
    {
      id: 'pan_cloud189',
      panType: 'cloud189',
      name: '天翼云盘',
      status: 'not_configured',
      username: '未绑定',
      avatar: '',
      cookies: '',
      token: '',
      freeQuota: '0 GB / 0 GB',
      updatedAt: '2026-09-01T00:00:00Z'
    }
  ],
  pansouConfig: {
    apiUrl: 'http://localhost:8080',
    enabled: false,
    timeout: 10000,
    sources: ['quark', 'baidu', 'uc', 'cloud189'],
    updatedAt: '2026-10-12T00:00:00Z'
  },
  aiConfig: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-demo-ai-key-configured-for-learning',
    model: 'deepseek-chat',
    temperature: 0.7,
    systemPrompt: `你是一位专业、富有亲和力、懂儿童认知心理学的 AI 伴学导师「智学小鹿」。
你的使命是根据孩子的年龄/年级以及具体学科需求，给出循序渐进的学习建议，并结合当前系统资源库（乐学英语、自然拼读、新概念、国学古诗成语、睡前故事、科普百科宇宙等）给出具体指引。
说话风格亲切生动、充满鼓励、语言浅显易懂，多用小符号和生动举例。`,
    updatedAt: '2026-10-10T10:00:00Z'
  },
  transferTasks: []
};

class Database {
  constructor() {
    this.data = null;
    this.init();
  }

  init() {
    try {
      const dataDir = path.dirname(DB_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        this.data = initialData;
        this.save();
      }
    } catch (e) {
      console.error('Error loading db file, fallback to initial data:', e);
      this.data = initialData;
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error writing to db file:', e);
    }
  }

  get(collection) {
    return this.data[collection] || [];
  }

  set(collection, value) {
    this.data[collection] = value;
    this.save();
    return value;
  }

  find(collection, predicate) {
    const list = this.get(collection);
    return list.find(predicate);
  }

  filter(collection, predicate) {
    const list = this.get(collection);
    return list.filter(predicate);
  }

  insert(collection, item) {
    if (!this.data[collection]) {
      this.data[collection] = [];
    }
    this.data[collection].push(item);
    this.save();
    return item;
  }

  update(collection, id, updates) {
    const list = this.get(collection);
    const index = list.findIndex(item => item.id === id);
    if (index !== -1) {
      this.data[collection][index] = { ...this.data[collection][index], ...updates };
      this.save();
      return this.data[collection][index];
    }
    return null;
  }

  delete(collection, id) {
    const list = this.get(collection);
    const index = list.findIndex(item => item.id === id);
    if (index !== -1) {
      const removed = list.splice(index, 1)[0];
      this.save();
      return removed;
    }
    return null;
  }
}

const db = new Database();

module.exports = db;
