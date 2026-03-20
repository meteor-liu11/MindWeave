// ========== 全局变量 ==========
let currentMap = null;
let canvasOffset = { x: 0, y: 0 };
let canvasScale = 1;
let isDraggingCanvas = false;
let dragStart = { x: 0, y: 0 };
let selectedNodeId = null;
const SERVER_URL = "http://localhost:3000";

// ========== 页面加载完成 ==========
document.addEventListener("DOMContentLoaded", async () => {
    console.log("✅ 思维画布加载完成");
    
    try {
        const storageData = await chrome.storage.local.get([
            "mindweave_current_map",
            "mindweave_temp_content",
            "mindweave_temp_source"
        ]);
        
        currentMap = storageData.mindweave_current_map;
        
        if (!currentMap) {
            alert("❌ 未找到思维导图数据，请先创建导图");
            await chrome.runtime.sendMessage({ action: "navigate", data: "index.html" });
            return;
        }

        document.getElementById("map-title-input").value = currentMap.title;
        renderMindMap();

        // 处理临时内容
        if (storageData.mindweave_temp_content) {
            console.log("🔍 检测到临时内容，开始AI处理");
            const tempContent = storageData.mindweave_temp_content;
            const tempSource = storageData.mindweave_temp_source;
            
            await chrome.storage.local.remove([
                "mindweave_temp_content",
                "mindweave_temp_source"
            ]);

            await processContentWithProgress(tempContent, tempSource);
        }

    } catch (e) {
        console.error("初始化失败：", e);
        alert("❌ 初始化失败：" + e.message);
    }

    bindAllEvents();
});

// ========== 核心：带进度的AI处理（已加async，await合法） ==========
async function processContentWithProgress(content, source) {
    const progressContainer = document.getElementById("ai-progress-container");
    const progressBar = document.getElementById("progress-bar");
    const progressTitle = document.getElementById("progress-title");
    const progressDetail = document.getElementById("progress-detail");
    
    progressContainer.style.display = "block";
    progressBar.style.width = "0%";

    function updateProgress(percent, title, detail = "") {
        progressBar.style.width = `${percent}%`;
        progressTitle.textContent = title;
        progressDetail.textContent = detail;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    try {
        updateProgress(10, "正在初始化思维导图", "已获取当前知识体系");
        await sleep(100);

        updateProgress(20, "正在调用AI处理内容", "已发送请求，等待AI响应");
        const token = localStorage.getItem("mindweave_token");
        if (!token) {
            throw new Error("请先登录");
        }

        const result = await Promise.race([
            fetch(`${SERVER_URL}/api/process-content`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    content: content,
                    mindMap: currentMap,
                    targetNodeId: "root",
                    source: source || "网页内容"
                })
            }).then(res => res.json()),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error("请求超时，请检查网络和后端服务")), 15000)
            )
        ]);

        updateProgress(70, "AI处理完成", "正在生成结构化节点");
        await sleep(100);

        if (!result.success) {
            throw new Error(result.error || "AI处理失败");
        }

        updateProgress(85, "正在更新知识体系", `已生成${result.newNodes.length}个节点，正在合并到导图`);
        currentMap.nodes = [...currentMap.nodes, ...result.newNodes];
        await chrome.storage.local.set({ mindweave_current_map: currentMap });
        await sleep(100);

        updateProgress(100, "处理完成", "正在渲染思维导图");
        await sleep(200);
        renderMindMap();

        setTimeout(() => {
            progressContainer.style.display = "none";
        }, 500);

        alert(`✅ 处理完成！已生成${result.newNodes.length}个节点`);

    } catch (e) {
        console.error("AI处理失败：", e);
        progressContainer.style.display = "none";
        alert(`❌ 处理失败：${e.message}`);
    }
}

// ========== 渲染思维导图 ==========
function renderMindMap() {
    const canvas = document.getElementById("mindmap-canvas");
    const svg = document.getElementById("connections-svg");
    
    canvas.innerHTML = "";
    svg.innerHTML = "";

    canvas.style.width = "4000px";
    canvas.style.height = "4000px";
    svg.style.width = "4000px";
    svg.style.height = "4000px";

    canvas.style.transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`;
    svg.style.transform = `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`;

    currentMap.nodes.forEach(node => {
        if (node.parent_id) {
            const parentNode = currentMap.nodes.find(n => n.node_id === node.parent_id);
            if (parentNode) {
                drawConnection(svg, parentNode, node);
            }
        }
    });

    currentMap.nodes.forEach(node => {
        const nodeEl = createNodeElement(node);
        canvas.appendChild(nodeEl);
    });
}

// ========== 创建节点元素 ==========
function createNodeElement(node) {
    const el = document.createElement("div");
    el.className = `mindmap-node level-${node.level}${node.isCollapsed ? " collapsed" : ""}${selectedNodeId === node.node_id ? " selected" : ""}`;
    el.id = `node-${node.node_id}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    
    el.innerHTML = `
        <div class="node-content">
            <div class="node-topic">${node.topic}</div>
            ${node.keywords && node.keywords.length > 0 ? `<div class="node-keywords">${node.keywords.join(", ")}</div>` : ""}
        </div>
        ${node.level < 3 ? `<div class="collapse-btn" data-node-id="${node.node_id}"><i class="ri-${node.isCollapsed ? "add" : "subtract"}-line"></i></div>` : ""}
    `;

    el.addEventListener("click", (e) => {
        if (e.target.closest(".collapse-btn")) return;
        selectNode(node.node_id);
    });

    el.addEventListener("dblclick", () => {
        openNodePanel(node);
    });

    const collapseBtn = el.querySelector(".collapse-btn");
    if (collapseBtn) {
        collapseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleNodeCollapse(node.node_id);
        });
    }

    return el;
}

