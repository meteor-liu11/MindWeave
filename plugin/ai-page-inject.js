console.log("🧠 MindWeave 记忆引擎已注入到当前AI对话网页");

// ========== 全局变量 ==========
let memoryEngineEnabled = false;
let currentMindMap = null;
let apiKey = "";
const SERVER_URL = "http://localhost:3000";

// ========== 监听插件消息，一键部署记忆引擎 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "deploy_memory_engine") {
        memoryEngineEnabled = true;
        currentMindMap = message.data.mindMap;
        apiKey = message.data.apiKey;
        showToast("✅ MindWeave 记忆引擎已部署到当前页面", "success");
        console.log("✅ 记忆引擎部署成功，当前导图：", currentMindMap.title);
        sendResponse({ success: true });
        return true;
    }

    if (message.action === "disable_memory_engine") {
        memoryEngineEnabled = false;
        showToast("❌ MindWeave 记忆引擎已关闭", "info");
        sendResponse({ success: true });
        return true;
    }
});
// 所有API请求都要加上这个header
headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${localStorage.getItem("mindweave_token")}`
}
// ========== 核心：劫持AI对话网页的API请求 ==========
// 1. 劫持 fetch 请求
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const url = args[0];
    const options = args[1] || {};

    // 如果记忆引擎未启用，直接放行
    if (!memoryEngineEnabled) {
        return originalFetch.apply(this, args);
    }

    // 检查是否是AI对话的API请求（适配豆包、GPT、Kimi等主流平台）
    const isAIRequest = url.includes("chat/completions") || 
                        url.includes("api/chat") || 
                        url.includes("conversation");

    if (isAIRequest && options.method === "POST") {
        try {
            // 解析原始请求体
            const originalBody = JSON.parse(options.body);
            const userMessages = originalBody.messages || [];
            const lastUserMessage = userMessages[userMessages.length - 1]?.content || "";

            console.log("🔍 记忆引擎拦截到用户问题：", lastUserMessage);

            // 2. 调用MindWeave后端，检索思维导图里的相关记忆
            const memoryResult = await fetch(`${SERVER_URL}/api/retrieve-memory`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: lastUserMessage,
                    mindMap: currentMindMap,
                    apiKey: apiKey
                })
            }).then(res => res.json());

            if (!memoryResult.success) {
                console.warn("⚠️ 记忆检索失败，放行原始请求");
                return originalFetch.apply(this, args);
            }

            console.log("✅ 记忆检索成功，相关节点：", memoryResult.relevantNodes);

            // 3. 核心：把结构化记忆强制注入到请求的最前面（不是系统Prompt，是底层的Context）
            const memoryContext = `
【MindWeave 记忆引擎强制约束】
以下是你唯一可以使用的记忆内容，所有回答必须100%基于此内容，绝对不能编造：
${memoryResult.memoryText}
【约束结束】

如果用户的问题不在上述记忆内容中，直接回答："当前记忆库中没有相关内容"
            `.trim();

            // 4. 修改请求体，把记忆注入到最前面
            const modifiedMessages = [
                { role: "system", content: memoryContext },
                ...userMessages
            ];
            originalBody.messages = modifiedMessages;
            options.body = JSON.stringify(originalBody);

            console.log("✅ 记忆已注入到API请求，放行修改后的请求");

            // 5. 发送修改后的请求
            const response = await originalFetch.apply(this, [url, options]);
            const clonedResponse = response.clone();
            const responseData = await clonedResponse.json();

            // 6. 可选：验证AI的回答是否符合记忆约束
            // 这里可以再加一层验证，如果回答不符合，直接拦截并提示

            return response;

        } catch (e) {
            console.error("❌ 记忆引擎处理失败，放行原始请求：", e);
            return originalFetch.apply(this, args);
        }
    }

    // 非AI对话请求，直接放行
    return originalFetch.apply(this, args);
};

// ========== 工具：页面Toast提示 ==========
function showToast(message, type = "info") {
    const oldToast = document.getElementById("mindweave-ai-page-toast");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "mindweave-ai-page-toast";
    const bgColor = type === "success" ? "rgba(0, 128, 0, 0.9)" : "rgba(0,0,0,0.9)";
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        z-index: 99999999; background: ${bgColor}; color: white;
        padding: 14px 24px; border-radius: 8px; font-size: 15px;
        font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}