// Cấu hình URL Google Apps Script chính thức từ bạn
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzw4v799F8zAANRMCfTDXG3O0HbDHoP9PvnDkjgZQGzaqpDlRnakOWpJocYROR8AzqqNg/exec";

let html5QrCode;
let isScanning = false;
let isSearchScanning = false;
let searchTarget = 'history'; // 'history' hoặc 'data'
let lastScanTime = 0;
let isProcessing = false;
const SCAN_DELAY = 1500;

let remoteDataCache = [];
let selectedRemoteItem = null;
let currentPendingScan = null; 

// --- Biến cho v1.6.4 (PC Mode & Recording) ---
let pcMode = false;
let camera2 = null; // Stream thứ 2
let mediaRecorders = []; // Mảng 2 MediaRecorder
let recordingActive = false;
let recorderStreams = []; // [stream1, stream2]
let recStartTime = null;
let recTimerInterval = null;
let hddFolderHandle = null;
let db;

// --- INITIALIZE INDEXED_DB v1.7.0 ---
const dbRequest = indexedDB.open("NVHScannerDB", 1);
dbRequest.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos");
};
dbRequest.onsuccess = (e) => { db = e.target.result; };
 // Quyền truy cập thư mục máy tính
let uploadQueue = []; // Hàng đợi tải video lên Drive
let lastScannedId = null; // Lưu ID cuối cùng để ghi hình thủ công
let autoRecordEnabled = localStorage.getItem('nvh_auto_record') !== 'false';

// Cấu hình âm thanh & rung
let audioCtx;
const SOUND_PRESETS = {
    standard: { freq: 1200, type: 'sine', duration: 0.1, gain: 1.0 },
    double: { freq: 1500, type: 'square', duration: 0.05, repeat: 2, gain: 0.8 },
    deep: { freq: 400, type: 'triangle', duration: 0.2, gain: 1.2 },
    melody: { freq: [1000, 1200, 1500], type: 'sine', duration: 0.08, gain: 0.9 },
    laser: { freq: [2000, 800], type: 'sine', duration: 0.12, sweep: true, gain: 0.8 },
    triple: { freq: 1400, type: 'sine', duration: 0.04, repeat: 3, gain: 0.7 },
    sharp: { freq: 1800, type: 'square', duration: 0.03, gain: 0.5 },
    coin: { freq: [950, 1600], type: 'sine', duration: 0.1, gain: 0.8 },
    pulse: { freq: 600, type: 'sawtooth', duration: 0.05, repeat: 2, gain: 0.6 },
    scifi: { freq: [1200, 1600, 2000, 1600], type: 'sine', duration: 0.05, gain: 0.7 }
};

function playBeep(presetKey = null) {
    try {
        const key = presetKey || localStorage.getItem('nvh_sound_type') || 'standard';
        const preset = SOUND_PRESETS[key];
        
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const playTone = (freq, startTime, duration, targetFreq = null) => {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type = preset.type;
            osc.frequency.setValueAtTime(freq, startTime);
            if (targetFreq) osc.frequency.exponentialRampToValueAtTime(targetFreq, startTime + duration);
            gainNode.gain.setValueAtTime(preset.gain, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        let now = audioCtx.currentTime;
        if (preset.sweep && Array.isArray(preset.freq)) {
            playTone(preset.freq[0], now, preset.duration, preset.freq[1]);
        } else if (Array.isArray(preset.freq)) {
            preset.freq.forEach((f, i) => playTone(f, now + (i * preset.duration), preset.duration));
        } else if (preset.repeat) {
            for (let i = 0; i < preset.repeat; i++) {
                playTone(preset.freq, now + (i * (preset.duration + 0.05)), preset.duration);
            }
        } else {
            playTone(preset.freq, now, preset.duration);
        }

        // Thực hiện Rung nếu bật
        if (localStorage.getItem('nvh_vibrate') !== 'false') {
            if (navigator.vibrate) navigator.vibrate(200);
        }
    } catch (e) { console.warn("Audio Context error:", e); }
}

function triggerFlash() {
    const flash = document.getElementById('flash-overlay');
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 500);
}

// Chuyển đổi Tab
function switchTab(tab) {
    const views = ['scan-view', 'history-view', 'data-view', 'review-view'];
    const btns = ['btn-tab-scan', 'btn-tab-history', 'btn-tab-data', 'btn-tab-review'];
    
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) { el.style.display = 'none'; el.classList.remove('active'); }
    });

    btns.forEach(b => {
        const el = document.getElementById(b);
        if (el) el.classList.remove('active');
    });

    const activeView = document.getElementById(tab + '-view');
    const activeBtn = document.getElementById('btn-tab-' + tab);

    if (activeView) { activeView.style.display = 'flex'; activeView.classList.add('active'); }
    if (activeBtn) activeBtn.classList.add('active');

    if (tab !== 'scan' && isScanning && !pcMode) stopScanner();
    if (tab === 'history') loadLocalHistory();
    if (tab === 'data') displayRemoteData();
}

// Bật/Tắt Camera
async function toggleScanner() {
    const btn = document.getElementById('start-btn');
    if (!isScanning) {
        try {
            if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
            const deviceId = localStorage.getItem('nvh_camera_id');
            const cameraConfig = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" };

            playBeep();
            await html5QrCode.start(
                cameraConfig,
                { 
                    fps: 25, 
                    qrbox: (w, h) => {
                        const size = Math.min(w, h) * 0.85; // Tăng kích thước khung quét lên 85%
                        return { width: size, height: size };
                    },
                    showViewFinder: false 
                },
                onScanSuccess
            );

            // Nếu Link PC Mode, hiển thị thêm Camera 2
            if (pcMode) {
                await startSecondaryCamera();
            }

            isScanning = true;
            btn.classList.add('scanning');
            document.getElementById('btn-text').innerText = "DỪNG QUÉT";
            document.getElementById('btn-subtext').innerText = pcMode ? "Chế độ giám sát đa máy ảnh" : "Vui lòng đưa mã vào khung hình";
        } catch (err) { showToast("Lỗi camera: " + err); }
    } else { 
        if (recordingActive) {
            showToast("Vui lòng dừng ghi hình trước!");
            return;
        }
        await stopScanner(); 
    }
}

