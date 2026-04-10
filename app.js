// TCT SCANNER PRO V1.2.2.4 - CLOUD ERA
// PHIÊN BẢN DIAMOND CLOUD (FIREBASE)
// ==========================================

// --- BIẾN TOÀN CỤC ---
let isScanning = false;
let html5QrCode = null;
let scanMode = 'single'; 
let localHistory = JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
let remoteDataCache = [];
let database = null;
let pendingScanCode = null; 
let isRemoteListVisible = false;
let lastScanTracker = { code: '', time: 0 }; 

let ocrWorker = null; // Tesseract Worker

const VI_VOICE_FILE = 'Am thanh bao Tieng Viet.mp3'; // File âm thanh thực tế

// --- CÀI ĐẶT NGƯỜI DÙNG ---
const getDeviceDefaultName = () => {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android Device";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Macintosh/i.test(ua)) return "MacBook/iMac";
    return "Thiết bị khách";
};

const settings = {
    userName: localStorage.getItem('nvh_user_name') || getDeviceDefaultName(),
    beepType: localStorage.getItem('nvh_beep_type') || 'default',
    vibrate: localStorage.getItem('nvh_vibrate') === 'true',
    voiceEnabled: localStorage.getItem('nvh_voice_enabled') !== 'false', 
    theme: localStorage.getItem('nvh_theme') || 'plum-gold',
    fontSize: localStorage.getItem('nvh_font_size') || '100',
    retention: localStorage.getItem('nvh_data_retention') || 'all',
    firebase: JSON.parse(localStorage.getItem('nvh_firebase_config') || 'null')
};

// --- KHO ÂM THANH SIÊU THỊ ---
const BEEP_SOUNDS = {
    default: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
    sharp: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3',
    digital: 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3',
    ting: 'https://assets.mixkit.co/active_storage/sfx/2188/2188-preview.mp3',
    cash: 'https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3',
    short1: 'https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3',
    short2: 'https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3',
    short3: 'https://assets.mixkit.co/active_storage/sfx/1612/1612-preview.mp3',
    short4: 'https://assets.mixkit.co/active_storage/sfx/1613/1613-preview.mp3'
};

const BEEP_NAMES = {
    default: "Siêu thị 1 (Chuẩn)",
    sharp: "Siêu thị 2 (Đanh)",
    digital: "Kỹ thuật số",
    ting: "Ting Ting (Vui)",
    cash: "Tiền về (Siêu thị)",
    short1: "Bíp Ngắn A",
    short2: "Bíp Ngắn B",
    short3: "Bíp Ngắn C",
    short4: "Bíp Ngắn D"
};

// --- KHỞI TẠO APP ---
window.onload = async () => {
    console.log("🚀 TCT APP V1.2.2.4 - CLOUD ERA IS LIVE!");
    applyTheme(settings.theme);
    applyFontSize(settings.fontSize);
    checkActivation(); // Kiểm tra Activation và Mật khẩu truy cập
    initFirebase();
    renderLocalHistory();
    
    document.querySelectorAll('input[name="scanMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => { scanMode = e.target.value; });
    });
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
            remoteDataCache = data ? Object.keys(data).map(key => ({
                orderId: key,
                ...data[key]
            })).sort((a, b) => parseTime(b.time) - parseTime(a.time)) : [];
            updateCloudInfoUI();
            autoCleanupOldData(remoteDataCache);
        });
    } catch (e) { console.error("Firebase Sync Error"); }
}

function parseTime(timeStr) {
    if (!timeStr) return new Date(0);
    const parts = timeStr.split(' ');
    if (parts.length < 2) return new Date(0);
    const dateParts = parts[1].split('/');
    const timeParts = parts[0].split(':');
    return new Date(dateParts[2], dateParts[1] - 1, dateParts[0], timeParts[0], timeParts[1], timeParts[2]);
}

function autoCleanupOldData(data) {
    if (settings.retention === 'all' || !database) return;
    const days = parseInt(settings.retention);
    const now = new Date();
    data.forEach(item => {
        const itemDate = parseTime(item.time);
        if ((now - itemDate) / (1000 * 60 * 60 * 24) > days) {
            database.ref('scans/' + item.orderId).remove();
        }
    });
}

