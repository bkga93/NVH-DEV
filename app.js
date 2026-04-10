// --- GHI NHỚ ĐĂNG NHẬP VĨNH VIỄN (DÙNG INDEXEDDB CHO IPHONE) ---
const DB_NAME = 'nvh_scanner_db';
const DB_VERSION = 1;
const STORE_NAME = 'auth_store';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function setAuthToken(value) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, 'nvh_verified');
    localStorage.setItem('nvh_verified', value); // Dự phòng thêm
}

async function getAuthToken() {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get('nvh_verified');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = () => resolve(null);
    });
}

// Cấu hình URL Google Apps Script chính thức từ bạn
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzw4v799F8zAANRMCfTDXG3O0HbDHoP9PvnDkjgZQGzaqpDlRnakOWpJocYROR8AzqqNg/exec";

let html5QrCode;
let isScanning = false;
let isSearchScanning = false;
let searchTarget = 'history'; // 'history' hoặc 'data'
let lastScanTime = 0;
let isProcessing = false;
const SCAN_DELAY = 1500;

// --- Cấu hình go2rtc (v2.2.0) ---
let go2rtcServer = localStorage.getItem('nvh_go2rtc_server') || 'http://localhost:1984';
let go2rtcSource = localStorage.getItem('nvh_go2rtc_source') || 'cam1';
let useIPCamera = localStorage.getItem('nvh_use_ip_camera') === 'true';
let pcGo2rtc = null; // RTCPeerConnection cho go2rtc

// Tracking v2.3.0
let activeSession = null; // { code, startTime, lastSeen, snapshot, id }
let sessionTimeout = null;

// --- BIẾN CỨU NGUY BẢO MẬT v1.8.7 (Anti-Loop Extreme) ---
window.isVerifiedSession = false; 

let searchScanner = null; // Trình quét cho Modal tìm kiếm
let remoteDataCache = [];
let selectedRemoteItem = null;
let currentPendingScan = null; 

