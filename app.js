// ==========================================
// TCT SCANNER PRO V1.1.9.5 - CLOUD ERA
// PHIÊN BẢN DIAMOND CLOUD (FIREBASE)
// ==========================================

// --- BIẾN TOÀN CỤC ---
let isScanning = false;
let html5QrCode = null;
let scanMode = 'single'; 
let localHistory = JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
let remoteDataCache = [];
let firebaseApp = null;
let database = null;
let pendingScanCode = null; 
let lastUpdateTimestamp = null;
let isRemoteListVisible = false;

// --- CÀI ĐẶT NGƯỜI DÙNG ---
const settings = {
    userName: localStorage.getItem('nvh_user_name') || 'Admin',
    beepType: localStorage.getItem('nvh_beep_type') || 'default',
    vibrate: localStorage.getItem('nvh_vibrate') === 'true',
    theme: localStorage.getItem('nvh_theme') || 'plum-gold',
    fontSize: localStorage.getItem('nvh_font_size') || '100',
    firebase: JSON.parse(localStorage.getItem('nvh_firebase_config') || 'null')
};

const BEEP_SOUNDS = {
    default: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
    modern: 'https://assets.mixkit.co/active_storage/sfx/438/438-preview.mp3',
    cyber: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
    sharp: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3',
    gentle: 'https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3',
    // V1.1.9.5 Expanded Sounds
    laser: 'https://assets.mixkit.co/active_storage/sfx/1612/1612-preview.mp3',
    robot: 'https://assets.mixkit.co/active_storage/sfx/2387/2387-preview.mp3',
    ting: 'https://assets.mixkit.co/active_storage/sfx/2753/2753-preview.mp3',
    success: 'https://assets.mixkit.co/active_storage/sfx/2188/2188-preview.mp3',
    cash: 'https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3',
    pulse: 'https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3',
    pop: 'https://assets.mixkit.co/active_storage/sfx/1613/1613-preview.mp3',
    chime: 'https://assets.mixkit.co/active_storage/sfx/2185/2185-preview.mp3',
    magic: 'https://assets.mixkit.co/active_storage/sfx/1110/1110-preview.mp3',
    warning: 'https://assets.mixkit.co/active_storage/sfx/997/997-preview.mp3'
};

// --- KHỞI TẠO APP ---
window.onload = async () => {
    console.log("🚀 TCT APP V1.1.9.5 - CLOUD ERA IS LIVE!");
    applyTheme(settings.theme);
    applyFontSize(settings.fontSize);
    checkActivation();
    initFirebase();
    renderLocalHistory();
};

// --- HỆ THỐNG CLOUD (FIREBASE) ---
function initFirebase() {
    const config = settings.firebase || {
        apiKey: "AIzaSyAN-J63oxR-R415XnjXKt0RUIySQJQAZC0",
        authDomain: "tct-scanner-pro.firebaseapp.com",
        databaseURL: "https://tct-scanner-pro-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "tct-scanner-pro",
        storageBucket: "tct-scanner-pro.firebasestorage.app",
        messagingSenderId: "486592614773",
        appId: "1:486592614773:web:bd2861a3dcdf0468ee833c"
    };
    
    try {
        if (!firebase.apps.length) firebase.initializeApp(config);
        database = firebase.database();
        database.ref('scans').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                remoteDataCache = Object.keys(data).map(key => ({
                    orderId: key,
                    ...data[key]
                })).sort((a, b) => new Date(b.time.split(' ').reverse().join(' ')) - new Date(a.time.split(' ').reverse().join(' ')));
                updateCloudInfoUI();
                if (isRemoteListVisible) displayRemoteData(remoteDataCache);
            }
        });
    } catch (e) { console.error("Firebase Sync Error"); }
}

async function saveToCloud(orderId, content, isOverwrite = true) {
    if (!database) return;
    const now = new Date().toLocaleString('vi-VN');
    try {
        await database.ref('scans/' + orderId).set({
            content: content,
            time: now,
            user: settings.userName
        });
        showToast(isOverwrite ? "✅ Đã ghi đè Cloud!" : "✅ Đã thêm bản sao Cloud!");
    } catch (e) { showToast("❌ Lỗi đẩy Cloud!"); }
}

// --- MÁY QUÉT (SCANNER) ---
async function toggleScanner() {
    if (html5QrCode) {
        try { if (html5QrCode.getState() > 1) await html5QrCode.stop(); } catch (e) {}
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
    } catch (err) { alert("Lỗi camera: " + err); }
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
        if (settings.vibrate) navigator.vibrate(200);
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
    while (remoteDataCache.some(item => item.orderId === `${baseId}(${suffix})`)) suffix++;
    return `(${suffix})`;
}