function clearAllCloudData() {
    if (!database) return;
    if (confirm("⚠️ CẢNH BÁO: Xóa vĩnh viễn TOÀN BỘ dữ liệu Cloud?")) {
        const toast = showToast("🔄 Đang dọn dẹp Cloud...", "info", true);
        database.ref('scans').set(null).then(() => {
            if (toast) toast.remove();
            remoteDataCache = []; 
            updateCloudInfoUI();
            displayRemoteData([]);
            showToast("🔥 Đã xóa sạch Cloud!");
            closeModal('settings-modal');
        });
    }
}

function runManualCleanup() {
    if (!database) return;
    const days = parseInt(document.getElementById('set-manual-retention').value);
    const now = new Date();
    let count = 0;
    
    if (confirm(`🧹 Bác có chắc chắn muốn xóa tất cả đơn hàng cũ hơn ${days} ngày không?`)) {
        const toast = showToast(`⏳ Đang tìm và xóa đơn cũ (> ${days} ngày)...`, "info", true);
        const updates = {};
        remoteDataCache.forEach(item => {
            const itemDate = parseTime(item.time);
            if ((now - itemDate) / (1000 * 60 * 60 * 24) > days) {
                updates[item.orderId] = null;
                count++;
            }
        });

        if (count > 0) {
            database.ref('scans').update(updates).then(() => {
                if (toast) toast.remove();
                showToast(`✅ Đã xóa thành công ${count} đơn hàng!`);
            });
        } else {
            if (toast) toast.remove();
            showToast("ℹ️ Không tìm thấy đơn hàng nào quá hạn.");
        }
    }
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
    } catch (e) { showToast("❌ Lỗi dữ liệu!"); }
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

    const now = Date.now();
    if (scanMode === 'continuous' && code === lastScanTracker.code && (now - lastScanTracker.time < 2000)) return;
    lastScanTracker = { code: code, time: now };

    document.getElementById('flash-overlay').classList.add('flash-active');
    setTimeout(() => document.getElementById('flash-overlay').classList.remove('flash-active'), 100);
    
    const orderId = extractOrderId(code);
    const existing = remoteDataCache.find(item => item.orderId === orderId);

    if (existing) {
        pendingScanCode = code;
        document.getElementById('dup-code-text').innerText = orderId;
        // Dừng máy quét ngay lập tức để người dùng tập trung xử lý modal trùng lặp
        if (isScanning) toggleScanner(); 
        
        openModal('duplicate-modal');
        playDuplicateSound();
    } else {
        processFinalScan(orderId, code);
        playBeep();
        if (settings.voiceEnabled) speakSuccess();
        if (settings.vibrate) navigator.vibrate(200);
        showScanResultOverlay(orderId);
        
        // Sau khi quét thành công (không trùng), dừng máy quét nếu đang ở chế độ quét từng mã
        if (scanMode === 'single' && isScanning) toggleScanner();
    }
}

// --- ÂM BÁO TIẾNG VIỆT (V1.2.1.0 FIX) ---
function speakSuccess() {
    // Thay thế TTS bằng tệp MP3 thực tế bác gửi
    const audio = new Audio(VI_VOICE_FILE);
    audio.play().catch(e => console.error("Audio Play Error:", e));
}

function showScanResultOverlay(orderId) {
    const overlay = document.getElementById('scan-result-overlay');
    const text = document.getElementById('result-order-id');
    text.innerText = orderId;
    overlay.classList.add('show');
    setTimeout(() => overlay.classList.remove('show'), 2000);
}

function processFinalScan(id, content, isOverwrite = true) {
    const scanItem = { id: Date.now(), content: content, time: new Date().toLocaleString('vi-VN') };
    localHistory.unshift(scanItem);
    localStorage.setItem('nvh_scan_history', JSON.stringify(localHistory.slice(0, 50)));
    renderLocalHistory();
    saveToCloud(id, content, isOverwrite);
}