function formatDate(date) {
    if (!(date instanceof Date)) date = new Date(date);
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${d}/${m}/${y} ${h}:${min}:${s}`;
}

function parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    if (dateStr instanceof Date) return dateStr;
    
    // Yêu cầu v1.1.7.3: Hỗ trợ Serial Date (46122,33355)
    let cleanStr = dateStr.toString().trim().replace(/-/g, '/');
    const serialValue = parseFloat(cleanStr.replace(',', '.'));
    if (!isNaN(serialValue) && serialValue > 40000 && serialValue < 60000) {
        return new Date((serialValue - 25569) * 86400 * 1000);
    }
    
    try {
        const parts = cleanStr.split(/[\s,]+/);
        let datePart = '', timePart = '';
        
        // Tự động nhận diện đâu là ngày, đâu là giờ (không phụ thuộc thứ tự)
        parts.forEach(p => {
            if (p.includes('/')) datePart = p;
            else if (p.includes(':')) timePart = p;
        });

        if (datePart) {
            const dateBits = datePart.split('/');
            if (dateBits.length === 3) {
                const day = parseInt(dateBits[0]);
                const month = parseInt(dateBits[1]) - 1;
                const year = parseInt(dateBits[2]);

                const timeBits = timePart ? timePart.split(':') : [0,0,0];
                const h = parseInt(timeBits[0] || 0);
                const m = parseInt(timeBits[1] || 0);
                const s = parseInt(timeBits[2] || 0);

                return new Date(year, month, day, h, m, s);
            }
        }
        
        // Trình duyện xử lý fallback
        const parsed = new Date(cleanStr);
        if (!isNaN(parsed.getTime())) return parsed;
        
        // Chỉ có ngày
        if (datePart) {
            const b = datePart.split('/');
            if (b.length === 3) return new Date(parseInt(b[2]), parseInt(b[1])-1, parseInt(b[0]));
        }
    } catch (e) {
        console.warn("Lỗi parse ngày tháng:", dateStr, e);
    }
    
    return new Date(0);
}

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
    try {
        const flash = document.getElementById('flash-overlay');
        if (flash) {
            flash.classList.add('flash-active');
            setTimeout(() => flash.classList.remove('flash-active'), 500);
        }
    } catch (e) { console.warn("Flash error:", e); }
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
    const activeBtnId = pcMode ? 'pc-scan-btn' : 'start-btn';
    const btn = document.getElementById(activeBtnId) || document.getElementById('start-btn');
    const mainText = btn?.querySelector('.btn-main-text');
    const subText = btn?.querySelector('.btn-sub-text');

    // Fix lỗi treo camera (v1.1.8.7) - Đảm bảo dừng hẳn trước khi bật
    if (html5QrCode) {
        try {
            const state = html5QrCode.getState();
            if (state === 2 || state === 3) { // 2=Scanning, 3=Paused
                await html5QrCode.stop();
            }
            html5QrCode = null;
        } catch(e) { console.warn("Stop scanner error:", e); }
    }
    
    // Đợi 1 nhịp nhỏ để trình duyệt giải phóng phần cứng
    await new Promise(r => setTimeout(r, 100));
    
    if (!isScanning) {
        try {
            if (!useIPCamera) {
                if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
                
                // Thông minh hóa việc tìm Camera ID
                const sModal = document.getElementById('scanner-cam-select-modal');
                const deviceId = (sModal && sModal.value) ? sModal.value : 
                                 (localStorage.getItem('nvh_scanner_cam_id') || localStorage.getItem('nvh_camera_id'));
                
                const cameraConfig = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" };

                playBeep();
                await html5QrCode.start(
                    cameraConfig,
                    { fps: 15 },
                    onScanSuccess
                );
            } else {
                // SỬ DỤNG CAMERA IP (go2rtc)
                await startIPCameraScanner();
            }

            // Tự động bật monitoring nếu đang ở PC Mode
            if (pcMode) startDualMonitoring();

            isScanning = true;
            if (btn) btn.classList.add('scanning', 'active');
            if (mainText) mainText.innerText = "DỪNG QUÉT";
            if (subText) subText.innerText = pcMode ? "Đang giám sát đa máy ảnh..." : "Vui lòng đưa mã vào khung hình";
        } catch (err) { 
            showToast("Lỗi khởi động camera: " + err); 
            console.error(err);
        }
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
    if (!html5QrCode) return;
    try {
        if (isScanning) await html5QrCode.stop();
        isScanning = false;
        
        const activeBtnId = pcMode ? 'pc-scan-btn' : 'start-btn';
        const btn = document.getElementById(activeBtnId) || document.getElementById('start-btn');
        const mainText = btn?.querySelector('.btn-main-text');
        
        if (btn) btn.classList.remove('scanning', 'active');
        if (mainText) mainText.innerText = "BẮT ĐẦU QUÉT";
        
        // Dừng các luồng giám sát
        recorderStreams.forEach(s => {
            if (s) s.getTracks().forEach(t => t.stop());
        });
        recorderStreams = [];
        
        const m1 = document.getElementById('monitor-cam-1');
        const m2 = document.getElementById('monitor-cam-2');
        if (m1) m1.style.display = 'flex';
        if (m2) m2.style.display = 'flex';
        
        const v1 = document.getElementById('pc-video-1');
        const v2 = document.getElementById('pc-video-2');
        if (v1) v1.srcObject = null;
        if (v2) v2.srcObject = null;

        // Dừng Camera IP nếu đang chạy
        stopIPCameraScanner();
    } catch (err) { 
        console.warn("Stop error:", err); 
        isScanning = false;
    }
}

// Khi quét thành công
async function onScanSuccess(decodedText) {
    try {
        const now = Date.now();
        if (isProcessing || (now - lastScanTime < SCAN_DELAY)) return;

        playBeep();
        triggerFlash();

        console.log("📢 Phát hiện mã:", decodedText);

        if (isSearchScanning) {
            if (searchTarget === 'history') {
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.value = decodedText;
                    filterHistory();
                }
            } else {
                const remoteSearch = document.getElementById('remote-search-input');
                if (remoteSearch) {
                    remoteSearch.value = decodedText;
                    filterRemoteData(true); 
                }
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
        const localQueueStr = localStorage.getItem('nvh_scan_queue');
        const localQueue = JSON.parse(localQueueStr || '[]');
        const isDuplicateLocal = localQueue.some(item => item.content === decodedText);

        if (isDuplicateRemote || isDuplicateLocal) {
            currentPendingScan = decodedText;
            showDuplicateModal(decodedText);
            return;
        }

        processValidScan(decodedText);
    } catch (err) {
        console.error("onScanSuccess error:", err);
        isProcessing = false;
    }
}

function processValidScan(decodedText, action = 'APPEND') {
    try {
        lastScanTime = Date.now();
        isProcessing = true;
        
        updatePCDisplay(decodedText);
        
        const statusMsg = document.getElementById('pc-pro-status-msg');
        if (statusMsg) statusMsg.innerText = "Đang xử lý...";
        
        const scanModeEl = document.querySelector('input[name="scanMode"]:checked');
        const scanMode = scanModeEl ? scanModeEl.value : 'single';
        
        // --- LOGIC TRACKING v2.3.0 (DÙNG CHUNG CHO CẢ USB & IP CAM) ---
        const isTracking = arguments[2] === true;
        let trackingData = arguments[3] || {};

        // Nếu quét từ Camera USB (không qua ipCameraScanLoop) thì tự tạo session
        if (!isTracking && pcMode && scanMode === 'continuous') {
            const now = Date.now();
            if (!activeSession || activeSession.code !== decodedText) {
                if (activeSession) finalizeSession();
                
                // Chụp ảnh từ Camera USB
                const video = document.querySelector('#reader video');
                let snapshot = '';
                if (video) {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    canvas.getContext('2d').drawImage(video, 0, 0);
                    snapshot = canvas.toDataURL('image/jpeg', 0.5);
                }

                activeSession = {
                    code: decodedText,
                    startTime: formatDate(now),
                    lastSeen: now,
                    snapshot: snapshot,
                    id: now
                };
                trackingData = activeSession;
                playBeep();
                showToast("📦 Bắt đầu đóng gói: " + decodedText);
                
                // Khởi động vòng lặp kiểm tra biến mất cho USB Cam
                if (!trackingInterval) trackingInterval = setInterval(checkSessionTimeout, 1000);
            } else {
                // Cập nhật thời gian thấy lần cuối
                activeSession.lastSeen = now;
                return; // Không cần xử lý tiếp để tránh lặp dòng
            }
        }

        const orderData = {
            id: trackingData.id || Date.now(),
            orderId: (decodedText && decodedText.length > 3) ? decodedText : ("NVH-" + Math.random().toString(36).substr(2, 6).toUpperCase()),
            content: decodedText || '--- ERR ---',
            scanTime: trackingData.startTime || formatDate(new Date()),
            endTime: trackingData.endTime || '',
            evidenceImage: trackingData.snapshot || '',
            synced: false,
            action: action 
        };
        
        if (!decodedText) {
            showToast("⚠️ CẢNH BÁO: Mã đơn trống! Vui lòng quét lại.", 5000);
            console.error("Critical: processValidScan empty decodedText");
        }

        saveToQueue(orderData);
        processSyncQueue();

        lastScannedId = orderData.orderId;
        updatePCDisplay(orderData.orderId);

        if (pcMode && typeof isAutoRec !== 'undefined' && isAutoRec && !isTracking) {
            if (recordingActive) stopDualRecording();
            setTimeout(() => startDualRecording(orderData.orderId), 300);
        }

        if (pcMode) updatePCRecentList(decodedText, 'success');

        if (scanMode === 'single' && !pcMode) setTimeout(() => stopScanner(), 500);
    } catch (err) {
        console.error("processValidScan error:", err);
    } finally {
        isProcessing = false;
    }
}

let trackingInterval = null;

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
    
    // Nếu là cập nhật trạng thái kết thúc v2.3.0
    if (data.action === 'UPDATE_END') {
        const index = queue.findIndex(item => item.orderId === data.orderId);
        if (index !== -1) {
            queue[index].endTime = data.endTime;
            queue[index].synced = false; // Đánh dấu để đồng bộ lại
            localStorage.setItem('nvh_scan_queue', JSON.stringify(queue));
            loadLocalHistory();
            return;
        }
    }
    
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
    
    // Chuẩn bị dữ liệu gửi đi v1.1.8.0 (3 cột: Người dùng, Mã đơn, Thời gian)
    const payload = {
        action: "APPEND",
        userName: localStorage.getItem('nvh_user_name') || 'NoName',
        content: itemToSync.content,
        scanTime: itemToSync.scanTime,
        // Dữ liệu phụ nếu cần (Sheets có thể bỏ qua)
        orderId: itemToSync.orderId,
        endTime: itemToSync.endTime || ''
    };

    const success = await sendToGoogleSheets(payload);
    if (success) {
        queue = queue.map(item => item.id === itemToSync.id ? { ...item, synced: true } : item);
        localStorage.setItem('nvh_scan_queue', JSON.stringify(queue));
        
        const lastScannedEl = document.getElementById('pc-last-scanned') || document.getElementById('pc-pro-last-scanned');
        if (lastScannedEl && lastScannedEl.innerText === itemToSync.content) {
            const statusMsg = document.getElementById('pc-pro-status-msg');
            if (statusMsg) {
                statusMsg.innerText = (payload.action === 'UPDATE' ? "Đã ghi đè thành công!" : "Đã đồng bộ thành công!");
                statusMsg.style.color = "var(--success)";
            }
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
    const input = document.getElementById('remote-search-input');
    if (!input) return;
    const query = input.value.trim().toLowerCase();
    
    // Yêu cầu v1.1.2: Chỉ tìm kiếm/gợi ý khi từ 3 ký tự trở lên
    if (query.length > 0 && query.length < 3) {
        displayRemoteData(); 
        clearTimeout(searchTimeout);
        return;
    }

    // Hiển thị kết quả từ cache cục bộ NGAY LẬP TỨC (Không dùng debounce cho cache)
    displayRemoteData();

    clearTimeout(searchTimeout);
    if (!query) return;

    // Chỉ tìm trên server nếu từ khóa >= 3 ký tự hoặc yêu cầu ngay
    if (query.length >= 3 || immediate) {
        searchTimeout = setTimeout(() => searchRemoteSheets(query), immediate ? 0 : 800);
    }
}

function showAllRemoteData() {
    const input = document.getElementById('remote-search-input');
    if (input) input.value = ""; // Xóa query để hiện tất cả
    displayRemoteData(remoteDataCache);
    showToast(`Đang hiển thị toàn bộ ${remoteDataCache.length} đơn hàng`, 5000);
}

function updateLastUpdateTimeDisplay(timeStr, count = 0) {
    const display = document.getElementById('last-update-display');
    if (!display) return;
    
    if (!timeStr) {
        display.innerText = "Chưa có dữ liệu.";
        return;
    }

    if (count > 0) {
        display.innerText = `Đã tải ${count} đơn lúc ${timeStr}`;
    } else {
        display.innerText = `Cập nhật: ${timeStr}`;
    }
}

async function searchRemoteSheets(query) {
    if (!query) return;
    const list = document.getElementById('remote-data-list');
    
    try {
        const response = await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ action: "SEARCH", query: query }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        const data = await response.json();
        
        // Cập nhật bộ nhớ đệm (Deduplicate khi nhận dữ liệu mới)
        if (data && data.length > 0) {
            data.forEach(newItem => {
                const idx = remoteDataCache.findIndex(old => old.content === newItem.content);
                if (idx === -1) {
                    remoteDataCache.unshift(newItem);
                } else if (parseDate(newItem.scanTime) > parseDate(remoteDataCache[idx].scanTime)) {
                    remoteDataCache[idx] = newItem;
                }
            });
            localStorage.setItem('nvh_remote_cache', JSON.stringify(remoteDataCache));
        }
        if (currentQuery === query.toLowerCase()) {
            displayRemoteData();
        }
    } catch (error) {
        console.error("Search error:", error);
    }
}

async function fetchDataFromSheets(isAuto = false) {
    const btn = document.querySelector('.download-btn-main');
    if (btn) btn.classList.add('refreshing');
    
    if (!isAuto) showToast("Đang xóa bộ nhớ cũ và tải mới từ Sheets...", 3000);

    try {
        // RESET DỮ LIỆU ĐƠN HÀNG (Chỉ xóa nvh_remote_cache) v1.1.7.3
        remoteDataCache = [];
        localStorage.removeItem('nvh_remote_cache');
        
        // Chuyển sang phương thức GET để tránh bị chặn bởi trình duyệt/tường lửa (v1.1.8.4)
        const fetchUrl = `${APP_SCRIPT_URL}?action=getData&t=${Date.now()}`;
        console.log("📡 Đang tải dữ liệu qua GET:", fetchUrl);
        
        const response = await fetch(fetchUrl, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) throw new Error("Kết nối bị từ chối.");
        
        let rawJson = null;
        try {
            rawJson = await response.json();
            // Ghi dữ liệu thô vào khung Debug để chẩn đoán (v1.1.8.3)
            const debugEl = document.getElementById('debug-raw-output');
            if (debugEl) debugEl.value = JSON.stringify(rawJson, null, 2);
            console.log("🔍 DEBUG - RAW DATA RECEIVED:", rawJson);
        } catch (jsonErr) {
            console.error("❌ JSON Parse Error:", jsonErr);
            const text = await response.text();
            const debugEl = document.getElementById('debug-raw-output');
            if (debugEl) debugEl.value = "LỖI PHẢN HỒI (KHÔNG PHẢI JSON):\n" + text;
            throw new Error("Dữ liệu từ Google không đúng định dạng JSON.");
        }
        
        // --- XỬ LÝ ĐA DẠNG CẤU TRÚC PHẢN HỒI (GAS) ---
        let data = [];
        if (Array.isArray(rawJson)) {
            data = rawJson;
        } else if (rawJson && rawJson.data && Array.isArray(rawJson.data)) {
            data = rawJson.data;
        } else if (rawJson && (rawJson.rows || rawJson.values)) {
            data = rawJson.rows || rawJson.values;
        }

        if (data && data.length > 0) {
            // Chuẩn hóa dữ liệu v1.1.8.6 (Cố định A=Time, B=ID, C=Code)
            data = data.map((row, rowIndex) => {
                let normalized = { userName: 'Log', content: 'N/A', scanTime: 'N/A', orderId: 'N/A', rowIndex: rowIndex + 1 };
                
                if (Array.isArray(row)) {
                    normalized.scanTime = row[0] || 'N/A';
                    normalized.orderId = (row[1] || row[2] || 'N/A').toString(); // Lấy cột B làm ID
                    normalized.content = (row[2] || row[1] || 'N/A').toString(); // Lấy cột C làm mã đơn
                    normalized.userName = row[1] || 'NoName';
                } else if (typeof row === 'object') {
                    normalized.scanTime = row.scanTime || row.A || 'N/A';
                    normalized.orderId = (row.orderId || row.B || 'N/A').toString();
                    normalized.content = (row.content || row.C || 'N/A').toString();
                    normalized.userName = row.userName || row.B || 'NoName';
                }
                return normalized;
            });

            // LẤY SẠCH 100% (Gia cố bộ lọc)
            data = data.filter(item => {
                const timeStr = (item.scanTime || "").toString().toLowerCase();
                if (timeStr === "thời gian" || timeStr === "time" || timeStr === "timestamp") return false; 
                return item.content !== 'N/A' && item.content !== '';
            });
            
            // Sắp xếp
            data.sort((a, b) => {
                try {
                    return parseDate(b.scanTime).getTime() - parseDate(a.scanTime).getTime();
                } catch(e) { return 0; }
            });
        }

        remoteDataCache = data;
        localStorage.setItem('nvh_remote_cache', JSON.stringify(data));
        const now = formatDate(new Date());
        localStorage.setItem('nvh_last_update', now);
        
        updateLastUpdateTimeDisplay(now, data.length);
        displayRemoteData();
        
        if (!isAuto) {
            hideToast(); // Ẩn thông báo "Đang tải" trước khi hiện kết quả
            if (data.length > 0) {
                showToast(`✅ Đã tải ${data.length} đơn hàng thành công!`, 5000);
                
                // Hiệu ứng nút Tải dữ liệu thành công v1.1.7
                const originalHtml = btn.innerHTML;
                btn.classList.add('success-state');
                btn.innerHTML = `✅ ĐÃ XONG (${data.length})`;
                
                setTimeout(() => {
                    btn.classList.remove('success-state');
                    btn.innerHTML = originalHtml;
                }, 3000);
            } else {
                showToast(`⚠️ Không có đơn hàng nào trong 30 ngày qua.`, 5000);
            }
        }
    } catch (error) {
        console.error("Fetch error:", error);
        if (!isAuto) {
            hideToast();
            showToast(`❌ Lỗi tải: ${error.message}. Vui lòng thử lại!`, 7000);
        }
    } finally {
        if (btn) btn.classList.remove('refreshing');
    }
}

function updateLastUpdateTimeDisplay(timeStr, count = 0) {
    const display = document.getElementById('last-update-display');
    if (display) {
        if (count > 0) {
            display.innerText = `Đã tải ${count} đơn lúc ${timeStr}`;
        } else {
            display.innerText = `Cập nhật lúc: ${timeStr}`;
        }
    }
}

function displayRemoteData(dataToDisplay = null) {
    const list = document.getElementById('remote-data-list');
    if (!list) return;

    const input = document.getElementById('remote-search-input');
    const query = input ? input.value.trim().toLowerCase() : "";
    
    // Yêu cầu v1.1.2: Nếu đang gõ mà chưa đủ 3 ký tự
    if (query.length > 0 && query.length < 3 && !dataToDisplay) {
        list.innerHTML = "<p class='empty-msg text-warning'>Vui lòng nhập ít nhất 3 ký tự để bắt đầu gợi ý.</p>";
        list.style.display = 'block';
        return;
    }

    // Nếu có dataToDisplay (như khi bấm Xem tất cả), ưu tiên dùng nó
    const data = dataToDisplay || (query.length >= 3 ? remoteDataCache.filter(item => 
        (item.content && item.content.toLowerCase().includes(query)) || 
        (item.orderId && item.orderId.toLowerCase().includes(query))
    ) : []);

    // Yêu cầu: Chưa gõ thì không hiện danh sách (trừ khi dùng dataToDisplay trực tiếp)
    if (!query && !dataToDisplay) {
        list.innerHTML = "<p class='empty-msg'>Vui lòng nhập mã để tìm kiếm.</p>";
        list.style.display = 'block';
        return;
    }

    if (data.length === 0) {
        list.innerHTML = `<p class='empty-msg'>${query ? 'Không tìm thấy dữ liệu.' : 'Chưa có dữ liệu trong máy...'}</p>`;
        return;
    }

    // Tối ưu render: Dùng DocumentFragment hoặc tạo chuỗi một lần
    // Tăng giới hạn hiển thị lên 100 để "Xem tất cả" có ý nghĩa hơn
    const limit = dataToDisplay ? 200 : 100;
    
    let htmlContent = "";
    
    // Yêu cầu v1.1.3: Hiển thị Tổng số đơn hàng trên cùng khi xem tất cả
    if (dataToDisplay) {
        htmlContent += `<div class="total-count-header">TỔNG CỘNG: ${data.length} ĐƠN HÀNG (30 NGÀY)</div>`;
    }

    const listHtml = data.slice(0, limit).map(item => `
        <div class="history-item ${selectedRemoteItem && selectedRemoteItem.content === item.content ? 'selected' : ''}" 
             onclick='selectRemoteItem(${JSON.stringify(item).replace(/'/g, "&apos;")})'>
            <div class="history-item-header">
                <strong style="color: var(--primary-color)">👤 ${item.userName}</strong>
                <span class="history-item-time">${item.scanTime}</span>
            </div>
            <div class="history-item-content" style="font-size: 1.1rem; color: #fff;">📦 ${item.content}</div>
        </div>
    `).join('');
    
    list.innerHTML = htmlContent + listHtml;
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

async function startSearchScan(target) {
    searchTarget = target;
    const modal = document.getElementById('search-scan-modal');
    if (!modal) return;

    modal.classList.add('active');
    
    try {
        if (!searchScanner) searchScanner = new Html5Qrcode("search-reader");
        
        const deviceId = localStorage.getItem('nvh_scanner_cam_id') || localStorage.getItem('nvh_camera_id');
        const config = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" };

        await searchScanner.start(
            config,
            { fps: 15, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                playBeep();
                triggerFlash();
                
                // Điền vào ô tìm kiếm tương ứng
                if (target === 'data') {
                    const input = document.getElementById('remote-search-input');
                    if (input) {
                        input.value = decodedText;
                        filterRemoteData(true);
                    }
                } else if (target === 'review') {
                    const input = document.getElementById('review-order-id');
                    if (input) {
                        input.value = decodedText;
                        filterReviewData(true);
                    }
                }
                
                stopSearchScanModal();
                showToast("✅ Đã tìm thấy: " + decodedText);
            }
        );
    } catch (err) {
        showToast("Lỗi camera: " + err);
        stopSearchScanModal();
    }
}

async function stopSearchScanModal() {
    const modal = document.getElementById('search-scan-modal');
    if (modal) modal.classList.remove('active');
    
    if (searchScanner) {
        try {
            await searchScanner.stop();
        } catch (e) { console.warn("Stop search scanner error:", e); }
    }
}

function clearLocalHistory() {
    if (confirm("Xóa toàn bộ lịch sử?")) {
        localStorage.removeItem('nvh_scan_queue');
        loadLocalHistory();
    }
}

let toastTimeout = null;
function showToast(msg, duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.innerText = msg;
    toast.classList.add('show');
    toast.style.transform = "translateX(-50%) translateY(0)";
    
    // Clear timeout cũ nếu có
    if (toastTimeout) clearTimeout(toastTimeout);

    // Nếu duration là -1 thì không tự động đóng
    if (duration !== -1) {
        toastTimeout = setTimeout(() => {
            hideToast();
        }, duration);
    }
}

function hideToast() {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.style.transform = "translateX(-50%) translateY(100px)";
    setTimeout(() => {
        toast.classList.remove('show');
    }, 400);
}

// --- HỆ THỐNG KÍCH HOẠT DIAMOND v2.0.0 ---
async function checkActivation() {
    console.log("💎 Đang kiểm tra bản quyền Diamond v2.0.0...");
    const isActivated = await getAuthToken(); // Tái sử dụng IndexedDB lưu activation
    const overlay = document.getElementById('activation-overlay');
    
    if (isActivated === '310824_KEY_ACTIVATED') {
        if (overlay) overlay.style.display = 'none';
        document.body.classList.add('app-activated');
        return true;
    } else {
        if (overlay) overlay.style.display = 'flex';
        document.body.classList.remove('app-activated');
        return false;
    }
}

async function activateApp() {
    const input = document.getElementById('activation-key');
    const error = document.getElementById('activation-error');
    const key = input.value.trim();
    
    if (key === '310824') {
        await setAuthToken('310824_KEY_ACTIVATED');
        showToast("✨ KÍCH HOẠT DIAMOND EDITION THÀNH CÔNG!");
        setTimeout(() => location.reload(), 1000);
    } else {
        if (error) error.style.display = 'block';
        input.value = '';
        input.focus();
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
        'security': 'CÀI ĐẶT BẢO MẬT',
        'changelog': 'NHẬT KÝ THAY ĐỔI'
    };
    title.innerText = titles[group] || 'CÀI ĐẶT';
    body.innerHTML = template.innerHTML;
    
    if (group === 'scan') {
        const soundSelect = document.getElementById('sound-select-modal');
        const vibrateToggle = document.getElementById('vibrate-toggle-modal');
        if (soundSelect) soundSelect.value = localStorage.getItem('nvh_sound_type') || 'standard';
        if (vibrateToggle) vibrateToggle.checked = localStorage.getItem('nvh_vibrate') !== 'false';
        
        // Cập nhật Toggle bảo mật v1.8.8
        const authToggle = document.getElementById('auth-toggle-modal');
        if (authToggle) authToggle.checked = localStorage.getItem('nvh_auth_skip') !== 'true';
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
        // Load go2rtc settings
        const ipToggle = document.getElementById('use-ip-camera-modal');
        const ipServer = document.getElementById('go2rtc-server-modal');
        const ipSource = document.getElementById('go2rtc-source-modal');
        if (ipToggle) ipToggle.checked = useIPCamera;
        if (ipServer) ipServer.value = go2rtcServer;
        if (ipSource) ipSource.value = go2rtcSource;
    }
    
    // Load User Name v1.1.8.0
    const userNameInput = document.getElementById('user-name-modal');
    if (userNameInput) userNameInput.value = localStorage.getItem('nvh_user_name') || '';
    
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

    const useIP = document.getElementById('use-ip-camera-modal')?.checked;
    const gServer = document.getElementById('go2rtc-server-modal')?.value;
    const gSource = document.getElementById('go2rtc-source-modal')?.value;

    if (sound !== undefined) localStorage.setItem('nvh_sound_type', sound);
    if (vibrate !== undefined) localStorage.setItem('nvh_vibrate', vibrate);
    if (driveId !== undefined) localStorage.setItem('nvh_drive_folder_id', driveId);
    
    if (scannerCam) localStorage.setItem('nvh_scanner_cam_id', scannerCam);
    if (m1Cam) localStorage.setItem('nvh_monitor1_cam_id', m1Cam);
    if (m2Cam) localStorage.setItem('nvh_monitor2_cam_id', m2Cam);
    
    // Lưu go2rtc config
    if (useIP !== undefined) { useIPCamera = useIP; localStorage.setItem('nvh_use_ip_camera', useIP); }
    if (gServer) { go2rtcServer = gServer; localStorage.setItem('nvh_go2rtc_server', gServer); }
    if (gSource) { go2rtcSource = gSource; localStorage.setItem('nvh_go2rtc_source', gSource); }

    // Lưu cài đặt bảo mật v1.8.8 (Đảo ngược auth_skip vì UI là auth_required)
    const authReq = document.getElementById('auth-toggle-modal')?.checked;
    if (authReq !== undefined) localStorage.setItem('nvh_auth_skip', !authReq);
    
    // Lưu Tên người dùng v1.1.8.0
    const uName = document.getElementById('user-name-modal')?.value;
    if (uName !== undefined) localStorage.setItem('nvh_user_name', uName.trim());
    
    // Đồng bộ ngược lại cho cũ
    if (scannerCam) localStorage.setItem('nvh_camera_id', scannerCam);

    if (isScanning) {
        stopScanner().then(() => { 
            if (useIPCamera) startIPCameraScanner();
            else if (!pcMode) toggleScanner(); 
            else startScanning(); 
        });
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
    console.log("🚀 TCT APP V1.1.8.7 - SUPER STABLE EDITION IS LIVE!");
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
    
    const lastUpdate = localStorage.getItem('nvh_last_update');
    updateLastUpdateTimeDisplay(lastUpdate);

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

function togglePCMode(forceState = null) {
    pcMode = forceState !== null ? forceState : !pcMode;
    localStorage.setItem('nvh_pc_mode', pcMode);
    
    const body = document.body;
    const reader = document.getElementById('reader');
    const pcReaderContainer = document.getElementById('pc-reader-container');
    const mobileReaderContainer = document.querySelector('#mobile-scan-ui .scanner-container');

    if (pcMode) {
        body.classList.add('pc-mode');
        // Di chuyển reader vào cột trái PC
        if (reader && pcReaderContainer) pcReaderContainer.appendChild(reader);
        showToast("🖥️ Đã kích hoạt Giao diện PC Pro");
        startDualMonitoring(); 
    } else {
        body.classList.remove('pc-mode');
        // Trả reader về giao diện mobile
        if (reader && mobileReaderContainer) mobileReaderContainer.appendChild(reader);
        showToast("📱 Đã chuyển sang giao diện Mobile");
        stopScanner();
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
let reviewSearchTimeout;
function filterReviewData(immediate = false) {
    const input = document.getElementById('review-order-id');
    if (!input) return;
    const query = input.value.toLowerCase().trim();
    const list = document.getElementById('review-data-list');
    
    if (!query) {
        list.style.display = 'none';
        return;
    }

    if (query.length < 3 && !immediate) {
        list.style.display = 'block';
        list.innerHTML = "<p class='empty-msg text-warning'>Nhập ít nhất 3 ký tự...</p>";
        return;
    }

    // hiển thị list để gợi ý
    list.style.display = 'block';

    // 1. Lọc từ bộ nhớ đệm trước - HIỂN THỊ NGAY
    const filtered = remoteDataCache.filter(item => 
        (item.content && item.content.toLowerCase().includes(query)) || 
        (item.orderId && item.orderId.toLowerCase().includes(query))
    );

    if (filtered.length > 0) {
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
        list.innerHTML = "<p class='empty-msg'>Đang gõ để tìm...</p>";
    }

    // 2. Tìm kiếm trên Cloud (Sheets) - De-bounced
    clearTimeout(reviewSearchTimeout);
    if (query.length >= 3 || immediate) {
        reviewSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(APP_SCRIPT_URL, {
                    method: "POST",
                    body: JSON.stringify({ action: "SEARCH", query: query }),
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' }
                });
                const data = await response.json();
                
                // Cập nhật bộ nhớ đệm
                if (data && data.length > 0) {
                    data.forEach(newItem => {
                        const idx = remoteDataCache.findIndex(old => old.content === newItem.content);
                        if (idx === -1) {
                            remoteDataCache.unshift(newItem);
                        } else if (parseDate(newItem.scanTime) > parseDate(remoteDataCache[idx].scanTime)) {
                            remoteDataCache[idx] = newItem;
                        }
                    });
                    localStorage.setItem('nvh_remote_cache', JSON.stringify(remoteDataCache));
                }
                
                const currentQuery = document.getElementById('review-order-id').value.trim().toLowerCase();
                if (currentQuery === query) {
                    filterReviewData(false); // Gọi lại để update UI từ cache vừa cập nhật
                }
            } catch (e) { console.error("Cloud search error:", e); }
        }, immediate ? 0 : 1500);
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
        let devices = await Html5Qrcode.getCameras();
        
        // Tối ưu hóa: Nếu thư viện không trả về Label, thử dùng API gốc của trình duyệt
        if (devices.some(d => !d.label || d.label.includes('Camera'))) {
            const navDevices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = navDevices.filter(d => d.kind === 'videoinput');
            if (videoDevices.length > 0) {
                devices = videoDevices.map(d => ({ id: d.deviceId, label: d.label }));
            }
        }

        if (devices && devices.length > 0) {
            const options = devices.map(d => `<option value="${d.id}">${d.label || 'Camera ' + d.id.substr(0,4)}</option>`).join('');
            sScanner.innerHTML = options;
            sM1.innerHTML = options;
            sM2.innerHTML = '<option value="">-- Không dùng --</option>' + options;
            
            sScanner.value = localStorage.getItem('nvh_scanner_cam_id') || localStorage.getItem('nvh_camera_id') || devices[0].id;
            sM1.value = localStorage.getItem('nvh_monitor1_cam_id') || devices[0].id;
            sM2.value = localStorage.getItem('nvh_monitor2_cam_id') || "";

            // Đồng bộ giữa giao diện chính và Modal nếu cần
            if (isModal) {
                const mainScanner = document.getElementById('scanner-cam-select');
                if (mainScanner) {
                    mainScanner.innerHTML = options;
                    mainScanner.value = sScanner.value;
                }
            }
        } else {
            const noCam = '<option value="">❌ Không tìm thấy thiết bị</option>';
            sScanner.innerHTML = noCam; sM1.innerHTML = noCam; sM2.innerHTML = noCam;
        }
    } catch (err) { 
        console.error("Camera detection error:", err); 
    }
}

async function startDualMonitoring() {
    // Tìm Camera ID: Ưu tiên modal dropdown -> localStorage
    const s1Modal = document.getElementById('monitor1-cam-select-modal');
    const s2Modal = document.getElementById('monitor2-cam-select-modal');
    
    const cam1Id = (s1Modal && s1Modal.value) ? s1Modal.value : localStorage.getItem('nvh_monitor1_cam_id');
    const cam2Id = (s2Modal && s2Modal.value) ? s2Modal.value : localStorage.getItem('nvh_monitor2_cam_id');
    
    const v1 = document.getElementById('pc-video-1');
    const v2 = document.getElementById('pc-video-2');

    if (!cam1Id) return;

    try {
        // Stream 1 (Góc Cận)
        const s1 = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cam1Id } });
        if (v1) v1.srcObject = s1;
        recorderStreams[0] = s1;
        const m1 = document.getElementById('monitor-cam-1');
        if (m1) m1.style.display = 'none';

        // Stream 2 (Góc Toàn) nếu chọn
        if (cam2Id) {
            const s2 = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cam2Id } });
            if (v2) v2.srcObject = s2;
            recorderStreams[1] = s2;
            const m2 = document.getElementById('monitor-cam-2');
            if (m2) m2.style.display = 'none';
        }
    } catch (err) {
        showToast("❌ Lỗi khởi động giám sát: " + err);
    }
}

async function stopScanner() {
    if (!html5QrCode) return;
    try {
        if (isScanning) await html5QrCode.stop();
        isScanning = false;
        
        const activeBtnId = pcMode ? 'pc-scan-btn' : 'start-btn';
        const btn = document.getElementById(activeBtnId) || document.getElementById('start-btn');
        const mainText = btn?.querySelector('.btn-main-text');
        
        if (btn) btn.classList.remove('scanning', 'active');
        if (mainText) mainText.innerText = "BẮT ĐẦU QUÉT";
        
        // Stop monitoring streams
        recorderStreams.forEach(s => {
            if (s) s.getTracks().forEach(t => t.stop());
        });
        recorderStreams = [];
        
        const m1 = document.getElementById('monitor-cam-1');
        const m2 = document.getElementById('monitor-cam-2');
        if (m1) m1.style.display = 'flex';
        if (m2) m2.style.display = 'flex';
        
        const v1 = document.getElementById('pc-video-1');
        const v2 = document.getElementById('pc-video-2');
        if (v1) v1.srcObject = null;
        if (v2) v2.srcObject = null;
    } catch (err) { 
        console.warn("Stop error:", err); 
        isScanning = false;
    }
}

// --- LOGIC PC PRO MODE v1.9.5 ---
function togglePCMode(forceState = null) {
    pcMode = forceState !== null ? forceState : !pcMode;
    localStorage.setItem('nvh_pc_mode', pcMode);
    
    const body = document.body;
    const reader = document.getElementById('reader');
    const pcReaderContainer = document.getElementById('pc-reader-container');
    const mobileReaderContainer = document.querySelector('#mobile-scan-ui .scanner-container');

    if (pcMode) {
        body.classList.add('pc-mode');
        // Di chuyển reader vào cột trái PC
        if (reader && pcReaderContainer) pcReaderContainer.appendChild(reader);
        showToast("🖥️ Đã kích hoạt Giao diện PC Pro");
        startDualMonitoring(); // Tự động bật camera giám sát nếu ở PC
    } else {
        body.classList.remove('pc-mode');
        // Trả reader về giao diện mobile
        if (reader && mobileReaderContainer) mobileReaderContainer.appendChild(reader);
        showToast("📱 Đã chuyển sang giao diện Mobile");
        stopScanner();
    }
}

function togglePCModeFromModal(checked) {
    togglePCMode(checked);
}

// --- LOGIC RECORDING v1.9.5 BỔ SUNG ---
function startManualRec() {
    if (!isScanning) {
        showToast("⚠️ Vui lòng BẬT QUÉT trước khi ghi hình!");
        return;
    }
    const orderId = lastScannedId || "HAND_REC_" + new Date().getTime();
    startDualRecording(orderId);
    document.querySelector('.pc-right-col').classList.add('rec-active-mode');
}

function stopManualRec() {
    stopDualRecording();
    document.querySelector('.pc-right-col').classList.remove('rec-active-mode');
}

// --- LOGIC BẢO MẬT & KÍCH HOẠT v2.0.x --- (Giữ nguyên)

// --- LOGIC BẢNG LỊCH SỬ QUÉT NHANH v2.1.0 ---
let pcRecentScans = [];

function updatePCRecentList(code, status = 'success') {
    const listEl = document.getElementById('pc-recent-list');
    const countEl = document.getElementById('pc-recent-count');
    if (!listEl) return;

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    // Thêm vào đầu danh sách
    pcRecentScans.unshift({ code, time: timeStr, status });

    // Giữ lại tối đa 20 mã
    if (pcRecentScans.length > 20) pcRecentScans.pop();

    renderPCRecentList();
}

function renderPCRecentList() {
    const listEl = document.getElementById('pc-recent-list');
    const countEl = document.getElementById('pc-recent-count');
    if (!listEl) return;

    if (pcRecentScans.length === 0) {
        listEl.innerHTML = '<div class="recent-empty">Chưa có mã đơn nào...</div>';
        if (countEl) countEl.innerText = '0';
        return;
    }

    if (countEl) countEl.innerText = pcRecentScans.length;

    listEl.innerHTML = pcRecentScans.map(item => `
        <div class="recent-scan-item">
            <div class="recent-scan-info">
                <span class="recent-code">${item.code}</span>
                <span class="recent-time">🕒 ${item.time}</span>
            </div>
            <span class="recent-status" style="${item.status !== 'success' ? 'color: #ff4477; background: rgba(255, 68, 119, 0.1);' : ''}">
                ${item.status === 'success' ? 'Đã thêm' : 'Lỗi'}
            </span>
        </div>
    `).join('');
}

function clearPCRecentList() {
    pcRecentScans = [];
    renderPCRecentList();
}
function initPCResizer() {
    const resizer = document.getElementById('pc-resizer-bar');
    const leftSide = document.getElementById('monitor-1');
    const rightSide = document.getElementById('monitor-2');
    
    if (!resizer || !leftSide || !rightSide) return;

    let x = 0;
    let leftWidth = 0;

    // Khôi phục tỷ lệ đã lưu
    const savedPos = localStorage.getItem('nvh_pc_resizer_pos');
    if (savedPos) {
        leftSide.style.flex = `0 0 ${savedPos}%`;
    }

    const onMouseDown = (e) => {
        x = e.clientX || e.touches[0].clientX;
        const rect = leftSide.getBoundingClientRect();
        leftWidth = rect.width;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchmove', onMouseMove);
        document.addEventListener('touchend', onMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    const onMouseMove = (e) => {
        const currentX = e.clientX || e.touches[0].clientX;
        const dx = currentX - x;
        const containerWidth = resizer.parentElement.clientWidth;
        const newWidthPerc = ((leftWidth + dx) / containerWidth) * 100;
        
        if (newWidthPerc > 10 && newWidthPerc < 90) {
            leftSide.style.flex = `0 0 ${newWidthPerc}%`;
            localStorage.setItem('nvh_pc_resizer_pos', newWidthPerc);
        }
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('touchend', onMouseUp);
        document.body.style.cursor = 'default';
    };

    resizer.addEventListener('mousedown', onMouseDown);
    resizer.addEventListener('touchstart', onMouseDown);
}

// --- LOGIC RECORDING v1.6.4 ---
async function initHDD() {
    try {
        hddFolderHandle = await window.showDirectoryPicker();
        showToast("📂 Đã cấp quyền truy cập thư mục lưu trữ!");
        const hStatus = document.getElementById('hdd-status-modal');
        if (hStatus) {
            hStatus.innerText = "Đã cấp quyền thư mục Local";
            hStatus.style.color = "var(--success)";
        }
    } catch (err) {
        showToast("❌ Lỗicấp quyền: " + err);
    }
}

async function startDualRecording(orderId) {
    if (recordingActive || !recorderStreams.length) return;

    try {
        mediaRecorders = [];
        recStartTime = Date.now();
        
        recorderStreams.forEach((stream, index) => {
            if (stream) {
                const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
                const chunks = [];
                recorder.ondataavailable = (e) => chunks.push(e.data);
                recorder.onstop = async () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    const fileName = `${orderId}_CAM${index + 1}.webm`;
                    
                    if (hddFolderHandle) {
                        try {
                            const fileHandle = await hddFolderHandle.getFileHandle(fileName, { create: true });
                            const writable = await fileHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                        } catch (e) { console.error("HDD Save error:", e); }
                    }
                    saveVideoToIDB(fileName, blob);
                };
                
                recorder.start();
                mediaRecorders.push(recorder);
            }
        });

        recordingActive = true;
        recTimerInterval = setInterval(updateRecTimer, 1000); // Khởi động timer v1.9.5
    } catch (err) { console.error("Start Recording error:", err); }
}

function stopDualRecording() {
    if (!recordingActive) return;
    mediaRecorders.forEach(r => r.stop());
    recordingActive = false;
    clearInterval(recTimerInterval);
    document.getElementById('pc-status-msg').innerText = "Sẵn sàng";
    document.getElementById('pc-status-msg').style.color = "var(--primary-color)";
    showToast("💾 Đã lưu video ghi hình!");
}

function updateRecTimer() {
    const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');
    document.getElementById('pc-status-msg').innerText = `🔴 GHI HÌNH [${mins}:${secs}]: ${lastScannedId}`;
}

async function saveVideoToIDB(name, blob) {
    if (!db) return;
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").put(blob, name);
}

function updatePCDisplay(id) {
    lastScannedId = id;
    const targets = ['pc-last-scanned', 'pc-pro-last-scanned'];
    targets.forEach(tid => {
        const el = document.getElementById(tid);
        if (el) el.innerText = id;
    });
}

async function getVideoFromIDB(name) {
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction("videos", "readonly");
        const request = tx.objectStore("videos").get(name);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = () => resolve(null);
    });
}

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}


// --- HỆ THỐNG ĐIỀU KHIỂN CAMERA IP (go2rtc & jsQR) v2.2.0 ---
async function startIPCameraScanner() {
    isScanning = true;
    const btn = pcMode ? document.getElementById('pc-scan-btn') : document.getElementById('start-btn');
    if (btn) {
        btn.classList.add('scanning', 'active');
        btn.querySelector('.btn-main-text').innerText = "DỪNG QUÉT (IP)";
    }

    try {
        const video1 = document.getElementById('pc-video-1');
        const reader = document.getElementById('reader');
        
        // Luôn hiển thị video Monitor 1 để quét
        if (video1) {
            video1.style.display = 'block';
            document.getElementById('monitor-cam-1').style.display = 'none';
            await connectGo2RTC(go2rtcSource, video1);
            
            // Bắt đầu vòng lặp quét bằng jsQR
            ipCameraScanLoop(video1);
            showToast("Đã kết nối Camera IP: " + go2rtcSource);
        }
    } catch (err) {
        showToast("Lỗi kết nối Camera IP: " + err);
        stopScanner();
    }
}

async function connectGo2RTC(src, videoEl) {
    if (pcGo2rtc) {
        pcGo2rtc.close();
        pcGo2rtc = null;
    }

    pcGo2rtc = new RTCPeerConnection();
    
    pcGo2rtc.ontrack = (event) => {
        if (videoEl.srcObject !== event.streams[0]) {
            videoEl.srcObject = event.streams[0];
        }
    };

    pcGo2rtc.addTransceiver('video', { direction: 'sendrecv' });

    const offer = await pcGo2rtc.createOffer();
    await pcGo2rtc.setLocalDescription(offer);

    const response = await fetch(`${go2rtcServer}/api/webrtc?src=${src}`, {
        method: 'POST',
        body: offer.sdp
    });

    if (!response.ok) throw new Error("Server go2rtc không phản hồi!");
    const answer = await response.text();
    await pcGo2rtc.setRemoteDescription({ type: 'answer', sdp: answer });
}

let ipScanInterval = null;
function ipCameraScanLoop(video) {
    if (ipScanInterval) clearInterval(ipScanInterval);
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ipScanInterval = setInterval(() => {
        if (!isScanning || video.paused || video.ended) return;
        
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        if (canvas.width === 0) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
            handleTrackingScan(code.data, canvas);
        } else {
            checkSessionTimeout();
        }
    }, 250); 
}

function handleTrackingScan(code, canvas) {
    const now = Date.now();
    
    // Nếu là mã mới hoàn toàn
    if (!activeSession || activeSession.code !== code) {
        // Nếu đang có session cũ, chốt nó trước khi đổi sang mã mới
        if (activeSession) finalizeSession();
        
        // Bắt đầu session mới
        activeSession = {
            code: code,
            startTime: formatDate(new Date()),
            lastSeen: now,
            snapshot: canvas.toDataURL('image/jpeg', 0.5),
            id: now
        };
        
        playBeep();
        processValidScan(code, 'START', true, activeSession);
        showToast("📦 Phát hiện đơn: " + code);
    } else {
        // Cập nhật thời điểm thấy cuối cùng
        activeSession.lastSeen = now;
        if (sessionTimeout) {
            clearTimeout(sessionTimeout);
            sessionTimeout = null;
        }
    }
}

function checkSessionTimeout() {
    if (activeSession && !sessionTimeout) {
        sessionTimeout = setTimeout(() => {
            finalizeSession();
        }, 3000); // 3 giây không thấy mã thì coi như xong
    }
}

function finalizeSession() {
    if (!activeSession) return;
    
    activeSession.endTime = formatDate(new Date());
    processValidScan(activeSession.code, 'UPDATE_END', true, activeSession);
    showToast("✅ Hoàn tất: " + activeSession.code);
    
    activeSession = null;
    if (sessionTimeout) {
        clearTimeout(sessionTimeout);
        sessionTimeout = null;
    }
    // Dừng luôn cả interval kiểm tra nếu không còn session
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }
}

function stopIPCameraScanner() {
    if (ipScanInterval) {
        clearInterval(ipScanInterval);
        ipScanInterval = null;
    }
    if (pcGo2rtc) {
        pcGo2rtc.close();
        pcGo2rtc = null;
    }
}

async function testGo2RTCConnection() {
    const server = document.getElementById('go2rtc-server-modal')?.value || go2rtcServer;
    const source = document.getElementById('go2rtc-source-modal')?.value || go2rtcSource;
    
    showToast("Đang kiểm tra: " + server);
    try {
        const res = await fetch(`${server}/api/streams`, { method: 'GET' });
        if (res.ok) {
            const data = await res.json();
            if (data[source]) {
                showToast("✅ Kết nối tốt! Đã thấy luồng: " + source);
            } else {
                showToast("⚠️ Server OK nhưng không thấy luồng: " + source);
            }
        } else {
            showToast("❌ Lỗi: Server phản hồi mã " + res.status);
        }
    } catch (e) {
        showToast("❌ Lỗi kết nối: Chắc chắn go2rtc đang chạy!");
    }
}
