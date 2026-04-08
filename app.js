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
let hddFolderHandle = null; // Quyền truy cập thư mục máy tính
let uploadQueue = []; // Hàng đợi tải video lên Drive
let lastScannedId = null; // Lưu ID cuối cùng để ghi hình thủ công
let autoRecordEnabled = localStorage.getItem('nvh_auto_record') !== 'false';

// Cấu hình âm thanh & rung
let audioCtx;
const SOUND_PRESETS = {
    standard: { freq: 1200, type: 'sine', duration: 0.1, gain: 1.0 },
    double: { freq: 1500, type: 'square', duration: 0.05, repeat: 2, gain: 0.8 },
    deep: { freq: 400, type: 'triangle', duration: 0.2, gain: 1.2 },
    melody: { freq: [1000, 1200, 1500], type: 'sine', duration: 0.08, gain: 0.9 }
};

function playBeep(presetKey = null) {
    try {
        const key = presetKey || localStorage.getItem('nvh_sound_type') || 'standard';
        const preset = SOUND_PRESETS[key];
        
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const playTone = (freq, startTime, duration) => {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type = preset.type;
            osc.frequency.setValueAtTime(freq, startTime);
            gainNode.gain.setValueAtTime(preset.gain, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        let now = audioCtx.currentTime;
        if (Array.isArray(preset.freq)) {
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
                        const size = Math.min(w, h);
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
                <strong>ID: ${item.orderId || 'N/A'}</strong>
                <span class="history-item-time">${item.scanTime}</span>
            </div>
            <div class="history-item-content">${item.content}</div>
        </div>
    `).join('');
}

function selectRemoteItem(item) {
    selectedRemoteItem = item;
    displayRemoteData();

    document.getElementById('detail-time').innerText = item.scanTime;
    document.getElementById('detail-id').innerText = item.orderId;
    document.getElementById('detail-content').innerText = item.content;
    
    const timeEl = document.getElementById('detail-time');
    timeEl.style.animation = 'none';
    timeEl.offsetHeight; 
    timeEl.style.animation = 'flashEffect 0.5s ease-out';
    
    showToast("Đã chọn ID: " + item.orderId);
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
        // Load cấu hình lên UI trước khi hiện
        document.getElementById('sound-select').value = localStorage.getItem('nvh_sound_type') || 'standard';
        document.getElementById('vibrate-toggle').checked = localStorage.getItem('nvh_vibrate') !== 'false';
        
        updateCameraList(); // Cập nhật danh sách camera khi mở menu
        
        drawer.classList.add('active');
        overlay.classList.add('active');
    } else {
        drawer.classList.remove('active');
        overlay.classList.remove('active');
    }
}

function previewSound() {
    const key = document.getElementById('sound-select').value;
    playBeep(key);
    saveDeviceSettings(); // Lưu ngay khi đổi âm thanh
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
    setInterval(updateUploadIndicator, 3000); // Cập nhật trạng thái upload
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

function lookupAndPlayVideo() {
    const orderId = document.getElementById('review-order-id').value.trim();
    if (!orderId) return;

    // Ưu tiên tìm trong Local HDD (Yêu cầu người dùng chọn file vì bảo mật trình duyệt)
    showToast("Vui lòng chọn 2 file video của mã " + orderId);
    promptLocalFiles();
}

async function promptLocalFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/webm';
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length < 1) return;

        const v1 = document.getElementById('video-review-1');
        const v2 = document.getElementById('video-review-2');

        files.forEach(file => {
            const url = URL.createObjectURL(file);
            if (file.name.includes('CAM1')) v1.src = url;
            if (file.name.includes('CAM2')) v2.src = url;
            // Nếu chỉ có 1 cam hoặc tên không đúng cam, cứ gán đại
            if (files.length === 1) v1.src = url;
        });
    };
    input.click();
}

function syncPlayPause() {
    const v1 = document.getElementById('video-review-1');
    const v2 = document.getElementById('video-review-2');
    
    if (v1.paused) {
        v1.play();
        if (v2.src) {
            v2.currentTime = v1.currentTime;
            v2.play();
        }
    } else {
        v1.pause();
        v2.pause();
    }
}

function saveDeviceSettings() {
    localStorage.setItem('nvh_sound_type', document.getElementById('sound-select').value);
    localStorage.setItem('nvh_vibrate', document.getElementById('vibrate-toggle').checked);
    localStorage.setItem('nvh_camera_id', document.getElementById('camera-select').value);
    
    const cam2 = document.getElementById('camera-2-select').value;
    if (cam2) localStorage.setItem('nvh_camera_2_id', cam2);

    localStorage.setItem('nvh_drive_folder_id', document.getElementById('drive-folder-id').value);

    // Nếu đang quét mà đổi camera chính, khởi động lại
    if (isScanning) {
        stopScanner().then(() => toggleScanner());
    }
}

async function updateCameraList() {
    const select1 = document.getElementById('camera-select');
    const select2 = document.getElementById('camera-2-select');
    try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
            const options = devices.map(d => 
                `<option value="${d.id}">${d.label || 'Camera ' + d.id.substr(0,4)}</option>`
            ).join('');
            
            select1.innerHTML = options;
            select2.innerHTML = '<option value="">-- Không dùng --</option>' + options;
            
            // Khôi phục lựa chọn
            select1.value = localStorage.getItem('nvh_camera_id') || devices[0].id;
            select2.value = localStorage.getItem('nvh_camera_2_id') || "";
        }
    } catch (err) { console.error("Camera detection error:", err); }
}
