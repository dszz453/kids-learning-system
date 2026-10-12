const axios = require('axios');
const db = require('../database');

/**
 * 儿童 AI 伴学智能体服务
 * 
 * 功能特点：
 * 1. 针对家长/孩子询问：“针对三年级孩子学习什么”、“学前启蒙推荐什么”、“想听成语故事怎么学”等
 * 2. 结合系统内实际已有的分类目录与多媒体资源进行精准推荐 (RAG 检索增强)
 * 3. 支持配置并调用 DeepSeek / OpenAI / 通义千问等大模型
 * 4. 内置离线教育专家知识库兜底引擎，无需外部大模型也能给出高专业度、富有童趣的结构化学习方案与直达跳转
 */
class AiAgentService {
  /**
   * 获取当前 AI 接口配置
   */
  getConfig() {
    const config = db.get('aiConfig') || {};
    return {
      provider: config.provider || 'deepseek',
      baseUrl: config.baseUrl || 'https://api.deepseek.com/v1',
      apiKeyMasked: config.apiKey ? `${config.apiKey.substring(0, 6)}...${config.apiKey.substring(config.apiKey.length - 4)}` : '未配置',
      model: config.model || 'deepseek-chat',
      temperature: config.temperature || 0.7,
      systemPrompt: config.systemPrompt || '',
      updatedAt: config.updatedAt
    };
  }

  /**
   * 更新 AI 配置
   */
  updateConfig(newConfig) {
    const current = db.get('aiConfig') || {};
    const updated = {
      ...current,
      ...newConfig,
      updatedAt: new Date().toISOString()
    };
    db.set('aiConfig', updated);
    return this.getConfig();
  }

