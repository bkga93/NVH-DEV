// ==========================================
// TCT SCANNER PRO V1.1.9.1 - CLOUD ERA
// PHIÊN BẢN DIAMOND CLOUD (FIREBASE)
// ==========================================

// --- BIẾN TOÀN CỤC ---
let isScanning = false;
let html5QrCode = null;
let currentScannerId = null;
let useIPCamera = false;
let scanMode = 'single'; // 'single' hoặc 'continuous'
let localHistory = JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
let remoteDataCache = [];
let firebaseApp = null;
let database = null;

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
    console.log("🚀 TCT APP V1.1.9.0 - CLOUD ERA IS LIVE!");
    checkActivation();
    initFirebase();
    renderLocalHistory();
    refreshCameraList();
    
    // Tự động nạp cấu hình cũ
    const savedConfig = localStorage.getItem('nvh_firebase_config');
    if (savedConfig) {
        // Nếu có config riêng của bác, sẽ dùng nó
    }
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
        console.log("☁️ Connected to Cloud Database");
        
        // Trình lắng nghe REAL-TIME (Cực kỳ quan trọng)
        // Khi bất kỳ ai quét, máy bác sẽ tự động nhận về ngay lập tức
        database.ref('scans').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // Chuyển object sang array để dễ xử lý
                remoteDataCache = Object.keys(data).map(key => ({
                    orderId: key,
                    ...data[key]
                })).sort((a, b) => new Date(b.time) - new Date(a.time));
                
                updateCloudStatus(`Hệ thống: ${remoteDataCache.length} đơn`);
                if (document.getElementById('data-view').classList.contains('active')) {
                    displayRemoteData(remoteDataCache);
                }
            }
        });
    } catch (error) {
        console.error("Firebase Init Error:", error);
        updateCloudStatus("Lỗi kết nối Cloud!");
    }
}

async function saveToCloud(orderId, content) {
    if (!database) return;
    
    const userName = localStorage.getItem('nvh_user_name') || 'User';
    const now = new Date().toLocaleString('vi-VN');
    
    try {
        await database.ref('scans/' + orderId).set({
            content: content,
            time: now,
            user: userName
        });
        showToast("✅ Đã đẩy lên Cloud thành công!");
    } catch (error) {
        console.error("Cloud Save Error:", error);
        showToast("❌ Lỗi đẩy Cloud! Đang lưu tạm máy...");
    }
}

// --- MÁY QUÉT (SCANNER) ---
async function toggleScanner() {
    // Sửa lỗi treo camera v1.1.8.7
    if (html5QrCode) {
        try {
            const state = html5QrCode.getState();
            if (state === 2 || state === 3) {
                await html5QrCode.stop();
            }
        } catch (e) { console.warn("Stop error:", e); }
        html5QrCode = null;
    }
    
    if (isScanning) {
        isScanning = false;
        updateScannerUI();
        return;
    }

    await new Promise(r => setTimeout(r, 100)); // Nghỉ 1 nhịp
    html5QrCode = new Html5Qrcode("reader");
    
    const config = { fps: 20, aspectRatio: 1.0 }; // Bỏ qrbox để quét toàn vùng to như khung ngoài
    
    try {
        const cameraId = localStorage.getItem('nvh_scanner_cam_id');
        const scanConfig = cameraId ? { deviceId: cameraId } : { facingMode: "environment" };
        
        await html5QrCode.start(
            scanConfig,
            config,
            onScanSuccess
        );
        
        isScanning = true;
        updateScannerUI();
    } catch (err) {
        alert("Lỗi camera: " + err);
    }
}

function onScanSuccess(decodedText) {
    const code = decodedText.trim();
    if (!code) return;

    // Chèn hiệu ứng thành công
    document.getElementById('flash-overlay').classList.add('flash-active');
    setTimeout(() => document.getElementById('flash-overlay').classList.remove('flash-active'), 100);
    
    // Kiểm tra trùng mã v1.1.9.1
    const isDuplicate = localHistory.some(item => item.content === code);
    
    if (isDuplicate) {
        showToast("⚠️ Mã này đã quét rồi!", "duplicate");
        playDuplicateSound();
    } else {
        showToast("✅ Đã đẩy lên Cloud thành công!");
        playBeep();
    }
    
    // Lưu lịch sử máy
    const scanItem = { id: Date.now(), content: code, time: new Date().toLocaleString('vi-VN') };
    localHistory.unshift(scanItem);
    localStorage.setItem('nvh_scan_history', JSON.stringify(localHistory.slice(0, 100)));
    
    // ĐẨY LÊN CLOUD NGAY (Firebase) - Cập nhật/Ghi đè nếu trùng
    const orderId = extractOrderId(code);
    saveToCloud(orderId, code);
    
    document.getElementById('pc-last-scanned').innerText = code;
    renderLocalHistory();
    
    if (scanMode === 'single') {
        toggleScanner();
    }
}

function extractOrderId(text) {
    // Logic lấy OrderId từ mã vận đơn (Thường là mã SPX...)
    return text.split(/[\s,]+/)[0];
}

// --- GIAO DIỆN (UI) ---
function switchTab(tabName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(tabName + '-view').classList.add('active');
    document.getElementById('btn-tab-' + tabName).classList.add('active');
    
    if (tabName === 'data') {
        displayRemoteData(remoteDataCache);
    }
}

