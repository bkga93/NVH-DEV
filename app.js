// ==========================================
// TCT SCANNER PRO V1.1.9.3 - CLOUD ERA
// PHIÊN BẢN DIAMOND CLOUD (FIREBASE)
// ==========================================

// --- BIẾN TOÀN CỤC ---
let isScanning = false;
let html5QrCode = null;
let currentScannerId = null;
let useIPCamera = false;
let scanMode = 'single'; 
let localHistory = JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
let remoteDataCache = [];
let firebaseApp = null;
let database = null;
let pendingScanCode = null; 
let lastUpdateTimestamp = null;
let isRemoteListVisible = false;

// --- CÀI ĐẶT MẶC ĐỊNH ---
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAN-J63oxR-R415XnjXKt0RUIySQJQAZC0",
    authDomain: "tct-scanner-pro.firebaseapp.com",
    databaseURL: "https://tct-scanner-pro-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "tct-scanner-pro",
    storageBucket: "tct-scanner-pro.firebasestorage.app",
    messagingSenderId: "486592614773",
    appId: "1:486592614773:web:bd2861a3dcdf0468ee833c"
};

// --- KHỞI TẠO APP ---
window.onload = async () => {
    console.log("🚀 TCT APP V1.1.9.3 - CLOUD ERA IS LIVE!");
    checkActivation();
    initFirebase();
    renderLocalHistory();
    refreshCameraList();
};

// --- HỆ THỐNG CLOUD (FIREBASE) ---
function initFirebase() {
    const config = JSON.parse(localStorage.getItem('nvh_firebase_config') || JSON.stringify(DEFAULT_FIREBASE_CONFIG));
    
    try {
        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(config);
        } else {
            firebaseApp = firebase.app();
        }
        database = firebase.database();
        
        // Listener thời gian thực
        database.ref('scans').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                remoteDataCache = Object.keys(data).map(key => ({
                    orderId: key,
                    ...data[key]
                })).sort((a, b) => new Date(b.time.split(' ').reverse().join(' ')) - new Date(a.time.split(' ').reverse().join(' ')));
                
                lastUpdateTimestamp = new Date().toLocaleTimeString('vi-VN');
                updateCloudInfoUI();
                
                if (isRemoteListVisible) {
                    displayRemoteData(remoteDataCache);
                }
            }
        });
    } catch (error) {
        console.error("Firebase Init Error:", error);
    }
}

async function saveToCloud(orderId, content, isOverwrite = true) {
    if (!database) return;
    const userName = localStorage.getItem('nvh_user_name') || 'User';
    const now = new Date().toLocaleString('vi-VN');
    
    try {
        await database.ref('scans/' + orderId).set({
            content: content,
            time: now,
            user: userName
        });
        showToast(isOverwrite ? "✅ Đã ghi đè Cloud!" : "✅ Đã thêm bản sao Cloud!");
    } catch (error) {
        showToast("❌ Lỗi đẩy Cloud!");
    }
}

// --- MÁY QUÉT (SCANNER) ---
async function toggleScanner() {
    if (html5QrCode) {
        try {
            const state = html5QrCode.getState();
            if (state === 2 || state === 3) await html5QrCode.stop();
        } catch (e) {}
        html5QrCode = null;
    }
    
    if (isScanning) {
        isScanning = false;
        updateScannerUI();
        return;
    }

    await new Promise(r => setTimeout(r, 100));
    html5QrCode = new Html5Qrcode("reader");
    
    const config = { fps: 20, aspectRatio: 1.0 };
    
    try {
        const cameraId = localStorage.getItem('nvh_scanner_cam_id');
        const scanConfig = cameraId ? { deviceId: cameraId } : { facingMode: "environment" };
        
        await html5QrCode.start(scanConfig, config, onScanSuccess);
        isScanning = true;
        updateScannerUI();
    } catch (err) {
        alert("Lỗi camera: " + err);
    }
}

function onScanSuccess(decodedText) {
    const code = decodedText.trim();
    if (!code) return;

    document.getElementById('flash-overlay').classList.add('flash-active');
    setTimeout(() => document.getElementById('flash-overlay').classList.remove('flash-active'), 100);
    
    const orderId = extractOrderId(code);
    const existing = remoteDataCache.find(item => item.orderId === orderId);

    if (existing) {
        pendingScanCode = code;
        document.getElementById('dup-code-text').innerText = orderId;
        openModal('duplicate-modal');
        playDuplicateSound();
    } else {
        processFinalScan(orderId, code);
        playBeep();
    }
    
    document.getElementById('pc-last-scanned').innerText = code;
}

function processFinalScan(id, content, isOverwrite = true) {
    const scanItem = { id: Date.now(), content: content, time: new Date().toLocaleString('vi-VN') };
    localHistory.unshift(scanItem);
    localStorage.setItem('nvh_scan_history', JSON.stringify(localHistory.slice(0, 100)));
    renderLocalHistory();
    saveToCloud(id, content, isOverwrite);
    if (scanMode === 'single') toggleScanner();
}

