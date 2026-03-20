// ========== 页面加载完成 ==========
document.addEventListener("DOMContentLoaded", async () => {
    console.log("✅ 我的导图页面加载完成");
    await loadMapList();
    bindEvents();
});

// ========== 加载导图列表 ==========
async function loadMapList() {
    const mapListEl = document.getElementById("map-list");
    try {
        const storageData = await chrome.storage.local.get("mindweave_my_maps");
        const myMaps = storageData.mindweave_my_maps || [];

        if (myMaps.length === 0) {
            mapListEl.innerHTML = `
                <div style="text-align: center; padding: 40px 0; color: #999;">
                    <p>你还没有保存任何导图</p>
                    <p style="font-size: 12px; margin-top: 8px;">快去首页创建你的第一个导图吧</p>
                </div>
            `;
            return;
        }

        // 生成列表
        let html = "";
        myMaps.forEach(map => {
            const createTime = new Date(map.createTime).toLocaleString();
            html += `
                <div class="map-item" data-map-id="${map.id}">
                    <div class="map-item-info">
                        <h4>${map.title}</h4>
                        <p>${map.templateName} | 创建于 ${createTime}</p>
                    </div>
                    <div class="map-item-actions">
                        <button class="btn btn-primary edit-btn">编辑</button>
                        <button class="btn btn-danger delete-btn">删除</button>
                    </div>
                </div>
            `;
        });
        mapListEl.innerHTML = html;

        // 绑定按钮事件
        bindMapItemEvents(myMaps);

    } catch (e) {
        mapListEl.innerHTML = `
            <div style="text-align: center; padding: 40px 0; color: #ff4d4f;">
                <p>加载失败：${e.message}</p>
            </div>
        `;
    }
}

// ========== 绑定事件 ==========
function bindEvents() {
    // 返回按钮
    document.getElementById("back-btn").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
            action: "navigate",
            data: "index.html"
        });
    });
}

// ========== 绑定导图项事件 ==========
function bindMapItemEvents(myMaps) {
    // 编辑按钮
    document.querySelectorAll(".edit-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const mapItem = e.target.closest(".map-item");
            const mapId = mapItem.getAttribute("data-map-id");
            const targetMap = myMaps.find(m => m.id === mapId);
            if (!targetMap) return;

            try {
                // 保存当前导图
                await chrome.storage.local.set({
                    mindweave_current_map: targetMap
                });
                // 跳转到编辑器
                await chrome.runtime.sendMessage({
                    action: "navigate",
                    data: "editor.html"
                });
            } catch (e) {
                alert("❌ 打开失败：" + e.message);
            }
        });
    });

    // 删除按钮
    document.querySelectorAll(".delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const mapItem = e.target.closest(".map-item");
            const mapId = mapItem.getAttribute("data-map-id");
            if (!confirm("确定要删除这个导图吗？")) return;

            try {
                const storageData = await chrome.storage.local.get("mindweave_my_maps");
                const myMaps = storageData.mindweave_my_maps || [];
                const newMaps = myMaps.filter(m => m.id !== mapId);
                await chrome.storage.local.set({ mindweave_my_maps: newMaps });
                await loadMapList();
            } catch (e) {
                alert("❌ 删除失败：" + e.message);
            }
        });
    });
}