async function startSecondaryCamera() {
    const select2 = document.getElementById('camera-2-select');
    const deviceId2 = select2.value || localStorage.getItem('nvh_camera_2_id');
    const video2 = document.getElementById('pc-video-2');
    
    if (!deviceId2 || !deviceId2.length) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId2 } }
        });
        video2.srcObject = stream;
        camera2 = stream;
        document.getElementById('monitor-cam-2').style.display = 'none';
        
        // Gán luồng cho MediaRecorder
        const stream1 = document.querySelector('#reader video').srcObject;
        recorderStreams = [stream1, stream];
        
        // Link stream 1 qua Monitor 1
        const video1 = document.getElementById('pc-video-1');
        video1.srcObject = stream1;
        document.getElementById('monitor-cam-1').style.display = 'none';
        
    } catch (err) {
        showToast("Lỗi Camera 2: " + err);
    }
}

async function stopScanner() {
    if (html5QrCode && isScanning) {
        await html5QrCode.stop();
        if (camera2) {
            camera2.getTracks().forEach(track => track.stop());
            camera2 = null;
        }
        isScanning = false;
        const btn = document.getElementById('start-btn');
        btn.classList.remove('scanning');
        document.getElementById('btn-text').innerText = "BẮT ĐẦU QUÉT";
        document.getElementById('btn-subtext').innerText = "Nhấn để khởi động Camera";
        
        // Clear monitor videos
        document.getElementById('pc-video-1').srcObject = null;
        document.getElementById('pc-video-2').srcObject = null;
        document.getElementById('monitor-cam-1').style.display = 'block';
        document.getElementById('monitor-cam-2').style.display = 'block';
    }
}

// Khi quét thành công
async function onScanSuccess(decodedText) {
    const now = Date.now();
    if (isProcessing || (now - lastScanTime < SCAN_DELAY)) return;

    playBeep();
    triggerFlash();

    if (isSearchScanning) {
        if (searchTarget === 'history') {
            document.getElementById('search-input').value = decodedText;
            filterHistory();
        } else {
            document.getElementById('remote-search-input').value = decodedText;
            filterRemoteData(true); 
        }
        stopScanner();
        showToast("Đã tìm thấy mã: " + decodedText);
        return;
    }

    // Trigger DỪNG QUAY bằng mã QR
    if (recordingActive && decodedText.toUpperCase() === "DỪNG QUAY") {
        stopDualRecording();
        return;
    }

    // Kiểm tra trùng lặp
    const isDuplicateRemote = remoteDataCache.some(item => item.content === decodedText);
    const localQueue = JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    const isDuplicateLocal = localQueue.some(item => item.content === decodedText);

    if (isDuplicateRemote || isDuplicateLocal) {
        currentPendingScan = decodedText;
        showDuplicateModal(decodedText);
        return;
    }

    processValidScan(decodedText);
}

function processValidScan(decodedText, action = 'APPEND') {
    lastScanTime = Date.now();
    isProcessing = true;
    
    document.getElementById('scanned-result').innerText = decodedText;
    document.getElementById('sync-status').innerText = "Đang xử lý...";
    
    const scanMode = document.querySelector('input[name="scanMode"]:checked').value;
    const orderData = {
        id: Date.now(),
        orderId: decodedText.length > 5 ? decodedText : "NVH-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
        content: decodedText,
        scanTime: new Date().toLocaleString('vi-VN'),
        synced: false,
        action: action 
    };

    saveToQueue(orderData);
    isProcessing = false;
    processSyncQueue();

    // v1.6.5: Lấy ID để ghi hình thủ công
    lastScannedId = orderData.orderId;

    // v1.6.4: Tự động khởi động Ghi hình khi quét mã (Nếu ở chế độ PC)
    if (pcMode && !recordingActive && autoRecordEnabled) {
        startDualRecording(orderData.orderId);
    }

    if (scanMode === 'single' && !pcMode) setTimeout(() => stopScanner(), 500);
}

// --- LOGIC XỬ LÝ TRÙNG LẶP ---
function showDuplicateModal(code) {
    document.getElementById('dup-code').innerText = code;
    document.getElementById('duplicate-modal').style.display = 'flex';
    // Tạm dừng camera nếu đang ở mode liên tục để người dùng chọn
    const scanMode = document.querySelector('input[name="scanMode"]:checked').value;
    if (scanMode === 'continuous') {
        // Không dùng hẳn camera nhưng đánh dấu xử lý
        isProcessing = true;
    }
}

function handleDuplicateOption(option) {
    document.getElementById('duplicate-modal').style.display = 'none';
    isProcessing = false;
    
    if (option === 'overwrite') {
        processValidScan(currentPendingScan, 'UPDATE');
    } else if (option === 'append') {
        processValidScan(currentPendingScan, 'APPEND');
    } else if (option === 'skip') {
        showToast("Đã bỏ qua mã trùng");
        lastScanTime = Date.now();
    }
    
    currentPendingScan = null;
}

// --- LOGIC HÀNG ĐỢI ĐỒNG BỘ ---
function saveToQueue(data) {
    let queue = JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    queue.unshift(data);
    localStorage.setItem('nvh_scan_queue', JSON.stringify(queue.slice(0, 500)));
    loadLocalHistory();
}

