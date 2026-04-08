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
let currentPendingScan = null; // Lưu trữ mã đang chờ xử lý trùng lặp

// Khởi tạo Audio Context
let audioCtx;
function playBeep() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) { console.warn("Audio Context error:", e); }
}

function triggerFlash() {
    const flash = document.getElementById('flash-overlay');
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 500);
}

// Chuyển đổi Tab
function switchTab(tab) {
    const views = ['scan-view', 'history-view', 'data-view'];
    const btns = ['btn-tab-scan', 'btn-tab-history', 'btn-tab-data'];
    
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

    if (tab !== 'scan' && isScanning) stopScanner();
    if (tab === 'history') loadLocalHistory();
    if (tab === 'data') displayRemoteData();
}

// Bật/Tắt Camera
async function toggleScanner() {
    const btn = document.getElementById('start-btn');
    if (!isScanning) {
        try {
            if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
            playBeep();
            await html5QrCode.start(
                { facingMode: "environment" },
                { 
                    fps: 25, 
                    qrbox: (w, h) => { const size = Math.min(w, h) * 0.85; return { width: size, height: size }; },
                    aspectRatio: 1.0
                },
                onScanSuccess
            );
            isScanning = true;
            btn.classList.add('scanning');
            document.getElementById('btn-text').innerText = "DỪNG QUÉT";
            document.getElementById('btn-subtext').innerText = "Vui lòng đưa mã vào khung hình";
        } catch (err) { showToast("Lỗi camera: " + err); }
    } else { await stopScanner(); }
}

async function stopScanner() {
    if (html5QrCode && isScanning) {
        await html5QrCode.stop();
        isScanning = false;
        const btn = document.getElementById('start-btn');
        btn.classList.remove('scanning');
        document.getElementById('btn-text').innerText = "BẮT ĐẦU QUÉT";
        document.getElementById('btn-subtext').innerText = "Nhấn để khởi động Camera";
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
            filterRemoteData(true); // Tìm kiếm hệ thống ngay lập tức
        }
        stopScanner();
        showToast("Đã tìm thấy mã: " + decodedText);
        return;
    }

    // Kiểm tra trùng lặp trên hệ thống
    const isDuplicate = remoteDataCache.some(item => item.content === decodedText);
    if (isDuplicate) {
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
    document.getElementById('sync-status').innerText = (action === 'UPDATE' ? "Đang ghi đè..." : "Đang chờ đồng bộ...");
    document.getElementById('sync-status').style.color = "var(--primary-color)";

    const scanMode = document.querySelector('input[name="scanMode"]:checked').value;
    const orderData = {
        id: Date.now(),
        orderId: "NVH-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
        content: decodedText,
        scanTime: new Date().toLocaleString('vi-VN'),
        synced: false,
        action: action // NEW: Phân biệt Ghi thêm hay Ghi đè
    };

    saveToQueue(orderData);
    isProcessing = false;
    processSyncQueue();

    if (scanMode === 'single') setTimeout(() => stopScanner(), 500);
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

window.onload = () => {
    loadLocalHistory();
    const cache = localStorage.getItem('nvh_remote_cache');
    if (cache) { remoteDataCache = JSON.parse(cache); displayRemoteData(); }
    fetchDataFromSheets(true);
    setTimeout(processSyncQueue, 2000);
};