// ========== 画连接线 ==========
function drawConnection(svg, parentNode, childNode) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    
    const x1 = parentNode.x + 200;
    const y1 = parentNode.y + 40;
    const x2 = childNode.x;
    const y2 = childNode.y + 40;
    const cp1x = x1 + (x2 - x1) / 2;
    const cp1y = y1;
    const cp2x = x1 + (x2 - x1) / 2;
    const cp2y = y2;

    line.setAttribute("d", `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
    line.setAttribute("stroke", "#63799B");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("fill", "none");
    line.setAttribute("class", "connection-line");

    svg.appendChild(line);
}

// ========== 节点操作函数 ==========
function selectNode(nodeId) {
    selectedNodeId = nodeId;
    document.querySelectorAll(".mindmap-node").forEach(el => el.classList.remove("selected"));
    const selectedEl = document.getElementById(`node-${nodeId}`);
    if (selectedEl) selectedEl.classList.add("selected");
}

function toggleNodeCollapse(nodeId) {
    const node = currentMap.nodes.find(n => n.node_id === nodeId);
    if (node) {
        node.isCollapsed = !node.isCollapsed;
        renderMindMap();
    }
}

function openNodePanel(node) {
    const panel = document.getElementById("node-panel");
    document.getElementById("node-topic-input").value = node.topic;
    document.getElementById("node-keywords-input").value = (node.keywords || []).join(", ");
    panel.style.display = "block";
    selectedNodeId = node.node_id;
}

// ========== 绑定所有事件（所有带await的回调都加了async） ==========
function bindAllEvents() {
    // 返回按钮
    document.getElementById("back-btn").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ action: "navigate", data: "index.html" });
    });

    // 保存按钮
    document.getElementById("save-btn").addEventListener("click", async () => {
        currentMap.title = document.getElementById("map-title-input").value;
        await chrome.storage.local.set({ mindweave_current_map: currentMap });
        alert("✅ 导图已保存");
    });

    // 缩放控制
    document.getElementById("zoom-in-btn").addEventListener("click", () => {
        canvasScale = Math.min(canvasScale * 1.2, 3);
        renderMindMap();
    });

    document.getElementById("zoom-out-btn").addEventListener("click", () => {
        canvasScale = Math.max(canvasScale / 1.2, 0.3);
        renderMindMap();
    });

    document.getElementById("reset-view-btn").addEventListener("click", () => {
        canvasScale = 1;
        canvasOffset = { x: 0, y: 0 };
        renderMindMap();
    });

    // 画布拖拽
    const container = document.getElementById("canvas-container");
    container.addEventListener("mousedown", (e) => {
        if (e.target.closest(".mindmap-node") || e.target.closest(".node-panel")) return;
        isDraggingCanvas = true;
        dragStart = { x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y };
        container.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDraggingCanvas) return;
        canvasOffset.x = e.clientX - dragStart.x;
        canvasOffset.y = e.clientY - dragStart.y;
        renderMindMap();
    });

    document.addEventListener("mouseup", () => {
        isDraggingCanvas = false;
        document.getElementById("canvas-container").style.cursor = "grab";
    });

    // 节点面板事件
    document.getElementById("close-panel-btn").addEventListener("click", () => {
        document.getElementById("node-panel").style.display = "none";
    });

    document.getElementById("save-node-btn").addEventListener("click", async () => {
        const node = currentMap.nodes.find(n => n.node_id === selectedNodeId);
        if (node) {
            node.topic = document.getElementById("node-topic-input").value;
            node.keywords = document.getElementById("node-keywords-input").value.split(",").map(k => k.trim()).filter(k => k);
            renderMindMap();
            document.getElementById("node-panel").style.display = "none";
            await chrome.storage.local.set({ mindweave_current_map: currentMap });
        }
    });

    document.getElementById("delete-node-btn").addEventListener("click", async () => {
        if (!confirm("确定要删除这个节点及其所有子节点吗？")) return;
        
        function deleteNodeRecursive(nodeId) {
            const children = currentMap.nodes.filter(n => n.parent_id === nodeId);
            children.forEach(child => deleteNodeRecursive(child.node_id));
            currentMap.nodes = currentMap.nodes.filter(n => n.node_id !== nodeId);
        }
        
        deleteNodeRecursive(selectedNodeId);
        selectedNodeId = null;
        renderMindMap();
        document.getElementById("node-panel").style.display = "none";
        await chrome.storage.local.set({ mindweave_current_map: currentMap });
    });

    // 生成记忆Prompt按钮
    document.getElementById("generate-memory-btn").addEventListener("click", async () => {
        try {
            const token = localStorage.getItem("mindweave_token");
            if (!token) throw new Error("请先登录");

            const response = await fetch(`${SERVER_URL}/api/generate-memory-prompt`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ mindMap: currentMap })
            }).then(res => res.json());

            if (!response.success) throw new Error(response.error);
            
            await navigator.clipboard.writeText(response.memoryPrompt);
            alert("✅ 记忆Prompt已生成并复制到剪贴板");
        } catch (e) {
            alert("❌ 生成失败：" + e.message);
        }
    });

    // 部署记忆引擎按钮
    document.getElementById("deploy-memory-btn").addEventListener("click", async () => {
        try {
            const token = localStorage.getItem("mindweave_token");
            if (!token) throw new Error("请先登录");

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, {
                action: "deploy_memory_engine",
                data: { mindMap: currentMap, apiKey: token }
            });

            alert("✅ 记忆引擎已部署到当前页面");
        } catch (e) {
            alert("❌ 部署失败：" + e.message);
        }
    });
}