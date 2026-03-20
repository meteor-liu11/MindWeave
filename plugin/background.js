// ========== 配置 ==========
const SERVER_URL = "http://localhost:3000";

// ========== 插件安装：安全初始化 ==========
chrome.runtime.onInstalled.addListener(async () => {
    // 1. 安全清空旧菜单
    try {
        await chrome.contextMenus.removeAll();
    } catch (e) {
        console.warn("清空旧菜单警告：", e);
    }

    // 2. 安全注册右键菜单
    try {
        chrome.contextMenus.create({
            id: "weave-to-mindmap",
            title: "编织到思维画布",
            contexts: ["selection"],
            documentUrlPatterns: ["<all_urls>"]
        });
        console.log("✅ 右键菜单注册成功");
    } catch (e) {
        console.error("右键菜单注册失败：", e);
    }

    // 3. 初始化默认存储
    try {
        await chrome.storage.local.set({
            mindweave_api_key: "",
            mindweave_my_maps: [],
            mindweave_current_map: null,
            mindweave_temp_content: null,
            mindweave_temp_source: null,
            mindweave_process_type: null // 标记处理类型：read_page/select_text
        });
        console.log("✅ 存储初始化成功");
    } catch (e) {
        console.error("存储初始化失败：", e);
    }
});

// ========== 点击插件图标：同步打开侧边栏（符合用户手势要求） ==========
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.open({ tabId: tab.id });
        console.log("✅ 侧边栏打开成功");
    } catch (e) {
        console.error("打开侧边栏失败：", e);
    }
});

// ========== 右键菜单点击事件：先同步打开侧边栏，再处理异步 ==========
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "weave-to-mindmap") return;
    const selectedText = info.selectionText.trim();
    if (selectedText.length < 10) return;

    console.log("✅ 捕获到选中内容：", selectedText.substring(0, 50));
    
    // 【关键修复】先同步打开侧边栏，符合Chrome用户手势要求
    try {
        await chrome.sidePanel.open({ tabId: tab.id });
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: "editor.html" });
    } catch (e) {
        console.error("打开侧边栏失败：", e);
        return;
    }

    // 再异步存储内容
    try {
        await chrome.storage.local.set({
            mindweave_temp_content: selectedText,
            mindweave_temp_source: `${tab.title} - ${tab.url}`,
            mindweave_process_type: "select_text"
        });
        console.log("✅ 选中内容已存储，等待画布处理");
    } catch (e) {
        console.error("存储选中内容失败：", e);
    }
});

// ========== 监听前端消息 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("收到前端消息：", message.action);

    // 页面跳转
    if (message.action === "navigate") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            try {
                await chrome.sidePanel.setOptions({
                    tabId: tabs[0].id,
                    path: message.data
                });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        });
        return true;
    }

    // 获取当前网页内容
    if (message.action === "get_current_page_content") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const [tab] = tabs;
            try {
                const result = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        return {
                            title: document.title,
                            url: window.location.href,
                            content: document.body.innerText.trim()
                        };
                    }
                });
                sendResponse(result[0].result);
            } catch (e) {
                console.error("获取网页内容失败：", e);
                sendResponse(null);
            }
        });
        return true;
    }

    // 处理内容（apiAI转发）
    if (message.action === "process_content_with_ai") {
        const { content, mindMap, targetNodeId, apiKey, source } = message.data;
        fetch(`${SERVER_URL}/api/process-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, mindMap, targetNodeId, apiKey, source })
        })
        .then(res => res.json())
        .then(result => sendResponse(result))
        .catch(e => {
            console.error("调用AI后端失败：", e);
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    // 生成记忆Prompt
    if (message.action === "generate_memory_prompt") {
        const { mindMap, targetNodeId, apiKey } = message.data;
        fetch(`${SERVER_URL}/api/generate-memory-prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mindMap, targetNodeId, apiKey })
        })
        .then(res => res.json())
        .then(result => sendResponse(result))
        .catch(e => {
            console.error("生成记忆失败：", e);
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }

    // 给content.js提供配置
    if (message.action === "get_weave_config") {
        chrome.storage.local.get([
            "mindweave_api_key",
            "mindweave_current_map"
        ], (res) => {
            sendResponse(res);
        });
        return true;
    }

    // 更新当前导图
    if (message.action === "update_current_map") {
        chrome.storage.local.set({
            mindweave_current_map: message.data
        }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    // 保存导图
    if (message.action === "save_map") {
        chrome.storage.local.get("mindweave_my_maps", (res) => {
            const myMaps = res.mindweave_my_maps || [];
            const newMap = {
                id: `map_${Date.now()}`,
                ...message.data,
                createTime: Date.now()
            };
            myMaps.unshift(newMap);
            chrome.storage.local.set({ mindweave_my_maps: myMaps }, () => {
                sendResponse({ success: true, id: newMap.id });
            });
        });
        return true;
    }
});