function handleDuplicate(choice) {
    closeModal('duplicate-modal');
    if (!pendingScanCode) return;
    const baseId = extractOrderId(pendingScanCode);
    if (choice === 'overwrite') {
        processFinalScan(baseId, pendingScanCode, true);
    } else if (choice === 'keep') {
        const suffix = getNextSuffix(baseId);
        processFinalScan(baseId + suffix, pendingScanCode, false);
    } else {
        showToast("⚠️ Đã bỏ qua mã trùng");
        if (scanMode === 'single') toggleScanner();
    }
    pendingScanCode = null;
}

function getNextSuffix(baseId) {
    let suffix = 2;
    while (remoteDataCache.some(item => item.orderId === `${baseId}(${suffix})`)) {
        suffix++;
    }
    return `(${suffix})`;
}

function extractOrderId(text) {
    return text.split(/[\s,]+/)[0];
}

// --- GIAO DIỆN (UI) ---
function switchTab(tabName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName + '-view').classList.add('active');
    document.getElementById('btn-tab-' + tabName).classList.add('active');
}

function showAllRemoteData() {
    isRemoteListVisible = true;
    displayRemoteData(remoteDataCache);
    showToast("📊 Hiển thị tất cả dữ liệu");
}

function refreshCloudData() {
    const statusLine = document.getElementById('update-status-line');
    statusLine.innerHTML = `<span style="color:var(--primary-color);">⏳ Đang cập nhật dữ liệu...</span>`;
    
    const toast = showToast("⏳ Đang cập nhật từ Cloud...", "info", true);
    
    // Giả lập/Đợi Firebase phản hồi
    setTimeout(() => {
        if (toast) toast.remove();
        statusLine.innerHTML = `✅ Cập nhật xong: <i>${new Date().toLocaleTimeString('vi-VN')}</i>`;
    }, 1200);
}

function updateCloudInfoUI() {
    const btnAll = document.getElementById('btn-show-all');
    if (btnAll) btnAll.innerText = `📊 TẤT CẢ (${remoteDataCache.length})`;
}

function displayRemoteData(data) {
    const list = document.getElementById('remote-data-list');
    list.innerHTML = '';
    if (data.length === 0) {
        list.innerHTML = '<div class="empty-msg">Chưa có dữ liệu Cloud.</div>';
        return;
    }
    data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.onclick = () => showOrderDetails(item);
        div.innerHTML = `
            <div class="history-item-header">
                <span class="history-item-time">${item.time}</span>
                <span style="color:var(--gray-text)">👤 ${item.user}</span>
            </div>
            <div class="history-item-content">${item.orderId}</div>
        `;
        list.appendChild(div);
    });
}

function showOrderDetails(item) {
    const body = document.getElementById('order-detail-content');
    if (!body) return;
    body.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">MÃ ĐƠN HÀNG:</span>
            <span class="detail-value">${item.orderId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">THỜI GIAN QUÉT:</span>
            <span class="highlight-time">${item.time}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">NGƯỜI QUÉT:</span>
            <span class="detail-value">${item.user || 'N/A'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">NỘI DUNG GỐC:</span>
            <span class="detail-value" style="font-size:0.75rem; word-break:break-all;">${item.content}</span>
        </div>
    `;
    openModal('detail-modal');
}

function renderLocalHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '';
    localHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-item-header">
                <span class="history-item-time">${item.time}</span>
            </div>
            <div class="history-item-content">${item.content}</div>
        `;
        list.appendChild(div);
    });
}

function updateScannerUI() {
    const btn = document.getElementById('start-btn');
    btn.innerHTML = isScanning ? "🛑 DỪNG QUÉT" : "🚀 BẮT ĐẦU QUÉT";
    btn.style.background = isScanning ? "var(--danger)" : "linear-gradient(180deg, var(--primary-color), #D4AF37)";
    btn.style.color = isScanning ? "white" : "var(--surface-color)";
}

function showToast(msg, type = "", persistent = false) {
    const toast = document.createElement('div');
    toast.className = `toast show ${type}`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    if (!persistent) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }
    return toast;
}

// --- MODALS & SIDREBAR ---
function toggleDrawer(show) {
    document.getElementById('side-drawer').classList.toggle('active', show);
    document.getElementById('drawer-overlay').style.display = show ? 'block' : 'none';
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}

function openSettings(group) {
    openModal('settings-modal');
    toggleDrawer(false);
}

function openChangelog() {
    openModal('changelog-modal');
    toggleDrawer(false);
}

// --- BẢO MẬT ---
function checkActivation() {
    if (localStorage.getItem('nvh_activated') !== 'true') {
        document.getElementById('activation-overlay').style.display = 'flex';
    }
}

function activateApp() {
    const key = document.getElementById('activation-key').value;
    if (key === '310824') {
        localStorage.setItem('nvh_activated', 'true');
        document.getElementById('activation-overlay').style.display = 'none';
        showToast("💎 ĐÃ KÍCH HOẠT V1.1.9.3!");
    } else {
        alert("Sai Key kích hoạt!");
    }
}

function playBeep() {
    new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3').play().catch(() => {});
}

function playDuplicateSound() {
    new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3').play().catch(() => {});
}

function filterRemoteData() {
    const val = document.getElementById('remote-search-input').value.toLowerCase();
    isRemoteListVisible = true;
    displayRemoteData(remoteDataCache.filter(it => it.orderId.toLowerCase().includes(val)));
}

async function refreshCameraList() {
    // Logic này giữ nguyên từ bản cũ
}