let isSyncing = false;
async function processSyncQueue() {
    if (isSyncing) return;
    let queue = JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    const unsyncedItems = queue.filter(item => !item.synced);
    if (unsyncedItems.length === 0) return;
    
    isSyncing = true;
    const itemToSync = unsyncedItems[unsyncedItems.length - 1];
    
    // Chuẩn bị dữ liệu gửi đi
    const payload = {
        action: itemToSync.action || "APPEND",
        orderId: itemToSync.orderId,
        content: itemToSync.content,
        scanTime: itemToSync.scanTime
    };

    const success = await sendToGoogleSheets(payload);
    if (success) {
        queue = queue.map(item => item.id === itemToSync.id ? { ...item, synced: true } : item);
        localStorage.setItem('nvh_scan_queue', JSON.stringify(queue));
        
        if (document.getElementById('scanned-result').innerText === itemToSync.content) {
            document.getElementById('sync-status').innerText = (payload.action === 'UPDATE' ? "Đã ghi đè thành công!" : "Đã đồng bộ thành công!");
            document.getElementById('sync-status').style.color = "var(--success)";
        }
        
        loadLocalHistory();
        isSyncing = false;
        setTimeout(processSyncQueue, 500);
    } else {
        isSyncing = false;
        setTimeout(processSyncQueue, 5000);
    }
}

async function sendToGoogleSheets(payload) {
    try {
        await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        return true;
    } catch (error) { return false; }
}

// --- LOGIC DỮ LIỆU TỪ SHEETS ---

let searchTimeout;
function filterRemoteData(immediate = false) {
    const query = document.getElementById('remote-search-input').value.toLowerCase();
    
    const filtered = remoteDataCache.filter(item => 
        (item.content && item.content.toLowerCase().includes(query)) || 
        (item.orderId && item.orderId.toLowerCase().includes(query))
    );
    displayRemoteData(filtered);

    clearTimeout(searchTimeout);
    if (query.length >= 3 || immediate) {
        searchTimeout = setTimeout(() => searchRemoteSheets(query), immediate ? 0 : 800);
    }
}

async function searchRemoteSheets(query) {
    const list = document.getElementById('remote-data-list');
    const refreshBtn = document.getElementById('refresh-icon');
    if (refreshBtn) refreshBtn.parentElement.classList.add('refreshing');

    try {
        const response = await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ action: "SEARCH", query: query }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const data = await response.json();
        
        if (query.length > 5) {
            remoteDataCache = data;
        } else {
            data.forEach(newItem => {
                const idx = remoteDataCache.findIndex(old => old.orderId === newItem.orderId);
                if (idx === -1) remoteDataCache.unshift(newItem);
                else remoteDataCache[idx] = newItem; 
            });
        }
        
        displayRemoteData(data);
    } catch (error) {
        console.error("Search error:", error);
    } finally {
        if (refreshBtn) refreshBtn.parentElement.classList.remove('refreshing');
    }
}

async function fetchDataFromSheets(isAuto = false) {
    const btn = document.querySelector('.refresh-btn');
    if (btn) btn.classList.add('refreshing');
    try {
        const response = await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ action: "GET_ALL" }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const data = await response.json();
        remoteDataCache = data;
        localStorage.setItem('nvh_remote_cache', JSON.stringify(data));
        localStorage.setItem('nvh_last_update', new Date().toLocaleString('vi-VN'));
        displayRemoteData();
        if (!isAuto) showToast("Đã cập nhật dữ liệu!");
    } catch (error) {
        if (!isAuto) showToast("Lỗi cập nhật!");
    } finally {
        if (btn) btn.classList.remove('refreshing');
    }
}

function displayRemoteData(dataToDisplay = null) {
    const list = document.getElementById('remote-data-list');
    const data = dataToDisplay || remoteDataCache;
    const lastUpdate = localStorage.getItem('nvh_last_update') || "Chưa rõ";
    
    const query = document.getElementById('remote-search-input') ? document.getElementById('remote-search-input').value.trim() : "";
    
    if (!query && !dataToDisplay) {
        list.innerHTML = "<p class='empty-msg'>Vui lòng nhập mã để tìm kiếm.</p>";
        return;
    }

    if (!data || data.length === 0) {
        list.innerHTML = "<p class='empty-msg'>Không tìm thấy dữ liệu.</p>";
        return;
    }

    list.innerHTML = data.map(item => `
        <div class="history-item ${selectedRemoteItem && selectedRemoteItem.orderId === item.orderId ? 'selected' : ''}" 
             onclick='selectRemoteItem(${JSON.stringify(item).replace(/'/g, "&apos;")})'>
            <div class="history-item-header">
                <strong>${item.content || 'N/A'}</strong>
                <span class="history-item-time highlight-time">${item.scanTime}</span>
            </div>
            <div class="history-item-content" style="font-size: 0.75rem; opacity: 0.7;">ID: ${item.orderId}</div>
        </div>
    `).join('');
}

function selectRemoteItem(item) {
    selectedRemoteItem = item;
    displayRemoteData();

    document.getElementById('item-detail-panel').style.display = 'block';
    document.getElementById('detail-time').innerText = item.scanTime;
    document.getElementById('detail-content-val').innerText = item.content || '...';
    document.getElementById('detail-id').innerText = item.orderId;
    
    // Cuộn xuống để xem chi tiết
    document.getElementById('item-detail-panel').scrollIntoView({ behavior: 'smooth' });
    
    showToast("Đã chọn đơn: " + (item.content || item.orderId));
}

function copyOrderCode() {
    const code = document.getElementById('detail-content-val').innerText;
    if (!code || code === '...') return;
    navigator.clipboard.writeText(code).then(() => {
        showToast("📋 Đã copy mã đơn hàng: " + code);
    });
}

// --- LOGIC LỊCH SỬ TẠI MÁY ---
function loadLocalHistory(filteredData = null) {
    const list = document.getElementById('history-list');
    const history = filteredData || JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    if (history.length === 0) {
        list.innerHTML = "<p class='empty-msg'>Trống.</p>";
        return;
    }
    list.innerHTML = history.map(item => `
        <div class="history-item">
            <span class="sync-badge ${item.synced ? 'badge-synced' : 'badge-pending'}">
                ${item.synced ? 'Đã gửi' : 'Chờ gửi'}
            </span>
            <div class="history-item-header">
                <strong>ID quét: ${item.orderId}</strong>
                <span class="history-item-time">${item.scanTime}</span>
            </div>
            <div class="history-item-content">${item.content}</div>
        </div>
    `).join('');
}

