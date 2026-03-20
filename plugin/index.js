// ========== 全局变量 ==========
let selectedTemplate = "tree";
let token = localStorage.getItem("mindweave_token");
let currentUser = null;
const SERVER_URL = "http://localhost:3000";

// ========== 页面加载完成 ==========
document.addEventListener("DOMContentLoaded", async () => {
    console.log("✅ MindWeave 首页加载完成");
    // 检查登录状态
    if (token) {
        await checkLoginStatus();
    } else {
        showAuthContainer();
    }
    // 绑定所有事件
    bindAllEvents();
});

// ========== 检查登录状态 ==========
async function checkLoginStatus() {
    try {
        const response = await fetch(`${SERVER_URL}/api/auth/info`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            showMainContainer();
            updateUserInfo();
        } else {
            token = null;
            localStorage.removeItem("mindweave_token");
            showAuthContainer();
        }
    } catch (e) {
        console.error("检查登录状态失败：", e);
        showAuthContainer();
    }
}

// ========== 显示/隐藏容器 ==========
function showAuthContainer() {
    document.getElementById("auth-container").style.display = "block";
    document.getElementById("main-container").style.display = "none";
}

function showMainContainer() {
    document.getElementById("auth-container").style.display = "none";
    document.getElementById("main-container").style.display = "block";
}

// ========== 更新用户信息 ==========
function updateUserInfo() {
    const userInfoEl = document.getElementById("user-info");
    const usageTipEl = document.getElementById("usage-tip");
    if (currentUser.isVip) {
        userInfoEl.textContent = "VIP会员 | 无限次使用";
        usageTipEl.textContent = "VIP会员，无限次使用";
    } else {
        userInfoEl.textContent = "免费用户";
        usageTipEl.textContent = `免费剩余次数：${currentUser.freeTotal - currentUser.freeUsed}/${currentUser.freeTotal}`;
    }
}

