const fetch = require("node-fetch");

// ========== 智能体核心配置 ==========
const AI_CONFIG = {
    model: "MINDW0EAVE", // 替换成你的智能体模型名
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKey: "sk-e811bf5a2c844cdfa4accf582ec65e8f" // 替换成你的API Key
};

// ========== 核心：处理内容生成思维导图节点 ==========
async function processContent(content, mindMap, targetNodeId, apiKey, source) {
    // 1. 确定默认父节点
    const rootNode = mindMap.nodes.find(n => n.level === 0);
    const rootNodeId = rootNode?.node_id || "root";
    const defaultParentId = targetNodeId || rootNodeId;

    console.log("🔍 当前思维导图节点数：", mindMap.nodes.length);
    console.log("📍 默认父节点ID：", defaultParentId);

    // 2. 生成精简版思维导图上下文（提速核心）
    function generateSlimMapText(mindMap) {
        // 只提取一级/二级节点，给AI快速识别骨架，大幅减少阅读量
        const level1Nodes = mindMap.nodes.filter(n => n.level === 1);
        const level2Nodes = mindMap.nodes.filter(n => n.level === 2);
        
        let text = `【当前思维导图精简版】\n`;
        text += `核心主题：${mindMap.title}\n`;
        text += `已有一级分类：${level1Nodes.map(n => n.topic).join("、")}\n`;
        text += `已有二级子分类：${level2Nodes.map(n => `${n.topic}（父：${mindMap.nodes.find(p => p.node_id === n.parent_id)?.topic || "根节点"}`).join("、")}\n`;
        text += `根节点ID：${rootNodeId}\n`;
        return text;
    }

    const slimMapText = generateSlimMapText(mindMap);

    // 3. 构建用户消息（完全匹配智能体的入参格式）
    const userContent = `
${slimMapText}
【待处理文本】
${content}
【默认父节点ID】
${defaultParentId}
【来源】
${source || "网页内容"}
    `.trim();

    // 4. 调用发布好的智能体API
    console.log("🤖 正在调用MindWeave智能体API...");
    const response = await fetch(AI_CONFIG.apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${AI_CONFIG.apiKey}`
        },
        body: JSON.stringify({
            model: AI_CONFIG.model,
            messages: [
                { role: "user", content: userContent }
            ],
            temperature: 0.5,
            top_p: 0.8,
            max_tokens: 2000,
            stream: false // 必须关闭流式输出，保证一次性返回完整JSON
        })
    });

    // 5. 处理响应
    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`智能体API请求失败：${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let aiContent = data.choices[0].message.content.trim();
    
    // 6. 清洗JSON格式，保证插件能稳定解析
    console.log("📝 智能体返回内容，正在清洗...");
    aiContent = aiContent.replace(/```json|\```/gi, "").trim();
    const jsonStart = aiContent.indexOf("{");
    const jsonEnd = aiContent.lastIndexOf("}") + 1;
    if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error("智能体返回内容未找到有效JSON结构");
    }
    aiContent = aiContent.substring(jsonStart, jsonEnd);
    aiContent = aiContent.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\n|\r|\t/g, '');
    
    const parsedData = JSON.parse(aiContent);
    if (!parsedData.nodes || !Array.isArray(parsedData.nodes)) {
        throw new Error("智能体返回结构不符合要求，无nodes数组");
    }

    // 7. 给节点补充坐标，保证画布正常渲染
    console.log("📍 正在计算节点坐标...");
    const newNodes = parsedData.nodes.map((node, index) => {
        node.x = 100 + node.level * 320;
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

    console.log("✅ 智能体处理完成，生成新节点数：", newNodes.length);
    return { newNodes };
}

// 别忘了导出函数
module.exports = { processContent };
// ========== 核心2：生成对话AI的记忆Prompt（apiAI） ==========
async function generateMemoryPrompt(mindMap, targetNodeId, apiKey) {
    // 1. 提取需要生成记忆的内容
    let targetContent = "";
    if (targetNodeId) {
        // 生成单个节点的记忆
        const targetNode = mindMap.nodes.find(n => n.node_id === targetNodeId);
        if (!targetNode) throw new Error("目标节点不存在");

        // 递归获取子节点内容
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

        targetContent = `【核心记忆节点】：${targetNode.topic}\n`;
        targetContent += `【节点完整路径】：${getNodeFullPath(mindMap, targetNodeId)}\n`;
        targetContent += `【节点完整内容】：\n`;
        targetContent += `1. ${targetNode.topic}\n`;
        targetContent += getNodeContent(targetNodeId, 2);
    } else {
        // 生成完整导图的记忆
        targetContent = `【思维导图核心主题】：${mindMap.title}\n`;
        targetContent += `【导图模板】：${mindMap.templateName}\n`;
        targetContent += `【完整知识脉络】：\n`;
        
        // 递归生成完整结构
        function getFullContent(parentId, level = 1) {
            const children = mindMap.nodes.filter(n => n.parent_id === parentId);
            if (children.length === 0) return "";
            let content = "";
            const prefix = "  ".repeat(level);
            children.forEach(child => {
                content += `${prefix}${level}. ${child.topic}\n`;
                content += getFullContent(child.node_id, level + 1);
            });
            return content;
        }

        const rootNode = mindMap.nodes.find(n => n.level === 0);
        targetContent += `1. ${rootNode.topic}\n`;
        targetContent += getFullContent(rootNode.node_id, 2);
    }
    // 2. 构建apiAI的Prompt（核心：模板=AI的思考框架，结构即记忆）
    const templateRuleMap = {
        tree: "【树状图-分类思维】：必须按「核心主题→一级分类→二级子分类→细节内容」的层级拆解，同级节点必须是互斥的分类，不能有内容交叉，层级必须完整，至少生成3级节点",
        flow: "【流程图-步骤思维】：必须按「流程起点→核心步骤1→步骤2→...→流程终点」的先后顺序拆解，每个步骤必须是可执行的完整动作，必须标注步骤的先后依赖，至少生成3级节点",
        bubble: "【气泡图-发散思维】：必须按「核心主题→关联维度→发散细节」的结构拆解，同级节点是围绕核心主题的不同发散维度，不能有逻辑先后顺序，至少生成3级节点",
        fishbone: "【鱼骨图-因果思维】：必须按「核心问题→原因大类→具体根因」的结构拆解，先拆分人、机、料、法、环等大类原因，再拆解每个大类下的具体根因，至少生成3级节点"
    };
    const templateRule = templateRuleMap[mindMap.template] || templateRuleMap.tree;

    const systemPrompt = `你是MindWeave专属apiAI记忆引擎，核心任务是：把用户提供的文本内容，按指定的思维导图模板，拆解成体系化的结构化节点，严格遵守以下规则：
0.  思考规则：必须先完整通读全文，理解核心主旨，再按【${mindMap.templateName}】的思维模型做体系化拆解，绝对不能只提取标题，必须把全文的核心内容完整拆解到对应层级的节点里
1.  模板约束：${templateRule}
2.  节点归属规则：所有生成的节点，必须挂在父节点ID为${parentNodeId}的节点下，严格按模板的层级规则生成父子关系
3.  节点层级规则：
    - 直接挂在父节点下的节点：level=${parentLevel + 1}
    - 子节点的子节点：level必须在父节点level基础上+1，层级不能跳级
4.  节点必填字段：
    - node_id：唯一ID，格式为node_api_${Date.now()}_随机数
    - parent_id：父节点ID，必须是${parentNodeId}或同批次生成的节点ID
    - topic：节点内容，必须是完整通顺的句子，100%来自原文，不能是无意义的关键词，必须包含原文的核心信息
    - level：节点层级，严格按上面的规则填写
    - weight：level=1为0.9，level=2为0.7，level>=3为0.4
    - memory_tag：level=1为"一级目录"，level=2为"定位锚点"，level>=3为"细节单元"
    - source：${source || "网页内容"}
5.  内容要求：100%来自用户提供的原文，绝对不能编造、省略核心信息，必须把原文的所有核心论点、数据、细节都拆解到对应节点里
6.  输出要求：严格只返回JSON格式数据，结构为 {"nodes": [节点1, 节点2, ...]}，不要任何其他解释、说明、markdown、代码块
    `;
    // 3. 调用apiAI生成标准记忆上下文
    console.log("🤖 正在调用apiAI生成记忆上下文...");
    const response = await fetch(AI_CONFIG.apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: AI_CONFIG.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `【思维导图内容】\n${targetContent}` }
            ],
            temperature: 0.1,
            max_tokens: 4000
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`apiAI请求失败：${response.status} - ${errorText || response.statusText}`);
    }

    const data = await response.json();
    const memoryPrompt = data.choices[0].message.content.trim();

    return { memoryPrompt };
}
// ========== 核心3：从思维导图里检索相关记忆（apiAI） ==========
async function retrieveRelevantMemory(query, mindMap, apiKey) {
    // 1. 先把完整的思维导图结构传给apiAI
    const fullMapText = generateFullMapText(mindMap);

    // 2. 构建apiAI的Prompt，让它做结构化检索
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

    // 3. 调用apiAI做检索
    console.log("🤖 正在调用apiAI做记忆检索...");
    const response = await fetch(AI_CONFIG.apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: AI_CONFIG.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `【用户问题】\n${query}\n\n【完整思维导图】\n${fullMapText}` }
            ],
            temperature: 0.1,
            max_tokens: 3000
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`apiAI请求失败：${response.status} - ${errorText || response.statusText}`);
    }

    const data = await response.json();
    let aiContent = data.choices[0].message.content.trim();
    
    // 4. 清洗JSON格式
    aiContent = aiContent.replace(/```json|\```/gi, "").trim();
    const jsonStart = aiContent.indexOf("{");
    const jsonEnd = aiContent.lastIndexOf("}") + 1;
    if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error("apiAI返回内容未找到有效JSON结构");
    }
    aiContent = aiContent.substring(jsonStart, jsonEnd);
    aiContent = aiContent.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\n|\r|\t/g, '');
    
    const parsedData = JSON.parse(aiContent);
    return parsedData;
}

// ========== 工具：生成完整的思维导图文本 ==========
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

// 别忘了在 module.exports 里导出新函数
module.exports = { processContent, generateMemoryPrompt, retrieveRelevantMemory };

// ========== 工具：获取节点完整路径 ==========
function getNodeFullPath(mindMap, nodeId) {
    let path = [];
    let currentNode = mindMap.nodes.find(n => n.node_id === nodeId);
    while (currentNode) {
        path.unshift(currentNode.topic);
        currentNode = mindMap.nodes.find(n => n.node_id === currentNode.parent_id);
    }
    return path.join(" → ");
}

module.exports = { processContent, generateMemoryPrompt };