function handleDuplicate(choice) {
    closeModal('duplicate-modal');
    if (!pendingScanCode) return;
    const baseId = extractOrderId(pendingScanCode);
    if (choice === 'overwrite') processFinalScan(baseId, pendingScanCode, true);
    else if (choice === 'keep') processFinalScan(baseId + getNextSuffix(baseId), pendingScanCode, false);
    
    // Máy quét đã được dừng từ lúc phát hiện trùng ở onScanSuccess.
    // Chúng ta không gọi toggleScanner ở đây để giữ trạng thái "Bắt đầu quét" (chờ bấm nút).
    pendingScanCode = null;
}

function getNextSuffix(baseId) {
    let s = 2;
    while (remoteDataCache.some(it => it.orderId === `${baseId}(${s})`)) s++;
    return `(${s})`;
}

function extractOrderId(text) { return text.split(/[\s,]+/)[0]; }

// --- AI OCR LOGIC v1.2.2.5 ---
async function initOCR() {
    if (ocrWorker) return ocrWorker;
    ocrWorker = await Tesseract.createWorker('vie'); // Hỗ trợ tiếng Việt
    return ocrWorker;
}

async function runAIScan() {
    if (!isScanning) {
        showToast("⚠️ Vui lòng BẬT CAMERA trước!", "warning");
        return;
    }

    const video = document.querySelector('#reader video');
    if (!video) return;

    openModal('ai-modal');
    document.getElementById('ai-loading').style.display = 'block';
    document.getElementById('ai-result-form').style.display = 'none';

    try {
        // 1. Chụp ảnh từ video
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const imageData = canvas.toDataURL('image/jpeg');

        // 2. Chạy OCR
        const worker = await initOCR();
        const { data: { text } } = await worker.recognize(imageData);
        console.log("AI OCR RAW TEXT:", text);

        // 3. Phân tích dữ liệu
        const extracted = extractAIShopData(text);
        
        // 4. Hiển thị lên form xác nhận
        document.getElementById('ai-tracking-id').value = extracted.trackingId || "";
        document.getElementById('ai-order-id').value = extracted.orderId || "";
        document.getElementById('ai-cod').value = extracted.cod || "";
        document.getElementById('ai-product').value = extracted.product || "";

        document.getElementById('ai-loading').style.display = 'none';
        document.getElementById('ai-result-form').style.display = 'block';
    } catch (e) {
        console.error("AI Scan Error:", e);
        showToast("❌ Lỗi AI: " + e.message, "danger");
        closeModal('ai-modal');
    }
}

function extractAIShopData(text) {
    const data = { trackingId: "", orderId: "", cod: "", product: "" };
    
    // Regex cho nhãn Shopee
    const trackingRegex = /(SPXVN\d+)/i;
    const orderIdRegex = /(26\d{10,}[A-Z0-9]*)/i; // Shopee Order ID thường bắt đầu bằng 26
    const codRegex = /([\d,.]+)\s*VND/i;
    const productKeywords = ["Nội dung hàng", "SL sản phẩm"];

    const trackMatch = text.match(trackingRegex);
    if (trackMatch) data.trackingId = trackMatch[1];

    const orderMatch = text.match(orderIdRegex);
    if (orderMatch) data.orderId = orderMatch[1];

    const codMatch = text.match(codRegex);
    if (codMatch) data.cod = codMatch[1];

    // Trích xuất sản phẩm (lấy 1 dòng sau từ khóa)
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (productKeywords.some(k => lines[i].includes(k))) {
            data.product = (lines[i+1] || "").trim();
            break;
        }
    }

    return data;
}

async function saveAIScan() {
    const trackingId = document.getElementById('ai-tracking-id').value.trim();
    if (!trackingId) {
        alert("Cần ít nhất Mã vận đơn để lưu!");
        return;
    }

    const aiData = {
        orderId: document.getElementById('ai-order-id').value,
        cod: document.getElementById('ai-cod').value,
        product: document.getElementById('ai-product').value,
        user: settings.userName,
        time: new Date().toLocaleString('vi-VN'),
        type: 'AI_OCR'
    };

    if (!database) return;
    try {
        await database.ref('scans/' + trackingId).set(aiData);
        showToast("✅ Đã lưu AI thành công!");
        closeModal('ai-modal');
        playBeep();
        if (settings.voiceEnabled) speakSuccess();
    } catch (e) {
        showToast("❌ Lỗi lưu Cloud");
    }
}