// ========== 绑定所有事件 ==========
function bindAllEvents() {
    // ------------------------------
    // 认证相关
    // ------------------------------
    // 登录/注册标签切换
    document.getElementById("login-tab").addEventListener("click", () => {
        document.getElementById("login-tab").classList.remove("btn-secondary");
        document.getElementById("login-tab").classList.add("btn-primary");
        document.getElementById("register-tab").classList.remove("btn-primary");
        document.getElementById("register-tab").classList.add("btn-secondary");
        document.getElementById("login-form").style.display = "block";
        document.getElementById("register-form").style.display = "none";
    });

    document.getElementById("register-tab").addEventListener("click", () => {
        document.getElementById("register-tab").classList.remove("btn-secondary");
        document.getElementById("register-tab").classList.add("btn-primary");
        document.getElementById("login-tab").classList.remove("btn-primary");
        document.getElementById("login-tab").classList.add("btn-secondary");
        document.getElementById("register-form").style.display = "block";
        document.getElementById("login-form").style.display = "none";
    });

    // 登录
    document.getElementById("login-btn").addEventListener("click", async () => {
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value.trim();
        if (!email || !password) {
            alert("请输入邮箱和密码");
            return;
        }
        try {
            const response = await fetch(`${SERVER_URL}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (!data.success) {
                alert(data.error);
                return;
            }
            token = data.token;
            currentUser = data.user;
            localStorage.setItem("mindweave_token", token);
            showMainContainer();
            updateUserInfo();
            alert("✅ 登录成功");
        } catch (e) {
            alert("登录失败：" + e.message);
        }
    });

    // 注册
    document.getElementById("register-btn").addEventListener("click", async () => {
        const email = document.getElementById("register-email").value.trim();
        const password = document.getElementById("register-password").value.trim();
        const confirmPassword = document.getElementById("register-password-confirm").value.trim();
        if (!email || !password || !confirmPassword) {
            alert("请填写完整信息");
            return;
        }
        if (password !== confirmPassword) {
            alert("两次密码不一致");
            return;
        }
        try {
            const response = await fetch(`${SERVER_URL}/api/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            if (!data.success) {
                alert(data.error);
                return;
            }
            alert("✅ 注册成功，请登录");
            document.getElementById("login-tab").click();
        } catch (e) {
            alert("注册失败：" + e.message);
        }
    });

    // 退出登录
    document.getElementById("logout-btn").addEventListener("click", () => {
        token = null;
        currentUser = null;
        localStorage.removeItem("mindweave_token");
        showAuthContainer();
        alert("✅ 已退出登录");
    });

    // ------------------------------
    // 模板选择
    // ------------------------------
    const templateCards = document.querySelectorAll(".template-card");
    templateCards.forEach(card => {
        card.addEventListener("click", () => {
            templateCards.forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            selectedTemplate = card.getAttribute("data-template");
            console.log("✅ 选中模板：", selectedTemplate);
        });
    });

    // ------------------------------
    // 我的导图按钮
    // ------------------------------
    document.getElementById("my-maps-btn").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
            action: "navigate",
            data: "my-maps.html"
        });
    });

    // ------------------------------
    // 空白编辑按钮
    // ------------------------------
    document.getElementById("blank-edit-btn").addEventListener("click", async () => {
        if (!currentUser.isVip && currentUser.freeUsed >= currentUser.freeTotal) {
            alert("免费次数已用完，请开通VIP");
            return;
        }
        console.log("✅ 空白编辑，模板：", selectedTemplate);

        const templateNameMap = {
            tree: "树状图",
            flow: "流程图",
            bubble: "气泡图",
            fishbone: "鱼骨图"
        };

        const blankMap = {
            template: selectedTemplate,
            templateName: templateNameMap[selectedTemplate],
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
                    source: "手动创建"
                }
            ],
            createTime: Date.now()
        };

        try {
            await chrome.storage.local.set({
                mindweave_current_map: blankMap,
                mindweave_temp_content: null
            });
            await chrome.runtime.sendMessage({
                action: "navigate",
                data: "editor.html"
            });
        } catch (e) {
            alert("❌ 初始化失败：" + e.message);
        }
    });

    // ------------------------------
    // 读取当前网页按钮
    // ------------------------------
    document.getElementById("read-page-btn").addEventListener("click", async () => {
        if (!currentUser.isVip && currentUser.freeUsed >= currentUser.freeTotal) {
            alert("免费次数已用完，请开通VIP");
            return;
        }
        console.log("✅ 开始读取当前网页，模板：", selectedTemplate);

        try {
            const pageContent = await chrome.runtime.sendMessage({ 
                action: "get_current_page_content" 
            });
            if (!pageContent) {
                alert("❌ 读取网页内容失败");
                return;
            }
            console.log("✅ 网页内容读取成功，标题：", pageContent.title);

            const templateNameMap = {
                tree: "树状图",
                flow: "流程图",
                bubble: "气泡图",
                fishbone: "鱼骨图"
            };

            const initMap = {
                template: selectedTemplate,
                templateName: templateNameMap[selectedTemplate],
                title: pageContent.title,
                nodes: [
                    {
                        node_id: "root",
                        parent_id: "",
                        topic: pageContent.title,
                        level: 0,
                        x: 100,
                        y: 300,
                        keywords: [],
                        isCollapsed: false,
                        weight: 1.0,
                        memory_tag: "核心索引",
                        source: pageContent.url
                    }
                ],
                createTime: Date.now()
            };

            await chrome.storage.local.set({
                mindweave_temp_content: pageContent.content,
                mindweave_temp_source: `${pageContent.title} - ${pageContent.url}`,
                mindweave_current_map: initMap,
                mindweave_process_type: "read_page"
            });

            await chrome.runtime.sendMessage({
                action: "navigate",
                data: "editor.html"
            });

        } catch (e) {
            alert("❌ 读取网页失败：" + e.message);
        }
    });
}