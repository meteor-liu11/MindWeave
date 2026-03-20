document.getElementById("open-sidebar-btn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
});

document.getElementById("open-editor-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: "editor.html" });
    window.close();
});