function filterHistory() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const history = JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    const filtered = history.filter(item => 
        item.content.toLowerCase().includes(query) || item.orderId.toLowerCase().includes(query)
    );
    loadLocalHistory(filtered);
}

function startSearchScan(target) {
    searchTarget = target;
    switchTab('scan');
    isSearchScanning = true;
    showToast(`Quét mã để tìm trong ${target === 'history' ? 'máy' : 'Hệ thống'}...`);
    if (!isScanning) toggleScanner();
}

function clearLocalHistory() {
    if (confirm("Xóa toàn bộ lịch sử?")) {
        localStorage.removeItem('nvh_scan_queue');
        loadLocalHistory();
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.add('show');
    toast.style.transform = "translateX(-50%) translateY(0)";
    setTimeout(() => {
        toast.style.transform = "translateX(-50%) translateY(100px)";
        setTimeout(() => toast.classList.remove('show'), 400);
    }, 2500);
}

// --- LOGIC BẢO MẬT MÃ PIN ---
function checkSecurity() {
    const isVerified = localStorage.getItem('nvh_verified') === 'true';
    const modal = document.getElementById('passcode-modal');
    if (isVerified) {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'flex';
        document.getElementById('passcode-input').focus();
    }
}

function validatePasscode() {
    const input = document.getElementById('passcode-input').value;
    const errorEl = document.getElementById('passcode-error');
    if (input === '310824') {
        localStorage.setItem('nvh_verified', 'true');
        document.getElementById('passcode-modal').style.display = 'none';
        showToast("Xác thực thành công!");
        // Khởi tạo mặc định sau xác thực
        if (localStorage.getItem('nvh_sound_type') === null) {
            localStorage.setItem('nvh_sound_type', 'standard');
            localStorage.setItem('nvh_vibrate', 'true');
        }
    } else {
        errorEl.style.display = 'block';
        document.getElementById('passcode-input').value = '';
        setTimeout(() => { errorEl.style.display = 'none'; }, 2000);
    }
}

// --- LOGIC SIDEBAR (DRAWER) ---
function toggleDrawer(show) {
    const drawer = document.getElementById('side-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (show) {
        drawer.classList.add('active');
        if (overlay) overlay.classList.add('active');
    } else {
        drawer.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
}

function openSettings(group) {
    const template = document.getElementById('tmpl-' + group);
    const body = document.getElementById('settings-body');
    const title = document.getElementById('settings-title');
    const modal = document.getElementById('settings-modal');
    
    if (!template || !body) return;
    
    const titles = {
        'scan': 'THIẾT LẬP QUÉT',
        'storage': 'LƯU TRỮ & PC MODE',
        'camera': 'CẤU HÌNH CAMERA',
        'changelog': 'NHẬT KÝ THAY ĐỔI'
    };
    title.innerText = titles[group] || 'CÀI ĐẶT';
    body.innerHTML = template.innerHTML;
    
    if (group === 'scan') {
        const soundSelect = document.getElementById('sound-select-modal');
        const vibrateToggle = document.getElementById('vibrate-toggle-modal');
        if (soundSelect) soundSelect.value = localStorage.getItem('nvh_sound_type') || 'standard';
        if (vibrateToggle) vibrateToggle.checked = localStorage.getItem('nvh_vibrate') !== 'false';
    } else if (group === 'storage') {
        const pcToggle = document.getElementById('pc-mode-toggle-modal');
        const driveInput = document.getElementById('drive-folder-id-modal');
        const hddStatus = document.getElementById('hdd-status-modal');
        if (pcToggle) pcToggle.checked = localStorage.getItem('nvh_pc_mode') === 'true';
        if (driveInput) driveInput.value = localStorage.getItem('nvh_drive_folder_id') || '';
        if (hddStatus && hddFolderHandle) {
            hddStatus.innerText = "Đã cấp quyền thư mục Local";
            hddStatus.style.color = "var(--success)";
        }
    } else if (group === 'camera') {
        updateCameraList(true);
    }
    
    toggleDrawer(false);
    modal.style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function saveModalSettings() {
    const sound = document.getElementById('sound-select-modal')?.value;
    const vibrate = document.getElementById('vibrate-toggle-modal')?.checked;
    const driveId = document.getElementById('drive-folder-id-modal')?.value;
    const scannerCam = document.getElementById('scanner-cam-select-modal')?.value;
    const m1Cam = document.getElementById('monitor1-cam-select-modal')?.value;
    const m2Cam = document.getElementById('monitor2-cam-select-modal')?.value;

    if (sound !== undefined) localStorage.setItem('nvh_sound_type', sound);
    if (vibrate !== undefined) localStorage.setItem('nvh_vibrate', vibrate);
    if (driveId !== undefined) localStorage.setItem('nvh_drive_folder_id', driveId);
    
    if (scannerCam) localStorage.setItem('nvh_scanner_cam_id', scannerCam);
    if (m1Cam) localStorage.setItem('nvh_monitor1_cam_id', m1Cam);
    if (m2Cam) localStorage.setItem('nvh_monitor2_cam_id', m2Cam);
    
    // Đồng bộ ngược lại cho cũ
    if (scannerCam) localStorage.setItem('nvh_camera_id', scannerCam);

    if (isScanning) {
        stopScanner().then(() => { if (!pcMode) toggleScanner(); else startScanning(); });
    }
}

function togglePCModeFromModal(checked) {
    localStorage.setItem('nvh_pc_mode', checked);
    togglePCMode();
}

function previewSound(val) {
    playBeep(val);
    saveModalSettings();
}

window.onload = () => {
    // Khởi tạo mặc định
    if (localStorage.getItem('nvh_sound_type') === null) {
        localStorage.setItem('nvh_sound_type', 'standard');
        localStorage.setItem('nvh_vibrate', 'true');
    }
    
    // Khôi phục PC Mode: Nếu là máy tính và chưa có thiết lập thì mặc định là bật
    let savedPCMode = localStorage.getItem('nvh_pc_mode');
    const isMobile = isMobileDevice();

    if (savedPCMode === null) {
        // Lần đầu sử dụng trên máy tính -> Mặc định bật
        savedPCMode = !isMobile;
        localStorage.setItem('nvh_pc_mode', savedPCMode);
    } else {
        savedPCMode = (savedPCMode === 'true');
    }

    if (savedPCMode && !isMobile) {
        document.getElementById('pc-mode-toggle').checked = true;
        togglePCMode();
    }

    document.getElementById('drive-folder-id').value = localStorage.getItem('nvh_drive_folder_id') || "";
    document.getElementById('auto-record-toggle').checked = autoRecordEnabled;

    checkSecurity(); 
    loadLocalHistory();
    const cache = localStorage.getItem('nvh_remote_cache');
    if (cache) { remoteDataCache = JSON.parse(cache); displayRemoteData(); }
    fetchDataFromSheets(true);
    setTimeout(processSyncQueue, 2000);
    setInterval(updateUploadIndicator, 3000);
    // Tự động nhận diện camera lúc khởi động v1.7.2
    setTimeout(updateCameraList, 1000);
};

// --- LOGIC PC MODE & RECORDING (NEW v1.6.5) ---

function isMobileDevice() {
    return (window.innerWidth <= 800) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function togglePCMode() {
    const toggle = document.getElementById('pc-mode-toggle');
    
    if (toggle.checked && isMobileDevice()) {
        showToast("⚠️ Chế độ PC không hỗ trợ trên điện thoại.");
        toggle.checked = false;
        return;
    }

    pcMode = toggle.checked;
    localStorage.setItem('nvh_pc_mode', pcMode);
    
    const container = document.getElementById('app-container');
    const monitor = document.getElementById('pc-monitor');
    const cam2Group = document.getElementById('pc-camera-2-group');

    if (pcMode) {
        container.classList.add('pc-layout');
        monitor.style.display = 'flex';
        cam2Group.style.display = 'block';
        updateCameraList(); 
    } else {
        container.classList.remove('pc-layout');
        monitor.style.display = 'none';
        cam2Group.style.display = 'none';
        if (isScanning) stopScanner();
    }
}

function toggleAutoRecord() {
    autoRecordEnabled = document.getElementById('auto-record-toggle').checked;
    localStorage.setItem('nvh_auto_record', autoRecordEnabled);
    showToast(autoRecordEnabled ? "✔️ Đã bật Tự động ghi khi quét" : "⏹️ Đã tắt Tự động ghi khi quét");
}

function manualStartRecording() {
    if (recordingActive) return;
    
    if (!lastScannedId) {
        showToast("⚠️ Vui lòng quét mã đơn hàng trước khi ghi hình!");
        return;
    }
    
    startDualRecording(lastScannedId);
}

async function requestHDDPermission() {
    try {
        hddFolderHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });
        document.getElementById('hdd-status').innerText = "Đã cấp quyền thư mục Local";
        document.getElementById('hdd-status').style.color = "var(--success)";
        showToast("Đã cấp quyền truy cập thư mục máy tính!");
    } catch (err) {
        showToast("Bạn đã từ chối hoặc trình duyệt không hỗ trợ File System Access API.");
    }
}

let chunks1 = [], chunks2 = [];
function startDualRecording(orderId) {
    if (recordingActive) return;
    
    const streams = recorderStreams;
    if (streams.length < 1) {
        showToast("Không tìm thấy luồng Camera để ghi hình!");
        return;
    }

    recordingActive = true;
    mediaRecorders = [];
    chunks1 = []; chunks2 = [];
    
    // Khởi tạo recorder cho Camera 1
    const rec1 = new MediaRecorder(streams[0], { mimeType: 'video/webm' });
    rec1.ondataavailable = (e) => { if (e.data.size > 0) chunks1.push(e.data); };
    rec1.onstop = () => finalizeRecording(orderId, 1, chunks1);
    
    mediaRecorders.push(rec1);
    rec1.start();

    // Khởi tạo cho Camera 2 nếu có
    if (streams[1]) {
        const rec2 = new MediaRecorder(streams[1], { mimeType: 'video/webm' });
        rec2.ondataavailable = (e) => { if (e.data.size > 0) chunks2.push(e.data); };
        rec2.onstop = () => finalizeRecording(orderId, 2, chunks2);
        mediaRecorders.push(rec2);
        rec2.start();
    }

    // Giao diện
    document.getElementById('recording-status').style.display = 'flex';
    document.getElementById('pc-rec-indicator').style.display = 'block';
    startRecTimer();
    showToast("🔴 ĐANG GHI HÌNH ĐƠN: " + orderId);
    
    // UI Update v1.6.5
    const startBtn = document.getElementById('manual-rec-btn');
    const stopBtn = document.getElementById('manual-stop-btn');
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.style.opacity = "0.5";
        stopBtn.disabled = false;
        stopBtn.style.opacity = "1";
    }
}

function startRecTimer() {
    recStartTime = Date.now();
    const timerEl = document.getElementById('rec-timer');
    recTimerInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - recStartTime) / 1000);
        const m = Math.floor(diff / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        timerEl.innerText = `${m}:${s}`;
    }, 1000);
}