function displayRemoteData(data) {
    const list = document.getElementById('remote-data-list');
    list.innerHTML = '';
    
    if (data.length === 0) {
        list.innerHTML = '<div class="empty-msg">Đang chờ dữ liệu Cloud...</div>';
        return;
    }

    data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-item-header">
                <span class="history-item-time">${item.time}</span>
                <span style="color:var(--gray-text)">Bởi: ${item.user}</span>
            </div>
            <div class="history-item-content">${item.orderId}</div>
        `;
        list.appendChild(div);
    });
}

function renderLocalHistory() {
    const list = document.getElementById('history-list');
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
    btn.innerText = isScanning ? "🛑 DỪNG QUÉT" : "🚀 BẮT ĐẦU QUÉT";
    btn.style.backgroundColor = isScanning ? "var(--danger)" : "var(--primary-color)";
}

function updateCloudStatus(msg) {
    const el = document.getElementById('cloud-status');
    if (el) el.innerText = msg;
}

function showToast(msg, type = "") {
    const toast = document.createElement('div');
    toast.className = `toast show ${type}`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// --- CÀI ĐẶT ---
function toggleDrawer(show) {
    document.getElementById('side-drawer').classList.toggle('active', show);
    document.getElementById('drawer-overlay').style.display = show ? 'block' : 'none';
}

function openSettings(group) {
    const modal = document.getElementById('settings-modal');
    const body = document.getElementById('settings-body');
    modal.style.display = 'flex';
    toggleDrawer(false);
    
    if (group === 'cloud') {
        renderCloudSettings();
    } else if (group === 'scan') {
        renderScanSettings();
    } else if (group === 'camera') {
        renderCameraSettings();
    }
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
    location.reload(); // Để nạp cấu hình mới
}

function renderCloudSettings() {
    document.getElementById('settings-title').innerText = "CẤU HÌNH CLOUD";
    const currentConfig = JSON.parse(localStorage.getItem('nvh_firebase_config') || JSON.stringify(DEFAULT_FIREBASE_CONFIG));
    
    document.getElementById('settings-body').innerHTML = `
        <div class="settings-group">
            <label>API KEY</label>
            <input type="text" id="fb-apiKey" class="settings-select" value="${currentConfig.apiKey}">
        </div>
        <div class="settings-group">
            <label>DATABASE URL</label>
            <input type="text" id="fb-databaseURL" class="settings-select" value="${currentConfig.databaseURL}">
        </div>
        <div class="settings-group">
            <label>PROJECT ID</label>
            <input type="text" id="fb-projectId" class="settings-select" value="${currentConfig.projectId}">
        </div>
        <button class="pc-action-btn" onclick="saveFirebaseConfig()" style="background:var(--success)">LƯU CẤU HÌNH CLOUD</button>
        <p style="font-size:0.6rem; color:var(--gray-text); margin-top:10px;">Lưu ý: Bác phải paste đúng mã từ Firebase Console thì App mới chạy được Cloud riêng của bác.</p>
    `;
}

function saveFirebaseConfig() {
    const newConfig = {
        apiKey: document.getElementById('fb-apiKey').value,
        databaseURL: document.getElementById('fb-databaseURL').value,
        projectId: document.getElementById('fb-projectId').value,
        authDomain: document.getElementById('fb-projectId').value + ".firebaseapp.com",
    };
    localStorage.setItem('nvh_firebase_config', JSON.stringify(newConfig));
    showToast("✅ Đã lưu cấu hình Cloud!");
}

async function refreshCameraList() {
    try {
        const devices = await Html5Qrcode.getCameras();
        const select = document.createElement('select'); // Chỉ dùng cho modal
        // Logic chọn camera nằm trong Settings
    } catch (e) {
        console.warn("Camera list error:", e);
    }
}

// --- BẢO MẬT & KÍCH HOẠT ---
function checkActivation() {
    const isActivated = localStorage.getItem('nvh_activated');
    if (isActivated !== 'true') {
        document.getElementById('activation-overlay').style.display = 'flex';
    }
}

function activateApp() {
    const key = document.getElementById('activation-key').value;
    if (key === '151116') {
        localStorage.setItem('nvh_activated', 'true');
        document.getElementById('activation-overlay').style.display = 'none';
        showToast("💎 ĐÃ KÍCH HOẠT DIAMOND CLOUD!");
    } else {
        alert("Sai Key kích hoạt!");
    }
}

function playBeep() {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
    audio.play();
}

function playDuplicateSound() {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'); // Âm báo lỗi/trùng
    audio.play();
}

function filterHistory() {
    const val = document.getElementById('search-input').value.toLowerCase();
    const items = document.querySelectorAll('#history-list .history-item');
    items.forEach(it => {
        const text = it.innerText.toLowerCase();
        it.style.display = text.includes(val) ? 'block' : 'none';
    });
}

function filterRemoteData() {
    const val = document.getElementById('remote-search-input').value.toLowerCase();
    const items = document.querySelectorAll('#remote-data-list .history-item');
    items.forEach(it => {
        const text = it.innerText.toLowerCase();
        it.style.display = text.includes(val) ? 'block' : 'none';
    });
}