// --- UI & TABS ---
function switchTab(t) {
    document.querySelectorAll('.view, .tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(t + '-view').classList.add('active');
    document.getElementById('btn-tab-' + t).classList.add('active');
}

function showAllRemoteData() { isRemoteListVisible = true; displayRemoteData(remoteDataCache); }
function refreshCloudData() {
    const status = document.getElementById('update-status-line');
    status.innerHTML = `<span style="color:var(--primary-color);">⏳ Đang làm mới...</span>`;
    setTimeout(() => {
        status.innerHTML = `✅ Xong: <i>${new Date().toLocaleTimeString('vi-VN')}</i>`;
        updateCloudInfoUI();
    }, 800);
}

function updateCloudInfoUI() {
    const b = document.getElementById('btn-show-all');
    if (b) b.innerText = `📊 TẤT CẢ (${remoteDataCache.length})`;
}

function filterRemoteData() {
    const v = document.getElementById('remote-search-input').value.trim().toLowerCase();
    const l = document.getElementById('remote-data-list');
    if (v === '') {
        l.innerHTML = '<div class="empty-msg"><p>Nhập mã để tìm hoặc nhấn "TẤT CẢ"</p></div>';
        return;
    }
    displayRemoteData(remoteDataCache.filter(it => it.orderId.toLowerCase().includes(v)));
}

function displayRemoteData(data) {
    const l = document.getElementById('remote-data-list');
    l.innerHTML = '';
    if (data.length === 0) { l.innerHTML = '<div class="empty-msg">Trống</div>'; return; }
    data.forEach(it => {
        const d = document.createElement('div');
        d.className = 'history-item';
        d.onclick = () => showOrderDetails(it);
        const subInfo = it.cod ? `<div style="color:var(--success); font-size:0.8rem;">💰 ${it.cod} VND</div>` : "";
        d.innerHTML = `<div class="history-item-header"><span>${it.time}</span><span>👤 ${it.user}</span></div>
                       <div class="history-item-content">${it.orderId || it.trackingId || it.content}</div>
                       ${subInfo}`;
        l.appendChild(d);
    });
}

function showOrderDetails(it) {
    const b = document.getElementById('order-detail-content');
    let detailHtml = `<div class="detail-row"><span class="detail-label">MÃ VẬN ĐƠN/ID:</span><span class="detail-value">${it.orderId || it.content}</span></div>`;
    
    if (it.type === 'AI_OCR') {
        detailHtml += `
            <div class="detail-row"><span class="detail-label">MÃ ĐƠN HÀNG:</span><span class="detail-value">${it.orderId}</span></div>
            <div class="detail-row"><span class="detail-label">TIỀN THU (COD):</span><span class="detail-value" style="color:var(--success)">${it.cod} VND</span></div>
            <div class="detail-row"><span class="detail-label">SẢN PHẨM:</span><span class="detail-value">${it.product}</span></div>
        `;
    }

    detailHtml += `
        <div class="detail-row"><span class="detail-label">GIỜ QUÉT:</span><span class="highlight-time">${it.time}</span></div>
        <div class="detail-row"><span class="detail-label">NGƯỜI QUÉT:</span><span class="detail-value">${it.user}</span></div>
    `;
    
    b.innerHTML = detailHtml;
    openModal('detail-modal');
}

function renderLocalHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '';
    localHistory.slice(0, 20).forEach(it => {
        const d = document.createElement('div');
        d.className = 'history-item';
        d.innerHTML = `<div class="history-item-header"><span>${it.time}</span></div><div class="history-item-content">${it.content}</div>`;
        list.appendChild(d);
    });
}