function stopRecordingManually() {
    if (!recordingActive) return;
    stopDualRecording();
}

function stopDualRecording() {
    if (!recordingActive) return;
    
    mediaRecorders.forEach(r => r.stop());
    recordingActive = false;
    
    clearInterval(recTimerInterval);
    document.getElementById('recording-status').style.display = 'none';
    document.getElementById('pc-rec-indicator').style.display = 'none';
    showToast("💾 Đang xử lý lưu Video...");

    // UI Update v1.6.5
    const startBtn = document.getElementById('manual-rec-btn');
    const stopBtn = document.getElementById('manual-stop-btn');
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.style.opacity = "1";
        stopBtn.disabled = true;
        stopBtn.style.opacity = "0.5";
    }
}

async function finalizeRecording(orderId, camIndex, chunks) {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const fileName = `${orderId}_CAM${camIndex}.webm`;
    
    // 1. Lưu Local HDD (Âm thầm nếu có quyền)
    if (hddFolderHandle) {
        try {
            const fileHandle = await hddFolderHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } catch (err) { console.error("HDD Save error:", err); }
    } else if (db) {
        // Lưu vào IndexedDB (Mobile)
        const trans = db.transaction(["videos"], "readwrite");
        trans.objectStore("videos").put(blob, fileName);
    } else {
        // Tự động tải về nếu không có quyền Directory
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
    }

    // 2. Thêm vào hàng đợi Upload Drive (Âm thầm)
    addToUploadQueue(fileName, blob);
}

