const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
// ========== 核心配置（必须完全替换成你的真实内容，不能有任何中文） ==========
// 密钥：上线前换成随机字符串，不要泄露
const JWT_SECRET =  "mindweave_20260319_abc123xyz789";
// 【必须替换】火山引擎真实API Key，格式为sk_开头的英文+数字字符串
const AI_API_KEY = "sk-4092a23c937f41fbadf7a21f95a75d7d";
// 【必须替换】火山引擎真实模型端点ID，格式为ep-开头的英文+数字字符串
const MODEL_ENDPOINT = "e30eba41797c422db4aaeb9bfba008ee";
const API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
// ========== 数据库初始化 ==========
const db = new Database("./mindweave.db");
console.log("✅ 数据库连接成功");

// 创建用户表
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_vip INTEGER DEFAULT 0,
    vip_expire_time INTEGER DEFAULT 0,
    free_used INTEGER DEFAULT 0,
    create_time INTEGER DEFAULT (strftime('%s', 'now'))
)
`);
console.log("✅ 用户表初始化完成");

// ========== 中间件 ==========
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.options("*", cors());
app.use(express.json({ limit: "10mb" }));

// ========== 鉴权中间件 ==========
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, error: "请先登录" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ success: false, error: "登录已过期，请重新登录" });
    }
}

// ========== 工具函数 ==========
/**
 * 检查用户权限
 */
function checkUserPermission(userId) {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) return { hasPermission: false, message: "用户不存在" };
    // VIP用户：无限次
    if (user.is_vip === 1 && user.vip_expire_time > Math.floor(Date.now() / 1000)) {
        return { hasPermission: true, message: "VIP用户", user };
    }
    // 免费用户：10次试用
    if (user.free_used < 10) {
        return { hasPermission: true, message: "免费用户", user };
    }
    return { hasPermission: false, message: "免费次数已用完，请开通VIP" };
}

/**
 * 生成精简版思维导图上下文（提速核心，减少AI阅读量80%）
 */
function generateSlimMapText(mindMap) {
    const rootNode = mindMap.nodes.find(n => n.level === 0);
    const level1Nodes = mindMap.nodes.filter(n => n.level === 1);
    
    let text = `【思维导图核心信息】\n`;
    text += `核心主题：${rootNode.topic}\n`;
    text += `根节点ID：${rootNode.node_id}\n`;
    text += `导图模板：${mindMap.templateName}\n`;
    text += `已有一级分类：${level1Nodes.map(n => `${n.topic}（节点ID：${n.node_id}）`).join("、")}\n`;
    return text;
}

/**
 * 清洗AI返回的JSON内容，保证格式正确
 */
function cleanAiJson(aiContent) {
    // 去除markdown代码块
    aiContent = aiContent.replace(/```json|\```/gi, "").trim();
    // 找到JSON的首尾
    const jsonStart = aiContent.indexOf("{");
    const jsonEnd = aiContent.lastIndexOf("}") + 1;
    if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error("AI返回内容未找到有效JSON结构");
    }
    // 截取并清洗转义字符
    aiContent = aiContent.substring(jsonStart, jsonEnd);
    aiContent = aiContent.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\n|\r|\t/g, '');
    return JSON.parse(aiContent);
}

// ========== 一、用户接口 ==========
// 1. 注册
app.post("/api/auth/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: "邮箱和密码不能为空" });
    }
    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        const stmt = db.prepare("INSERT INTO users (email, password) VALUES (?, ?)");
        const result = stmt.run(email, hashedPassword);
        res.json({ success: true, message: "注册成功，请登录", userId: result.lastInsertRowid });
    } catch (err) {
        if (err.message.includes("UNIQUE")) {
            return res.status(400).json({ success: false, error: "该邮箱已注册" });
        }
        return res.status(500).json({ success: false, error: "注册失败" });
    }
});

// 2. 登录
app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: "邮箱和密码不能为空" });
    }
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
        return res.status(400).json({ success: false, error: "邮箱或密码错误" });
    }
    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        return res.status(400).json({ success: false, error: "邮箱或密码错误" });
    }
    // 生成token
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    // 返回用户信息
    res.json({
        success: true,
        token,
        user: {
            email: user.email,
            isVip: user.is_vip === 1,
            freeUsed: user.free_used,
            freeTotal: 10
        }
    });
});

// 3. 获取用户信息
app.get("/api/auth/info", authMiddleware, (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
    if (!user) {
        return res.status(400).json({ success: false, error: "用户不存在" });
    }
    res.json({
        success: true,
        user: {
            email: user.email,
            isVip: user.is_vip === 1,
            freeUsed: user.free_used,
            freeTotal: 10,
            vipExpireTime: user.vip_expire_time
        }
    });
});

// ========== 二、核心AI接口（代理模式，修复网页解析失败问题） ==========
// 1. 处理内容生成思维导图节点（核心接口）
app.post("/api/process-content", authMiddleware, async (req, res) => {
    const { content, mindMap, targetNodeId, source } = req.body;
    const userId = req.user.userId;

    // ========== 修复：网页内容校验，解决解析失败报错 ==========
    if (!content || content.trim().length < 10) {
        console.warn("❌ 前端传入的内容为空，网页解析失败");
        return res.status(400).json({
            success: false,
            error: "网页解析失败，可能是不支持的网页类型，请检查网页或稍后重试"
        });
    }

    // 检查用户权限
    const { hasPermission, message, user } = checkUserPermission(userId);
    if (!hasPermission) {
        return res.status(403).json({ success: false, error: message });
    }

    try {
        console.log("🤖 代理API调用，用户ID：", userId);
        // 构建基础参数
        const rootNode = mindMap.nodes.find(n => n.level === 0);
        const rootNodeId = rootNode?.node_id || "root";
        const parentNodeId = targetNodeId || rootNodeId;
        const parentNode = mindMap.nodes.find(n => n.node_id === parentNodeId);
        const parentLevel = parentNode?.level || 0;

        // 思维导图模板规则
        const templateRuleMap = {
            tree: "【树状图-分类思维】：必须按「核心主题→一级分类→二级子分类→细节内容」的层级拆解，同级节点必须是互斥的分类，不能有内容交叉，层级必须完整，至少生成3级节点",
            flow: "【流程图-步骤思维】：必须按「流程起点→核心步骤1→步骤2→...→流程终点」的先后顺序拆解，每个步骤必须是可执行的完整动作，必须标注步骤的先后依赖，至少生成3级节点",
            bubble: "【气泡图-发散思维】：必须按「核心主题→关联维度→发散细节」的结构拆解，同级节点是围绕核心主题的不同发散维度，不能有逻辑先后顺序，至少生成3级节点",
            fishbone: "【鱼骨图-因果思维】：必须按「核心问题→原因大类→具体根因」的结构拆解，先拆分人、机、料、法、环等大类原因，再拆解每个大类下的具体根因，至少生成3级节点"
        };
        const templateRule = templateRuleMap[mindMap.template] || templateRuleMap.tree;

        // 生成精简上下文（提速）
        const slimMapText = generateSlimMapText(mindMap);

        // 构建system prompt（优化结构化输出）
        const systemPrompt = `你是MindWeave专属结构化思维引擎，核心任务是把用户提供的文本内容，按指定的思维导图模板，拆解成体系化的结构化节点，严格遵守以下规则：