  /**
   * 伴学智能体聊天问答与资源推荐
   * @param {string} userMessage 用户问题（例如：“三年级孩子适合学什么英语课？”）
   * @param {object} context 上下文（年级、学生信息）
   */
  async chatWithAgent(userMessage = '', context = {}) {
    const query = userMessage.trim();
    const config = db.get('aiConfig') || {};

    // 1. 从数据库中提取当前系统的分类与资源知识库
    const categories = db.get('categories') || [];
    const resources = db.get('resources') || [];

    // 2. 检索系统内最相关的资源
    const matchedResources = this.searchRelevantResources(query, resources, categories);

    // 3. 构建系统 Prompt，包含系统资源清单
    const resourceCatalogSummary = categories.map(c => {
      const resCount = resources.filter(r => r.categoryId === c.id).length;
      return `- 【${c.name}】(${c.gradeLevel || '全年龄'})：${c.description} [含${resCount}个精品资源]`;
    }).join('\n');

    const promptWithCatalog = `
当前儿童学习系统内已开通的资源模块有：
${resourceCatalogSummary}

家长/孩子提出的咨询是：“${query}”
请作为亲切富有爱心的「智学小鹿」伴学导师，给出针对性的学情分析与学习建议，并明确推荐我们系统中对应的目录和资源！
要求：
1. 语言亲切生动、富有童趣和鼓励性。
2. 明确给出具体的年级学习重点、节奏建议（如每天15分钟磨耳朵/读绘本）。
3. 推荐系统内的具体模块，并引导孩子直接点击下方推荐卡片学习。
`;

    // 4. 如果配置了有效的外部 API Key，尝试调用真实的 LLM 接口
    if (config.apiKey && !config.apiKey.includes('demo') && config.baseUrl) {
      try {
        const resp = await axios.post(
          `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            model: config.model || 'deepseek-chat',
            messages: [
              { role: 'system', content: config.systemPrompt || '你是一位专业的儿童伴学导师智学小鹿。' },
              { role: 'user', content: promptWithCatalog }
            ],
            temperature: config.temperature || 0.7
          },
          {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        const aiReply = resp.data?.choices?.[0]?.message?.content;
        if (aiReply) {
          return {
            reply: aiReply,
            recommendations: matchedResources.slice(0, 3),
            source: 'llm_api'
          };
        }
      } catch (err) {
        console.warn('Real AI API call failed, falling back to expert engine:', err.message);
      }
    }

    // 5. 启发式儿童教育专家引擎（秒级响应、高度切题，保障离线与零Key完美体验）
    const expertResponse = this.generateExpertRecommendation(query, matchedResources, categories);
    return {
      reply: expertResponse.text,
      recommendations: matchedResources.slice(0, 3),
      source: 'expert_knowledge_engine'
    };
  }

  /**
   * 检索系统中最切题的学习资源
   */
  searchRelevantResources(query, resources, categories) {
    const q = query.toLowerCase();
    
    return resources.filter(r => {
      const cat = categories.find(c => c.id === r.categoryId);
      const catName = cat ? cat.name.toLowerCase() : '';
      const title = r.title.toLowerCase();
      const tags = (r.tags || []).join(' ').toLowerCase();

      // 年级关键词匹配
      if (q.includes('3') || q.includes('三') || q.includes('中高')) {
        if (title.includes('新概念') || title.includes('空间站') || title.includes('成语')) return true;
      }
      if (q.includes('幼') || q.includes('1') || q.includes('一') || q.includes('二') || q.includes('启蒙')) {
        if (title.includes('自然拼读') || title.includes('睡前') || title.includes('唐诗')) return true;
      }
      if (q.includes('英') && (title.includes('英语') || catName.includes('英语'))) return true;
      if (q.includes('国学') || q.includes('诗') || q.includes('成语')) {
        if (catName.includes('国学') || title.includes('诗') || title.includes('成语')) return true;
      }
      if (q.includes('故事') || q.includes('睡') || q.includes('听')) {
        if (catName.includes('故事') || r.type === 'audio') return true;
      }
      if (q.includes('科学') || q.includes('宇') || q.includes('百科')) {
        if (catName.includes('科学') || title.includes('空间站') || title.includes('为什么')) return true;
      }

      return title.includes(q) || catName.includes(q) || tags.includes(q);
    });
  }

  /**
   * 生成专业伴学回复
   */
  generateExpertRecommendation(query, matchedResources, categories) {
    const q = query.toLowerCase();
    let text = '';

    if (q.includes('三') || q.includes('3') || q.includes('四年级') || q.includes('4')) {
      text = `🌟 **针对三~四年级小朋友的学习建议：**\n\n三四年级是孩子从具体形象思维向逻辑思维转变的关键转折期！针对这个年龄段，智学小鹿为你推荐以下黄金学习规划：\n\n1. 📘 **英语学科**：这个阶段不宜只停留在单调认词，强烈推荐系统学习【新概念英语青少版】，通过趣味短剧建立完整的句型与时态语感；同时建议结合课文高清绘本朗读，每天早晨磨耳朵15分钟。\n2. 📜 **语文与国学**：小学中段阅读量与写作要求显著提升，建议结合【中华成语动画典故】了解历史背景，并在睡前听【唐诗配乐诵读】陶冶情操。\n3. 🪐 **科学素养**：孩子好奇心旺盛，推荐观看【中国天宫空间站揭秘】科普视频，培养探索精神！\n\n小鹿已经在下方为你精选整理了本系统中匹配的优质课程与绘本，点击即可立即开始学习哦！👇`;
    } else if (q.includes('幼') || q.includes('启蒙') || q.includes('一') || q.includes('1') || q.includes('二') || q.includes('2')) {
      text = `🎈 **针对幼儿园大班与一二年级小朋友的启蒙指南：**\n\n这个阶段的孩子最重要的是**保护求知欲、培养好习惯和建立学习兴趣**！\n\n1. 🔤 **自然拼读启蒙**：不需要死记硬背字母表，通过看系统内的【趣味自然拼读动画】，跟着魔法发音大声跟读，轻松掌握见词能读的拼读密码！\n2. 🌙 **息屏听故事护眼**：低龄孩子要保护视力，晚上入睡前可以使用我们的“息屏后台听书”功能，收听【睡前暖心故事】，既安抚情绪又积累词汇。\n3. 📖 **亲子绘本阅读**：系统内置了世界大师彩色高清PDF画册，支持大图翻页和亲子共读。\n\n快来看看小鹿为你准备的趣味启蒙课程吧！✨`;
    } else if (q.includes('英') || q.includes('english')) {
      text = `🔤 **英语学习进阶全景规划：**\n\n英语是一门声音的语言！小鹿建议遵循“**听力输入 ➔ 拼读规律 ➔ 体系精读 ➔ 绘本拓展**”四步法：\n\n• **第一步（自然拼读）**：先看《趣味自然拼读第一课》，掌握核心元音与辅音发音；\n• **第二步（体系化精读）**：进入《新概念英语青少版1A》，配合纯正英音动画逐课掌握日常对话；\n• **第三步（课本与习题）**：打开配套高清彩色PDF课本做课后巩固。\n\n系统内所有课程均支持**非会员高速播放**，快开启你的英语冒险吧！🚀`;
    } else {
      text = `👋 **你好呀！我是你的 AI 伴学导师「智学小鹿」！**\n\n针对你的提问“${query}”，小鹿全面梳理了咱们系统现有的知识宝库：\n\n✨ **本系统涵盖四大核心板块**：\n1. 🔤 **乐学英语**：涵盖自然拼读、新概念青少版、原版动画；\n2. 📜 **国学经典**：唐诗精选、成语故事、声律启蒙；\n3. 🧸 **开心故事**：经典睡前童话、大师绘本（支持息屏好声音听书）；\n4. 🚀 **科普百科**：宇宙太空、神舟航天、十万个为什么。\n\n你可以告诉我孩子现在的具体年级（例如：一年级、三年级、五年级）或者感兴趣的学科，小鹿会为你量身定制专属学习路线哦！`;
    }

    return { text };
  }
}

module.exports = new AiAgentService();