function updateScannerUI() {
    const b = document.getElementById('start-btn');
    b.innerHTML = isScanning ? "🛑 DỪNG QUÉT" : "🚀 BẮT ĐẦU QUÉT";
    b.style.background = isScanning ? "var(--danger)" : "";
}

// --- SETTINGS v1.2.2.3 ---
let currentGroup = '';
function openSettings(g) {
    if (g === 'database' && prompt("🔐 Mật khẩu Quản trị:") !== '310824') return;
    currentGroup = g;
    const t = document.getElementById('settings-title');
    const b = document.getElementById('settings-body');
    b.innerHTML = '';
    
    switch(g) {
        case 'audio':
            t.innerText = "ÂM THANH & GIỌNG NÓI";
            let opts = '';
            Object.keys(BEEP_SOUNDS).forEach(k => opts += `<option value="${k}" ${settings.beepType===k?'selected':''}>${BEEP_NAMES[k]}</option>`);
            b.innerHTML = `
                <div class="settings-group"><label class="settings-label">Tiếng bíp siêu thị:</label><select id="set-beep-type" class="settings-select">${opts}</select></div>
                <div class="toggle-container"><span>Âm báo Tiếng Việt (MP3):</span><label class="switch"><input type="checkbox" id="set-voice" ${settings.voiceEnabled?'checked':''}><span class="slider"></span></label></div>
                <div class="toggle-container"><span>Rung máy:</span><label class="switch"><input type="checkbox" id="set-vibrate" ${settings.vibrate?'checked':''}><span class="slider"></span></label></div>
                <button class="pc-action-btn" style="margin-top:20px; padding:15px; font-size:1rem;" onclick="testBeep()">📻 THỬ TIẾNG BÍP + ÂM BÁO</button>
            `;
            break;
        case 'user':
            t.innerText = "NGƯỜI VẬN HÀNH";
            b.innerHTML = `<div class="settings-group"><label class="settings-label">Tên nhân viên:</label><input type="text" id="set-user-name" class="settings-input" value="${settings.userName}"></div>`;
            break;
        case 'display':
            t.innerText = "GIAO DIỆN HIỂN THỊ";
            b.innerHTML = `
                <div class="settings-group"><label class="settings-label">Bộ màu (Theme):</label>
                    <select id="set-theme" class="settings-select">
                        <option value="plum-gold" ${settings.theme==='plum-gold'?'selected':''}>Tím Gold</option>
                        <option value="midnight" ${settings.theme==='midnight'?'selected':''}>Midnight</option>
                        <option value="ruby" ${settings.theme==='ruby'?'selected':''}>Ruby Red</option>
                        <option value="light-blue" ${settings.theme==='light-blue'?'selected':''}>Light Blue</option>
                    </select>
                </div>
                <div class="settings-group"><label class="settings-label">Cỡ chữ (${settings.fontSize}%):</label><input type="range" id="set-font-size" min="80" max="150" value="${settings.fontSize}" style="width:100%"></div>
            `;
            break;
        case 'database':
            t.innerText = "CƠ SỞ DỮ LIỆU";
            b.innerHTML = `
                <div class="settings-group"><label class="settings-label">Thời gian lưu trữ (Tự động):</label>
                    <select id="set-retention" class="settings-select">
                        <option value="7" ${settings.retention==='7'?'selected':''}>Giữ lại 7 ngày</option>
                        <option value="30" ${settings.retention==='30'?'selected':''}>Giữ lại 30 ngày</option>
                        <option value="180" ${settings.retention==='180'?'selected':''}>Giữ lại 6 tháng</option>
                        <option value="365" ${settings.retention==='365'?'selected':''}>Giữ lại 1 năm</option>
                        <option value="all" ${settings.retention==='all'?'selected':''}>Vĩnh viễn</option>
                    </select>
                </div>
                <div class="admin-cleanup-box">
                    <label class="settings-label">🧹 Dọn dẹp chủ động đơn cũ:</label>
                    <select id="set-manual-retention" class="settings-select" style="margin-bottom:10px;">
                        <option value="7">Cũ hơn 7 ngày</option>
                        <option value="10" selected>Cũ hơn 10 ngày</option>
                        <option value="15">Cũ hơn 15 ngày</option>
                        <option value="30">Cũ hơn 30 ngày</option>
                        <option value="90">Cũ hơn 3 tháng</option>
                        <option value="180">Cũ hơn 6 tháng</option>
                        <option value="365">Cũ hơn 1 năm</option>
                    </select>
                    <button class="pc-action-btn" style="background:var(--danger); font-size:0.8rem;" onclick="runManualCleanup()">XÓA ĐƠN QUÁ HẠN</button>
                </div>
                <button class="admin-action-btn" style="background:var(--danger); color:white; padding:15px; border-radius:12px; border:none; width:100%; font-weight:800; margin-top:20px;" onclick="clearAllCloudData()">🔥 XÓA TẤT CẢ DỮ LIỆU CLOUD</button>
            `;
            break;
    }
    openModal('settings-modal'); toggleDrawer(false);
}