function addToUploadQueue(fileName, blob) {
    uploadQueue.push({ fileName, blob, attempts: 0 });
    processUploadQueue();
}

let isUploading = false;
async function processUploadQueue() {
    if (isUploading || uploadQueue.length === 0) return;
    
    isUploading = true;
    const item = uploadQueue[0];
    const folderId = localStorage.getItem('nvh_drive_folder_id');

    if (!folderId) {
        showToast("⚠️ Chưa cấu hình Drive Folder ID! Video chỉ lưu ở máy.");
        uploadQueue.shift();
        isUploading = false;
        return;
    }

    const fileId = "vid_" + Date.now();
    const chunkSize = 2 * 1024 * 1024; // 2MB mỗi phần
    const totalChunks = Math.ceil(item.blob.size / chunkSize);

    try {
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, item.blob.size);
            const chunk = item.blob.slice(start, end);
            
            const reader = new FileReader();
            const chunkBase64 = await new Promise(resolve => {
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(chunk);
            });

            const payload = {
                action: "UPLOAD_CHUNK",
                fileId: fileId,
                fileName: item.fileName,
                folderId: folderId,
                chunkData: chunkBase64,
                chunkIndex: i,
                totalChunks: totalChunks
            };

            await fetch(APP_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify(payload)
            });
        }
        
        showToast("✔️ Đã đồng bộ Cloud: " + item.fileName);
        uploadQueue.shift();
    } catch (err) {
        console.error("Upload error:", err);
        item.attempts++;
        if (item.attempts > 3) uploadQueue.shift(); // Bỏ qua nếu lỗi 3 lần
    } finally {
        isUploading = false;
        setTimeout(processUploadQueue, 2000);
    }
}

function updateUploadIndicator() {
    const statusEl = document.getElementById('sync-status');
    if (uploadQueue.length > 0) {
        statusEl.innerText = `☁️ Đang tải lên Cloud (${uploadQueue.length} file)...`;
        statusEl.style.color = "var(--warning)";
    }
}

// --- LOGIC XEM LẠI (REVIEW TAB) ---

// --- LOGIC GỢI Ý TAB XEM LẠI ---
let selectedReviewItem = null;
function filterReviewData() {
    const query = document.getElementById('review-order-id').value.toLowerCase().trim();
    const list = document.getElementById('review-data-list');
    
    if (query.length < 3) {
        list.style.display = 'none';
        return;
    }

    const filtered = remoteDataCache.filter(item => 
        (item.content && item.content.toLowerCase().includes(query)) || 
        (item.orderId && item.orderId.toLowerCase().includes(query))
    );

    if (filtered.length > 0) {
        list.style.display = 'block';
        list.innerHTML = filtered.slice(0, 10).map(item => `
            <div class="history-item" onclick='selectReviewItem(${JSON.stringify(item).replace(/'/g, "&apos;")})'>
                <div class="history-item-header">
                    <strong>${item.content || item.orderId}</strong>
                    <span class="history-item-time">${item.scanTime}</span>
                </div>
                <div class="history-item-content" style="font-size: 0.7rem; opacity: 0.6;">ID: ${item.orderId}</div>
            </div>
        `).join('');
    } else {
        list.innerHTML = "<p class='empty-msg'>Không tìm thấy mã đơn này.</p>";
    }
}

function selectReviewItem(item) {
    selectedReviewItem = item;
    document.getElementById('review-order-id').value = item.content || item.orderId;
    document.getElementById('review-data-list').style.display = 'none';
    
    // Hiển thị panel thông tin đơn đang chọn v1.6.9
    const panel = document.getElementById('review-detail-panel');
    panel.style.display = 'block';
    document.getElementById('review-detail-time').innerText = item.scanTime;
    document.getElementById('review-detail-content').innerText = item.content || '...';
    document.getElementById('review-detail-id').innerText = item.orderId;
    
    // Kiểm tra trạng thái video
    checkVideoStatus(item.orderId);
    
    showToast("Đã chọn đơn: " + (item.content || item.orderId));
}

/* --- VIDEO STATUS & DOWNLOAD LOGIC v1.6.8 --- */

function copyOrderId() {
    const id = document.getElementById('detail-id').innerText;
    if (!id || id === '...') return;
    navigator.clipboard.writeText(id).then(() => {
        showToast("📋 Đã copy mã đơn: " + id);
    });
}