function extractOrderId(text) { return text.split(/[\s,]+/)[0]; }

// --- GIAO DIỆN & TABS ---
function switchTab(tabName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabName + '-view').classList.add('active');
    document.getElementById('btn-tab-' + tabName).classList.add('active');
}

function showAllRemoteData() {
    isRemoteListVisible = true;
    displayRemoteData(remoteDataCache);
}

function refreshCloudData() {
    const statusLine = document.getElementById('update-status-line');
    statusLine.innerHTML = `<span style="color:var(--primary-color);">⏳ Đang cập nhật...</span>`;
    const toast = showToast("⏳ Đang đồng bộ...", "info", true);
    setTimeout(() => {
        if (toast) toast.remove();
        statusLine.innerHTML = `✅ Cập nhật xong: <i>${new Date().toLocaleTimeString('vi-VN')}</i>`;
        updateCloudInfoUI();
    }, 1500);
}

function updateCloudInfoUI() {
    const btnAll = document.getElementById('btn-show-all');
    if (btnAll) btnAll.innerText = `📊 TẤT CẢ (${remoteDataCache.length})`;
}

function displayRemoteData(data) {
    const list = document.getElementById('remote-data-list');
    list.innerHTML = '';
    if (data.length === 0) { list.innerHTML = '<div class="empty-msg">Trống</div>'; return; }
    data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.onclick = () => showOrderDetails(item);
        div.innerHTML = `<div class="history-item-header"><span>${item.time}</span><span>👤 ${item.user}</span></div><div class="history-item-content">${item.orderId}</div>`;
        list.appendChild(div);
    });
}

