console.log("✅ MindWeave 内容捕获脚本已加载");

// ========== 工具：页面Toast提示 ==========
function showToast(message, type = "info") {
    const oldToast = document.getElementById("mindweave-toast");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "mindweave-toast";
    const bgColor = type === "success" ? "rgba(0, 128, 0, 0.8)" : type === "error" ? "rgba(255, 0, 0, 0.8)" : "rgba(0,0,0,0.8)";
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        background: ${bgColor}; color: white; padding: 12px 20px; border-radius: 8px;
        font-size: 14px; animation: fadeIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ========== 创建迷你工具栏 ==========
function createMiniToolbar() {
    const oldToolbar = document.getElementById("mindweave-toolbar");
    if (oldToolbar) oldToolbar.remove();

    const toolbar = document.createElement("div");
    toolbar.id = "mindweave-toolbar";
    toolbar.className = "mindweave-toolbar";
    toolbar.innerHTML = `
        <button id="mindweave-weave-btn" class="mindweave-toolbar-btn">
            🧠 编织到思维画布
        </button>
    `;
    document.body.appendChild(toolbar);

    // 绑定点击事件：全流程走background.js，真正调用apiAI
    document.getElementById("mindweave-weave-btn").addEventListener("click", async () => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (selectedText.length < 10) {
            showToast("请选中至少10个字的内容", "error");
            return;
        }

        // 1. 提示开始编织
        showToast("✅ 开始编织内容，正在调用apiAI处理...", "info");
        console.log("✅ 捕获到选中内容，开始调用apiAI");

        try {
            // 2. 向background.js发送消息，获取配置和当前导图
            const storageData = await chrome.runtime.sendMessage({
                action: "get_weave_config"
            });
            const apiKey = storageData?.mindweave_api_key;
            let currentMap = storageData?.mindweave_current_map;

            // 3. 校验配置
            if (!apiKey) {
                showToast("❌ 请先在插件首页配置API Key", "error");
                return;
            }
            // 如果没有当前导图，自动初始化空白导图
            if (!currentMap) {
                currentMap = {
                    template: "tree",
                    templateName: "树状图",
                    title: "我的知识体系",
                    nodes: [
                        {
                            node_id: "root",
                            parent_id: "",
                            topic: "我的知识体系",
                            level: 0,
                            x: 100,
                            y: 300,
                            keywords: [],
                            isCollapsed: false,
                            weight: 1.0,
                            memory_tag: "核心索引",
                            source: "默认创建"
                        }
                    ],
                    createTime: Date.now()
                };
            }

            // 4. 调用background.js转发apiAI请求
            const result = await chrome.runtime.sendMessage({
                action: "process_content_with_ai",
                data: {
                    content: selectedText,
                    mindMap: currentMap,
                    targetNodeId: "root",
                    apiKey: apiKey,
                    source: `${document.title} - ${window.location.href}`
                }
            });

            if (!result.success) {
                showToast(`❌ 编织失败：${result.error}`, "error");
                throw new Error(result.error);
            }

            // 5. 更新导图，保存到本地存储
            currentMap.nodes = [...currentMap.nodes, ...result.newNodes];
            await chrome.runtime.sendMessage({
                action: "update_current_map",
                data: currentMap
            });

            // 6. 成功提示
            showToast(`✅ 编织完成！已生成${result.newNodes.length}个节点`, "success");
            console.log("✅ apiAI处理完成，生成节点数：", result.newNodes.length);

            // 7. 自动打开侧边栏编辑器
            await chrome.runtime.sendMessage({
                action: "navigate",
                data: "editor.html"
            });

        } catch (e) {
            console.error("❌ 编织失败：", e);
            showToast(`❌ 编织失败：${e.message}`, "error");
        }

        // 隐藏工具栏，清除选中
        toolbar.style.display = "none";
        window.getSelection().removeAllRanges();
    });

    return toolbar;
}

// ========== 监听选中内容 ==========
document.addEventListener("mouseup", (e) => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    const toolbar = document.getElementById("mindweave-toolbar") || createMiniToolbar();

    if (selectedText.length >= 10) {
        // 定位工具栏
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        toolbar.style.left = `${rect.left + window.scrollX}px`;
        toolbar.style.top = `${rect.bottom + window.scrollY + 8}px`;
        toolbar.style.display = "flex";
    } else {
        toolbar.style.display = "none";
    }
});

// 点击空白隐藏工具栏
document.addEventListener("click", (e) => {
    const toolbar = document.getElementById("mindweave-toolbar");
    if (toolbar && !toolbar.contains(e.target)) {
        toolbar.style.display = "none";
    }
});