async function checkVideoStatus(orderId) {
    const statusCloud = document.getElementById('status-cloud');
    const statusLocal = document.getElementById('status-local');
    const btnSync = document.getElementById('btn-sync-play');
    const downloadContainer = document.getElementById('download-container');

    statusCloud.className = 'status-badge';
    statusCloud.innerText = '☁️ Cloud';
    statusLocal.className = 'status-badge';
    statusLocal.innerText = '📂 Máy';

    // 1. Kiểm tra Local (HDD hoặc IDB)
    let isLocal = false;
    if (hddFolderHandle) {
        try {
            await hddFolderHandle.getFileHandle(`${orderId}_CAM1.webm`);
            isLocal = true;
        } catch (e) { isLocal = false; }
    }
    
    // Nếu HDD không có, check trong IndexedDB (Mobile v1.7.0)
    if (!isLocal && db) {
        const video = await getVideoFromIDB(`${orderId}_CAM1.webm`);
        if (video) isLocal = true;
    }

    if (isLocal) {
        statusLocal.className = 'status-badge available';
        statusLocal.innerText = '📂 Đã có trên Máy';
        btnSync.disabled = false;
        btnSync.classList.remove('disabled');
        downloadContainer.style.display = 'none';
    } else {
        statusLocal.className = 'status-badge missing';
        statusLocal.innerText = '📂 Chưa có trên Máy';
        btnSync.disabled = true;
        btnSync.classList.add('disabled');
        downloadContainer.style.display = 'block';
    }

    // 2. Kiểm tra Cloud
    try {
        const response = await fetch(APP_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "CHECK_FILE", fileName: `${orderId}_CAM1.webm` })
        });
        const result = await response.json();
        
        if (result && result.exists) {
            statusCloud.className = 'status-badge available';
            statusCloud.innerText = '☁️ Đã có trên Cloud';
            if (!isLocal) downloadContainer.style.display = 'block';
        } else {
            statusCloud.className = 'status-badge missing';
            statusCloud.innerText = '☁️ Không có trên Cloud';
            if (!isLocal) downloadContainer.style.display = 'none';
        }
    } catch (err) {
        statusCloud.innerText = '☁️ Lỗi Cloud';
    }
}

async function getVideoFromIDB(name) {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        const trans = db.transaction(["videos"], "readonly");
        const store = trans.objectStore("videos");
        const req = store.get(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function clearLocalVideoCache() {
    if (!confirm("⚠️ Bạn có chắc muốn xóa toàn bộ bộ nhớ Video trên iPhone/Trình duyệt này?")) return;
    const trans = db.transaction(["videos"], "readwrite");
    const store = trans.objectStore("videos");
    const req = store.clear();
    req.onsuccess = () => {
        showToast("✔️ Đã xóa sạch bộ nhớ Video.");
        if (selectedReviewItem) checkVideoStatus(selectedReviewItem.orderId);
    };
}

async function downloadVideoFromCloud() {
    if (!selectedReviewItem) return;
    const orderId = selectedReviewItem.orderId;
    const btnText = document.getElementById('download-text');
    const progressFill = document.getElementById('download-progress');
    const btnDownload = document.getElementById('btn-download');

    btnDownload.disabled = true;
    btnDownload.style.opacity = "0.7";
    btnText.innerText = "ĐANG TẢI...";
    progressFill.style.width = "0%";

    try {
        const cams = ['CAM1', 'CAM2'];
        for (let i = 0; i < cams.length; i++) {
            const cam = cams[i];
            const fileName = `${orderId}_${cam}.webm`;
            
            const response = await fetch(APP_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: "DOWNLOAD_VIDEO", fileName: fileName })
            });

            if (!response.ok) continue;
            const result = await response.json();
            if (!result.base64) continue;
            
            // Chuyển sang blob
            const byteCharacters = atob(result.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let j = 0; j < byteCharacters.length; j++) byteNumbers[j] = byteCharacters.charCodeAt(j);
            const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'video/webm' });

            // Lưu vào HDD nếu có, hoặc IDB nếu không (Mobile)
            if (hddFolderHandle) {
                const fileHandle = await hddFolderHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else if (db) {
                const trans = db.transaction(["videos"], "readwrite");
                trans.objectStore("videos").put(blob, fileName);
            }
            
            progressFill.style.width = ((i + 1) / cams.length * 100) + "%";
        }

        showToast("✔️ Tải video thành công!");
        checkVideoStatus(orderId);
    } catch (err) {
        showToast("❌ Lỗi khi tải video!");
        btnDownload.disabled = false;
        btnDownload.style.opacity = "1";
        btnText.innerText = "TẢI LẠI";
    }
}

function lookupAndPlayVideo() {
    const orderId = document.getElementById('review-order-id').value.trim();
    if (!orderId) {
        showToast("⚠️ Vui lòng nhập hoặc chọn mã đơn!");
        return;
    }
    showToast("Vui lòng chọn video của mã " + orderId);
    promptLocalFiles(orderId);
}

async function promptLocalFiles(targetOrderId = null) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/webm';
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length < 1) return;
        const v1 = document.getElementById('video-review-1');
        const v2 = document.getElementById('video-review-2');
        let matched = false;
        files.forEach(file => {
            const fileName = file.name.toUpperCase();
            const orderId = (targetOrderId || "").toUpperCase();
            if (orderId && !fileName.includes(orderId)) return;
            const url = URL.createObjectURL(file);
            if (fileName.includes('CAM1')) { v1.src = url; matched = true; }
            else if (fileName.includes('CAM2')) { v2.src = url; matched = true; }
            else if (files.length === 1) { v1.src = url; matched = true; }
        });
        if (!matched) {
            showToast("❌ Không tìm thấy video hợp lệ cho mã đơn này!");
        } else {
            showToast("✔️ Đã tải video thành công!");
            syncPlayPause();
        }
    };
    input.click();
}

async function syncPlayPause() {
    const v1 = document.getElementById('video-review-1');
    const v2 = document.getElementById('video-review-2');
    if (!v1.src || !v2.src) {
        if (selectedReviewItem) {
            const orderId = selectedReviewItem.orderId;
            let blob1, blob2;
            if (hddFolderHandle) {
                try {
                    const h1 = await hddFolderHandle.getFileHandle(`${orderId}_CAM1.webm`);
                    const h2 = await hddFolderHandle.getFileHandle(`${orderId}_CAM2.webm`);
                    blob1 = await h1.getFile();
                    blob2 = await h2.getFile();
                } catch(e) {}
            }
            if (!blob1 && db) {
                blob1 = await getVideoFromIDB(`${orderId}_CAM1.webm`);
                blob2 = await getVideoFromIDB(`${orderId}_CAM2.webm`);
            }
            if (blob1) {
                v1.src = URL.createObjectURL(blob1);
                v2.src = URL.createObjectURL(blob2);
            } else {
                showToast("⚠️ Không tìm thấy video trên máy!");
                return;
            }
        } else return;
    }
    if (v1.paused) {
        v1.play();
        if (v2.src) { v2.currentTime = v1.currentTime; v2.play(); }
    } else { v1.pause(); v2.pause(); }
}