function showOrderDetails(item) {
    const body = document.getElementById('order-detail-content');
    body.innerHTML = `
        <div class="detail-row"><span class="detail-label">MÃ ĐƠN HÀNG:</span><span class="detail-value">${item.orderId}</span></div>
        <div class="detail-row"><span class="detail-label">THỜI GIAN:</span><span class="highlight-time">${item.time}</span></div>
        <div class="detail-row"><span class="detail-label">NGƯỜI QUÉT:</span><span class="detail-value">${item.user || 'Admin'}</span></div>
        <div class="detail-row"><span class="detail-label">NỘI DUNG:</span><span class="detail-value" style="font-size:0.75rem;">${item.content}</span></div>
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
        div.innerHTML = `<div class="history-item-header"><span>${item.time}</span></div><div class="history-item-content">${item.content}</div>`;
        list.appendChild(div);
    });
}

function updateScannerUI() {
    const btn = document.getElementById('start-btn');
    btn.innerHTML = isScanning ? "🛑 DỪNG QUÉT" : "🚀 BẮT ĐẦU QUÉT";
    btn.style.background = isScanning ? "var(--danger)" : "linear-gradient(180deg, var(--primary-color), #D4AF37)";
    btn.style.color = isScanning ? "white" : "var(--surface-color)";
}

// --- CÀI ĐẶT (SETTINGS) v1.1.9.5 ---
let currentSettingsGroup = '';
function openSettings(group) {
    currentSettingsGroup = group;
    const title = document.getElementById('settings-title');
    const body = document.getElementById('settings-body');
    body.innerHTML = '';
    
    switch(group) {
        case 'audio':
            title.innerText = "KHO ÂM THANH & RUNG";
            let soundOptions = '';
            Object.keys(BEEP_SOUNDS).forEach(key => {
                soundOptions += `<option value="${key}" ${settings.beepType===key?'selected':''}>${key.toUpperCase()}</option>`;
            });
            body.innerHTML = `
                <div class="settings-group">
                    <label class="settings-label">Kiểu tiếng bíp (Pullbox):</label>
                    <select id="set-beep-type" class="settings-select">
                        ${soundOptions}
                    </select>
                </div>
                <div class="toggle-container">
                    <span>Rung khi thành công:</span>
                    <label class="switch"><input type="checkbox" id="set-vibrate" ${settings.vibrate?'checked':''}><span class="slider"></span></label>
                </div>
                <button class="pc-action-btn" style="margin-top:20px; padding:15px; font-size:1rem;" onclick="testBeep()">🔊 NGHE THỬ</button>
            `;
            break;
        case 'user':
            title.innerText = "THÔNG TIN CÁ NHÂN";
            body.innerHTML = `
                <div class="settings-group">
                    <label class="settings-label">Tên người vận hành:</label>
                    <input type="text" id="set-user-name" class="settings-input" value="${settings.userName}" placeholder="Nhập tên bác...">
                </div>
            `;
            break;
        case 'display':
            title.innerText = "GIAO DIỆN & HIỂN THỊ";
            body.innerHTML = `
                <div class="settings-group">
                    <label class="settings-label">Bộ màu chủ đề (Theme):</label>
                    <select id="set-theme" class="settings-select">
                        <optgroup label="Của Tối (Dark)">
                            <option value="plum-gold" ${settings.theme==='plum-gold'?'selected':''}>Tím Gold (Gốc)</option>
                            <option value="midnight" ${settings.theme==='midnight'?'selected':''}>Midnight Cyan</option>
                            <option value="ruby" ${settings.theme==='ruby'?'selected':''}>Onyx Ruby</option>
                            <option value="emerald" ${settings.theme==='emerald'?'selected':''}>Forest Emerald</option>
                            <option value="silver" ${settings.theme==='silver'?'selected':''}>Slate Silver</option>
                        </optgroup>
                        <optgroup label="Cửa Sáng (Light)">
                            <option value="light-blue" ${settings.theme==='light-blue'?'selected':''}>Trắng Blue</option>
                            <option value="light-sepia" ${settings.theme==='light-sepia'?'selected':''}>Kem Sepia</option>
                            <option value="light-lavender" ${settings.theme==='light-lavender'?'selected':''}>Oải hương</option>
                            <option value="light-sky" ${settings.theme==='light-sky'?'selected':''}>Bầu trời</option>
                        </optgroup>
                    </select>
                </div>
                <div class="settings-group">
                    <label class="settings-label">Độ lớn chữ (%):</label>
                    <input type="range" id="set-font-size" min="80" max="150" value="${settings.fontSize}" style="width:100%">
                    <div style="text-align:right; font-size:0.75rem;">${settings.fontSize}%</div>
                </div>
            `;
            break;
    }
    
    openModal('settings-modal');
    toggleDrawer(false);
}

function saveSettings() {
    if (currentSettingsGroup === 'audio') {
        settings.beepType = document.getElementById('set-beep-type').value;
        settings.vibrate = document.getElementById('set-vibrate').checked;
        localStorage.setItem('nvh_beep_type', settings.beepType);
        localStorage.setItem('nvh_vibrate', settings.vibrate);
    } else if (currentSettingsGroup === 'user') {
        settings.userName = document.getElementById('set-user-name').value || 'Admin';
        localStorage.setItem('nvh_user_name', settings.userName);
    } else if (currentSettingsGroup === 'display') {
        settings.theme = document.getElementById('set-theme').value;
        settings.fontSize = document.getElementById('set-font-size').value;
        localStorage.setItem('nvh_theme', settings.theme);
        localStorage.setItem('nvh_font_size', settings.fontSize);
        applyTheme(settings.theme);
        applyFontSize(settings.fontSize);
    }
    showToast("💾 Lưu thành công!");
    closeModal('settings-modal');
}

function applyTheme(t) { document.body.dataset.theme = t; }
function applyFontSize(s) { document.documentElement.style.fontSize = (s / 100) * 16 + 'px'; }

function testBeep() {
    const type = document.getElementById('set-beep-type').value;
    new Audio(BEEP_SOUNDS[type]).play().catch(()=>{});
}

function playBeep() { new Audio(BEEP_SOUNDS[settings.beepType] || BEEP_SOUNDS.default).play().catch(()=>{}); }
function playDuplicateSound() { new Audio(BEEP_SOUNDS.cyber).play().catch(()=>{}); }

// --- KHÁC ---
function toggleDrawer(show) {
    document.getElementById('side-drawer').classList.toggle('active', show);
    document.getElementById('drawer-overlay').style.display = show ? 'block' : 'none';
}
function openModal(id) { const m = document.getElementById(id); if(m) m.style.display = 'flex'; }
function closeModal(id) { const m = document.getElementById(id); if(m) m.style.display = 'none'; }
function openChangelog() { openModal('changelog-modal'); toggleDrawer(false); }

function checkActivation() { if (localStorage.getItem('nvh_activated') !== 'true') openModal('activation-overlay'); }
function activateApp() {
    if (document.getElementById('activation-key').value === '310824') {
        localStorage.setItem('nvh_activated', 'true');
        closeModal('activation-overlay');
        showToast("💎 ĐÃ KÍCH HOẠT V1.1.9.5!");
    } else { alert("Sai Key!"); }
}

function showToast(msg, type = "", persistent = false) {
    const t = document.createElement('div');
    t.className = `toast show ${type}`;
    t.innerText = msg;
    document.body.appendChild(t);
    if (!persistent) {
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, 3000);
    }
    return t;
}