function saveSettings() {
    if (currentGroup === 'audio') {
        settings.beepType = document.getElementById('set-beep-type').value;
        settings.voiceEnabled = document.getElementById('set-voice').checked;
        settings.vibrate = document.getElementById('set-vibrate').checked;
        localStorage.setItem('nvh_beep_type', settings.beepType);
        localStorage.setItem('nvh_voice_enabled', settings.voiceEnabled);
        localStorage.setItem('nvh_vibrate', settings.vibrate);
    } else if (currentGroup === 'user') {
        settings.userName = document.getElementById('set-user-name').value || 'Admin';
        localStorage.setItem('nvh_user_name', settings.userName);
    } else if (currentGroup === 'display') {
        settings.theme = document.getElementById('set-theme').value;
        settings.fontSize = document.getElementById('set-font-size').value;
        localStorage.setItem('nvh_theme', settings.theme);
        localStorage.setItem('nvh_font_size', settings.fontSize);
        applyTheme(settings.theme); applyFontSize(settings.fontSize);
    } else if (currentGroup === 'database') {
        settings.retention = document.getElementById('set-retention').value;
        localStorage.setItem('nvh_data_retention', settings.retention);
        window.location.reload();
    }
    showToast("💾 Lưu thành công!"); closeModal('settings-modal');
}

function applyTheme(t) { document.body.dataset.theme = t; }
function applyFontSize(s) { document.documentElement.style.fontSize = (s / 100) * 16 + 'px'; }
function testBeep() { 
    new Audio(BEEP_SOUNDS[document.getElementById('set-beep-type').value]).play(); 
    if (document.getElementById('set-voice').checked) {
        setTimeout(() => speakSuccess(), 500);
    }
}
function playBeep() { new Audio(BEEP_SOUNDS[settings.beepType] || BEEP_SOUNDS.default).play(); }
function playDuplicateSound() { new Audio(BEEP_SOUNDS.short4).play(); }

function toggleDrawer(s) { 
    document.getElementById('side-drawer').classList.toggle('active', s);
    document.getElementById('drawer-overlay').style.display = s ? 'block' : 'none';
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openChangelog() { openModal('changelog-modal'); toggleDrawer(false); }

function checkActivation() { 
    // Đã gỡ bỏ yêu cầu mật khẩu khi khởi chạy theo yêu cầu người dùng
    console.log("🔓 Quyền truy cập được mở khóa tự động.");
}
function activateApp() {
    const key = document.getElementById('activation-key').value;
    if (key === '310824') {
        localStorage.setItem('nvh_activated', 'true');
        localStorage.setItem('nvh_auth_skip', 'true'); // Lưu để bỏ qua mật khẩu lần sau
        closeModal('activation-overlay'); showToast("💎 KÍCH HOẠT & ĐĂNG NHẬP THÀNH CÔNG!");
    } else alert("Sai mật khẩu!");
}

function showToast(msg, type = "", p = false) {
    const t = document.createElement('div');
    t.className = `toast show ${type}`; t.innerText = msg;
    document.body.appendChild(t);
    if (!p) setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, 3000);
    return t;
}