async function refreshCameraList() {
    try {
        showToast("Đang yêu cầu quyền truy cập Camera...");
        // Ép buộc yêu cầu quyền
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        
        // Đợi 800ms để phần cứng và trình duyệt cập nhật danh sách thiết bị
        showToast("⏳ Đang nhận diện phần cứng...");
        await new Promise(r => setTimeout(r, 800));
        
        stream.getTracks().forEach(track => track.stop());
        await updateCameraList();
        showToast("✔️ Danh sách Camera đã được cập nhật!");
    } catch (err) {
        showToast("❌ Không thể lấy quyền Camera. Vui lòng kiểm tra biểu tượng 🔒 trên thanh địa chỉ!");
        console.error("Refresh Cam Error:", err);
    }
}

function saveDeviceSettings() {
    localStorage.setItem('nvh_sound_type', document.getElementById('sound-select').value);
    localStorage.setItem('nvh_vibrate', document.getElementById('vibrate-toggle').checked);
    localStorage.setItem('nvh_scanner_cam_id', document.getElementById('scanner-cam-select').value);
    localStorage.setItem('nvh_monitor1_cam_id', document.getElementById('monitor1-cam-select').value);
    localStorage.setItem('nvh_monitor2_cam_id', document.getElementById('monitor2-cam-select').value);

    localStorage.setItem('nvh_drive_folder_id', document.getElementById('drive-folder-id')?.value || "");

    if (isScanning) {
        stopScanner().then(() => { if (!pcMode) toggleScanner(); else startScanning(); });
    }
}

async function updateCameraList(isModal = false) {
    const sScanner = document.getElementById(isModal ? 'scanner-cam-select-modal' : 'scanner-cam-select');
    const sM1 = document.getElementById(isModal ? 'monitor1-cam-select-modal' : 'monitor1-cam-select');
    const sM2 = document.getElementById(isModal ? 'monitor2-cam-select-modal' : 'monitor2-cam-select');
    if (!sScanner) return;

    try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
            const options = devices.map(d => `<option value="${d.id}">${d.label || 'Camera ' + d.id.substr(0,4)}</option>`).join('');
            sScanner.innerHTML = options;
            sM1.innerHTML = options;
            sM2.innerHTML = '<option value="">-- Không dùng --</option>' + options;
            
            sScanner.value = localStorage.getItem('nvh_scanner_cam_id') || localStorage.getItem('nvh_camera_id') || devices[0].id;
            sM1.value = localStorage.getItem('nvh_monitor1_cam_id') || devices[0].id;
            sM2.value = localStorage.getItem('nvh_monitor2_cam_id') || "";
        } else {
            const noCam = '<option value="">❌ Không tìm thấy thiết bị</option>';
            sScanner.innerHTML = noCam; sM1.innerHTML = noCam; sM2.innerHTML = noCam;
        }
    } catch (err) { 
        console.error("Camera detection error:", err); 
    }
}

// --- LOGIC PC MODE ACTIONS v1.7.1 ---

async function startScanning() {
    if (isScanning) { stopScanner(); return; }
    const camId = document.getElementById('scanner-cam-select').value;
    if (!camId) { showToast("⚠️ Vui lòng chọn Camera Quét!"); return; }

    const btn = document.getElementById('pc-scan-btn');
    const mainText = btn.querySelector('.btn-main-text');
    
    try {
        if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
        await html5QrCode.start(camId, { 
            fps: 20, 
            qrbox: (w, h) => {
                const size = Math.min(w, h) * 0.85; // To gần bằng khung ngoài
                return { width: size, height: size };
            }
        }, onScanSuccess);
        isScanning = true;
        mainText.innerText = "DỪNG QUÉT";
        btn.classList.add('active');
        showToast("✔️ Đang quét mã...");
        
        // Tự động bật monitoring nếu đang ở PC Mode
        if (pcMode) startDualMonitoring();
    } catch (err) {
        showToast("❌ Không thể khởi động Camera quét: " + err);
    }
}

async function startDualMonitoring() {
    const cam1Id = document.getElementById('monitor1-cam-select').value;
    const cam2Id = document.getElementById('monitor2-cam-select').value;
    const v1 = document.getElementById('pc-video-1');
    const v2 = document.getElementById('pc-video-2');

    if (!cam1Id) return;

    try {
        // Stream 1 (Góc Cận)
        const s1 = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cam1Id } });
        v1.srcObject = s1;
        recorderStreams[0] = s1;
        document.getElementById('monitor-cam-1').style.display = 'none';

        // Stream 2 (Góc Toàn) nếu chọn
        if (cam2Id) {
            const s2 = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cam2Id } });
            v2.srcObject = s2;
            recorderStreams[1] = s2;
            document.getElementById('monitor-cam-2').style.display = 'none';
        }
    } catch (err) {
        showToast("❌ Lỗi khởi động giám sát: " + err);
    }
}

function stopScanner() {
    return new Promise((resolve) => {
        if (!html5QrCode) return resolve();
        html5QrCode.stop().then(() => {
            isScanning = false;
            const btn = document.getElementById('pc-scan-btn');
            if (btn) {
                btn.querySelector('.btn-main-text').innerText = "BẮT ĐẦU QUÉT";
                btn.classList.remove('active');
            }
            // Stop monitoring streams
            recorderStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
            recorderStreams = [];
            document.getElementById('monitor-cam-1').style.display = 'flex';
            document.getElementById('monitor-cam-2').style.display = 'flex';
            resolve();
        }).catch(err => { console.error(err); resolve(); });
    });
}