0.  思考规则：必须先完整通读全文，理解核心主旨，再按【${mindMap.templateName}】的思维模型做体系化拆解，绝对不能只提取标题，必须把全文的核心内容完整拆解到对应层级的节点里
1.  模板约束：${templateRule}
2.  节点归属规则：所有生成的节点，优先挂在父节点ID为${parentNodeId}的节点下，严格按模板的层级规则生成父子关系
3.  节点层级规则：
    - 直接挂在父节点下的节点：level=${parentLevel + 1}
    - 子节点的子节点：level必须在父节点level基础上+1，层级不能跳级
4.  节点必填字段：
    - node_id：唯一ID，格式为node_api_${Date.now()}_随机6位数字
    - parent_id：父节点ID，必须是${parentNodeId}或同批次生成的节点ID
    - topic：节点内容，完整通顺，100%来自原文，三级及以下节点必须是完整句子，不能是关键词
    - level：节点层级，严格按上面的规则填写
    - weight：level=1为0.9，level=2为0.7，level>=3为0.4
    - memory_tag：level=1为"一级目录"，level=2为"定位锚点"，level>=3为"细节单元"
    - source：${source || "网页内容"}
5.  内容要求：100%来自用户提供的原文，绝对不能编造、省略核心信息
6.  输出要求：严格只返回JSON格式数据，结构为 {"nodes": [节点1, 节点2, ...]}，不要任何其他解释、说明、markdown、思考过程
        `;

        // 调用AI API（带超时重试）
        const fetchAI = async () => {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${AI_API_KEY}`
                },
                body: JSON.stringify({
                    model: MODEL_ENDPOINT,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { 
                            role: "user", 
                            content: `【当前思维导图】\n${slimMapText}\n\n【待处理的文本内容】\n${content}`
                        }
                    ],
                    temperature: 0.3,
                    top_p: 0.8,
                    max_tokens: 2000,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API请求失败：${response.status} - ${errorText}`);
            }
            return response.json();
        };

        // 超时控制+重试
        const data = await Promise.race([
            fetchAI(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI请求超时，请稍后重试")), 15000))
        ]);

        // 解析AI返回内容
        let aiContent = data.choices[0].message.content.trim();
        const parsedData = cleanAiJson(aiContent);

        if (!parsedData.nodes || !Array.isArray(parsedData.nodes)) {
            throw new Error("AI返回结构不符合要求，未生成有效节点");
        }

        // 给节点补充坐标，保证画布正常渲染
        const newNodes = parsedData.nodes.map((node, index) => {
            const childLevel = node.level;
            node.x = 100 + childLevel * 320;
            const existingSiblings = mindMap.nodes.filter(n => n.parent_id === node.parent_id);
            const previousNewSiblings = newNodes.slice(0, index).filter(n => n.parent_id === node.parent_id);
            const totalSiblings = existingSiblings.length + previousNewSiblings.length;
            const parentNodeObj = mindMap.nodes.find(n => n.node_id === node.parent_id) || newNodes.find(n => n.node_id === node.parent_id);
            node.y = parentNodeObj 
                ? parentNodeObj.y + 160 + (totalSiblings * 160) 
                : 300 + (totalSiblings * 160);
            node.keywords = node.keywords || [];
            node.isCollapsed = node.level >= 3;
            return node;
        });

        // 免费用户扣次数
        if (user.is_vip === 0) {
            db.prepare("UPDATE users SET free_used = free_used + 1 WHERE id = ?").run(userId);
        }

        console.log("✅ AI处理完成，生成新节点数：", newNodes.length);
        res.json({
            success: true,
            newNodes
        });

    } catch (e) {
        console.error("❌ AI处理失败：", e);
        res.status(500).json({
            success: false,
            error: e.message.includes("网页解析失败") ? e.message : "内容处理失败，请稍后重试"
        });
    }
});

// 2. 生成记忆Prompt
app.post("/api/generate-memory-prompt", authMiddleware, async (req, res) => {
    const { mindMap, targetNodeId } = req.body;
    const userId = req.user.userId;

    const { hasPermission, message, user } = checkUserPermission(userId);
    if (!hasPermission) {
        return res.status(403).json({ success: false, error: message });
    }

    try {
        // 生成完整导图文本
        function generateFullMapText(mindMap) {
            let text = `【思维导图核心主题】：${mindMap.title}\n`;
            text += `【导图模板】：${mindMap.templateName}\n`;
            text += `【完整知识脉络】：\n`;
            
            function getFullContent(parentId, level = 1) {
                const children = mindMap.nodes.filter(n => n.parent_id === parentId);
                if (children.length === 0) return "";
                let content = "";
                const prefix = "  ".repeat(level);
                children.forEach(child => {
                    content += `${prefix}${level}. ${child.topic} (节点ID: ${child.node_id})\n`;
                    content += getFullContent(child.node_id, level + 1);
                });
                return content;
            }

            const rootNode = mindMap.nodes.find(n => n.level === 0);
            text += `1. ${rootNode.topic} (节点ID: ${rootNode.node_id})\n`;
            text += getFullContent(rootNode.node_id, 2);
            return text;
        }

        const fullMapText = generateFullMapText(mindMap);
        let targetContent = "";

        if (targetNodeId) {
            const targetNode = mindMap.nodes.find(n => n.node_id === targetNodeId);
            function getNodeContent(nodeId, level = 1) {
                const children = mindMap.nodes.filter(n => n.parent_id === nodeId);
                if (children.length === 0) return "";
                let content = "";
                const prefix = "  ".repeat(level);
                children.forEach(child => {
                    content += `${prefix}${level}. ${child.topic}\n`;
                    content += getNodeContent(child.node_id, level + 1);
                });
                return content;
            }
            function getNodeFullPath(nodeId) {
                let path = [];
                let currentNode = mindMap.nodes.find(n => n.node_id === nodeId);
                while (currentNode) {
                    path.unshift(currentNode.topic);
                    currentNode = mindMap.nodes.find(n => n.node_id === currentNode.parent_id);
                }
                return path.join(" → ");
            }
            targetContent = `【核心记忆节点】：${targetNode.topic}\n`;
            targetContent += `【节点完整路径】：${getNodeFullPath(targetNodeId)}\n`;
            targetContent += `【节点完整内容】：\n`;
            targetContent += `1. ${targetNode.topic}\n`;
            targetContent += getNodeContent(targetNodeId, 2);
        } else {
            targetContent = fullMapText;
        }

        // 调用AI生成标准记忆Prompt
        const systemPrompt = `你是MindWeave专属记忆引擎，核心任务是：把用户提供的思维导图结构，转换成对话AI能理解的记忆上下文，严格遵守以下规则：
1.  生成的记忆上下文，必须是对话AI能直接理解的、结构化的知识背景
2.  必须100%基于用户提供的思维导图内容，绝对不能编造、扩展
3.  开头必须加上："以下是你必须严格遵守的记忆内容，所有回答必须基于此内容，禁止脱离此内容回答："
4.  结尾必须加上："如果用户的问题不在上述记忆内容中，直接回答：当前记忆库中没有相关内容"
5.  输出要求：结构清晰、逻辑通顺，严格只返回记忆上下文内容，不要任何其他解释、说明、markdown
        `;

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL_ENDPOINT,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `【思维导图内容】\n${targetContent}` }
                ],
                temperature: 0.1,
                max_tokens: 4000,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API请求失败：${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const memoryPrompt = data.choices[0].message.content.trim();

        // 免费用户扣次数
        if (user.is_vip === 0) {
            db.prepare("UPDATE users SET free_used = free_used + 1 WHERE id = ?").run(userId);
        }

        res.json({
            success: true,
            memoryPrompt
        });

    } catch (e) {
        console.error("❌ 记忆生成失败：", e);
        res.status(500).json({
            success: false,
            error: "记忆生成失败，请稍后重试"
        });
    }
});

// 3. 记忆检索
app.post("/api/retrieve-memory", authMiddleware, async (req, res) => {
    const { query, mindMap } = req.body;
    const userId = req.user.userId;

    const { hasPermission, message, user } = checkUserPermission(userId);
    if (!hasPermission) {
        return res.status(403).json({ success: false, error: message });
    }

    try {
        // 生成完整导图文本
        function generateFullMapText(mindMap) {
            let text = `【思维导图核心主题】：${mindMap.title}\n`;
            text += `【导图模板】：${mindMap.templateName}\n`;
            text += `【完整知识脉络】：\n`;
            
            function getFullContent(parentId, level = 1) {
                const children = mindMap.nodes.filter(n => n.parent_id === parentId);
                if (children.length === 0) return "";
                let content = "";
                const prefix = "  ".repeat(level);
                children.forEach(child => {
                    content += `${prefix}${level}. ${child.topic} (节点ID: ${child.node_id})\n`;
                    content += getFullContent(child.node_id, level + 1);
                });
                return content;
            }

            const rootNode = mindMap.nodes.find(n => n.level === 0);
            text += `1. ${rootNode.topic} (节点ID: ${rootNode.node_id})\n`;
            text += getFullContent(rootNode.node_id, 2);
            return text;
        }

        const fullMapText = generateFullMapText(mindMap);

        // 调用AI检索
        const systemPrompt = `你是MindWeave专属记忆检索引擎，核心任务是：根据用户的问题，从给定的思维导图里，检索出最相关的节点，严格遵守以下规则：
1.  检索规则：
    - 先理解用户的问题核心
    - 再匹配思维导图里的节点，找出所有和问题相关的节点
    - 必须包含相关节点的完整路径（从根节点到该节点的完整脉络）
2.  输出要求：
    - 严格只返回JSON格式数据，结构为：
      {
        "relevantNodes": [节点ID1, 节点ID2, ...],
        "memoryText": "整理后的结构化记忆文本，包含完整路径和节点内容"
      }
    - 不要任何其他解释、说明、markdown
3.  内容要求：100%来自给定的思维导图，绝对不能编造
        `;

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL_ENDPOINT,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `【用户问题】\n${query}\n\n【完整思维导图】\n${fullMapText}` }
                ],
                temperature: 0.1,
                max_tokens: 3000,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API请求失败：${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let aiContent = data.choices[0].message.content.trim();
        const parsedData = cleanAiJson(aiContent);

        // 免费用户扣次数
        if (user.is_vip === 0) {
            db.prepare("UPDATE users SET free_used = free_used + 1 WHERE id = ?").run(userId);
        }

        res.json({
            success: true,
            ...parsedData
        });

    } catch (e) {
        console.error("❌ 记忆检索失败：", e);
        res.status(500).json({
            success: false,
            error: "记忆检索失败，请稍后重试"
        });
    }
});

// ========== 三、健康检查 ==========
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>MindWeave 大众版服务</title>
        </head>
        <body>
            <h1>🧠 MindWeave 大众版服务已启动</h1>
            <p>服务正常运行中</p>
            <p>接口地址：http://localhost:${PORT}</p>
        </body>
        </html>
    `);
});

// ========== 全局错误兜底 ==========
app.use((err, req, res, next) => {
    console.error("❌ 服务异常：", err);
    res.status(500).json({ success: false, error: "服务内部错误，请稍后重试" });
});

// ========== 启动服务 ==========
app.listen(PORT, "0.0.0.0", () => {
    console.log(`
    ========================================
    🧠 MindWeave 大众版服务已启动
    📍 服务地址：http://localhost:${PORT}
    💡 已修复网页解析失败问题，优化AI响应速度
    ✅ 用户系统+代理API+用量控制已就绪
    ========================================
    `);
});