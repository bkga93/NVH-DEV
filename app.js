// Cấu hình URL Google Apps Script chính thức từ bạn
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzw4v799F8zAANRMCfTDXG3O0HbDHoP9PvnDkjgZQGzaqpDlRnakOWpJocYROR8AzqqNg/exec";

let html5QrCode;
let isScanning = false;
let isSearchScanning = false;
let searchTarget = 'history'; // 'history' hoặc 'data'
let lastScanTime = 0;
let isProcessing = false;
const SCAN_DELAY = 1500; // Giảm độ trễ xuống một chút để quét nhanh hơn

// Bộ nhớ Cache cho dữ liệu từ Sheets
let remoteDataCache = [];

// Khởi tạo Audio Context cho tiếng "Tít" siêu thị
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
    } catch (e) {
        console.warn("Audio Context error:", e);
    }
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
        document.getElementById(v).style.display = 'none';
        document.getElementById(v).classList.remove('active');
    });
    btns.forEach(b => document.getElementById(b).classList.remove('active'));

    const activeView = tab + '-view';
    const activeBtn = 'btn-tab-' + tab;
    
    document.getElementById(activeView).style.display = 'flex';
    document.getElementById(activeView).classList.add('active');
    document.getElementById(activeBtn).classList.add('active');

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
                    qrbox: (w, h) => { 
                        // Tăng diện tích quét lên 85% chiều rộng
                        const size = Math.min(w, h) * 0.85;
                        return { width: size, height: size }; 
                    },
                    aspectRatio: 1.0
                },
                onScanSuccess
            );

            isScanning = true;
            isSearchScanning = false;
            btn.classList.add('scanning');
            document.getElementById('btn-text').innerText = "DỪNG QUÉT";
            document.getElementById('btn-subtext').innerText = "Vui lòng đưa mã vào khung hình";
        } catch (err) {
            showToast("Lỗi camera: " + err);
        }
    } else {
        await stopScanner();
    }
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

    // Phản hồi tức thì (Rất quan trọng cho cảm giác nhanh)
    playBeep();
    triggerFlash();

    // Chế độ Tìm kiếm
    if (isSearchScanning) {
        if (searchTarget === 'history') {
            document.getElementById('search-input').value = decodedText;
            filterHistory();
        } else {
            document.getElementById('remote-search-input').value = decodedText;
            filterRemoteData();
        }
        stopScanner();
        showToast("Đã tìm thấy mã: " + decodedText);
        return;
    }

    // Chế độ Quét nạp dữ liệu
    lastScanTime = now;
    isProcessing = true;
    
    // Cập nhật giao diện ngay lập tức
    document.getElementById('scanned-result').innerText = decodedText;
    document.getElementById('sync-status').innerText = "Đã lưu máy - Đang chờ đồng bộ...";
    document.getElementById('sync-status').style.color = "var(--primary-color)";

    const scanMode = document.querySelector('input[name="scanMode"]:checked').value;
    const orderData = {
        id: Date.now(), // ID duy nhất để quản lý hàng đợi
        orderId: "NVH-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
        content: decodedText,
        scanTime: new Date().toLocaleString('vi-VN'),
        synced: false
    };

    // 1. Lưu vào máy ngay lập tức
    saveToQueue(orderData);
    
    // 2. Cho phép quét tiếp luôn (không đợi fetch)
    isProcessing = false;
    
    // 3. Kích hoạt tiến trình đồng bộ ngầm
    processSyncQueue();

    if (scanMode === 'single') {
        setTimeout(() => stopScanner(), 500);
    }
}

// --- LOGIC HÀNG ĐỢI ĐỒNG BỘ (ASYNCHRONOUS SYNC) ---

function saveToQueue(data) {
    let queue = JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    queue.unshift(data);
    localStorage.setItem('nvh_scan_queue', JSON.stringify(queue.slice(0, 500)));
    loadLocalHistory(); // Cập nhật tab lịch sử để thấy trạng thái
}

let isSyncing = false;
async function processSyncQueue() {
    if (isSyncing) return;
    
    let queue = JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    const unsyncedItems = queue.filter(item => !item.synced);
    
    if (unsyncedItems.length === 0) return;

    isSyncing = true;
    
    // Lấy item cũ nhất chưa sync để đẩy lên (FIFO trong số các item chưa sync)
    const itemToSync = unsyncedItems[unsyncedItems.length - 1];
    
    const success = await sendToGoogleSheets(itemToSync);
    
    if (success) {
        // Cập nhật trạng thái trong localStorage
        queue = queue.map(item => {
            if (item.id === itemToSync.id) return { ...item, synced: true };
            return item;
        });
        localStorage.setItem('nvh_scan_queue', JSON.stringify(queue));
        
        // Cập nhật UI nếu vẫn đang ở màn hình quét
        if (document.getElementById('scanned-result').innerText === itemToSync.content) {
            document.getElementById('sync-status').innerText = "Đã đồng bộ thành công!";
            document.getElementById('sync-status').style.color = "var(--success)";
        }
        
        loadLocalHistory();
        
        // Nghỉ một chút rồi sync tiếp item khác nế có
        isSyncing = false;
        setTimeout(processSyncQueue, 1000);
    } else {
        isSyncing = false;
        // Thử lại sau 5 giây nếu lỗi
        setTimeout(processSyncQueue, 5000);
    }
}

async function sendToGoogleSheets(data) {
    try {
        const response = await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        return true;
    } catch (error) {
        console.error("Sync Error:", error);
        return false;
    }
}

// --- LOGIC DỮ LIỆU TỪ SHEETS (REMOTE DATA) ---

async function fetchDataFromSheets(isAuto = false) {
    const btn = document.querySelector('.refresh-btn');
    if (btn) btn.classList.add('refreshing');
    
    try {
        // Sử dụng POST với action GET_ALL để lấy dữ liệu (vượt CORS tốt hơn)
        const response = await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ action: "GET_ALL" }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        
        const data = await response.json();
        remoteDataCache = data;
        
        // Lưu cache vào máy để dùng khi offline
        localStorage.setItem('nvh_remote_cache', JSON.stringify(data));
        localStorage.setItem('nvh_last_update', new Date().toLocaleString('vi-VN'));
        
        displayRemoteData();
        if (!isAuto) showToast("Đã cập nhật dữ liệu mới nhất!");
    } catch (error) {
        console.error("Fetch Error:", error);
        if (!isAuto) showToast("Lỗi cập nhật dữ liệu!");
        // Nếu lỗi, thử dùng cache cũ
        const cache = localStorage.getItem('nvh_remote_cache');
        if (cache) {
            remoteDataCache = JSON.parse(cache);
            displayRemoteData();
        }
    } finally {
        if (btn) btn.classList.remove('refreshing');
    }
}

function displayRemoteData(filteredData = null) {
    const list = document.getElementById('remote-data-list');
    const data = filteredData || remoteDataCache;
    const lastUpdate = localStorage.getItem('nvh_last_update') || "Chưa rõ";
    
    document.getElementById('last-update-time').innerText = "Cập nhật lúc: " + lastUpdate;

    if (!data || data.length === 0) {
        list.innerHTML = "<p class='empty-msg'>Không có dữ liệu trên hệ thống.</p>";
        return;
    }

    list.innerHTML = data.map(item => `
        <div class="history-item">
            <div class="history-item-header">
                <strong>ID: ${item.orderId || 'N/A'}</strong>
                <span class="history-item-time">${item.scanTime}</span>
            </div>
            <div class="history-item-content">${item.content}</div>
        </div>
    `).join('');
}

function filterRemoteData() {
    const query = document.getElementById('remote-search-input').value.toLowerCase();
    const filtered = remoteDataCache.filter(item => 
        (item.content && item.content.toLowerCase().includes(query)) || 
        (item.orderId && item.orderId.toLowerCase().includes(query))
    );
    displayRemoteData(filtered);
}

// --- LOGIC LỊCH SỬ TẠI MÁY ---

function loadLocalHistory(filteredData = null) {
    const list = document.getElementById('history-list');
    const history = filteredData || JSON.parse(localStorage.getItem('nvh_scan_queue') || '[]');
    
    if (history.length === 0) {
        list.innerHTML = "<p class='empty-msg'>Chưa có dữ liệu nào trong máy.</p>";
        return;
    }

    list.innerHTML = history.map(item => `
        <div class="history-item">
            <span class="sync-badge ${item.synced ? 'badge-synced' : 'badge-pending'}">
                ${item.synced ? 'Đã gửi' : 'Chờ gửi'}
            </span>
            <div class="history-item-header">
                <strong>ID: ${item.orderId}</strong>
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
        item.content.toLowerCase().includes(query) || 
        item.orderId.toLowerCase().includes(query)
    );
    loadLocalHistory(filtered);
}

// Bật quét để tìm kiếm
function startSearchScan(target) {
    searchTarget = target;
    switchTab('scan');
    isSearchScanning = true;
    showToast(`Vui lòng quét mã để tìm trong ${target === 'history' ? 'máy' : 'Sheets'}...`);
    if (!isScanning) toggleScanner();
}

function clearLocalHistory() {
    if (confirm("Xóa toàn bộ lịch sử trên máy này?")) {
        localStorage.removeItem('nvh_scan_queue');
        loadLocalHistory();
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.add('show');
    toast.style.transform = "translateX(-50%) translateY(0)"; // Force show
    setTimeout(() => {
        toast.style.transform = "translateX(-50%) translateY(100px)";
        setTimeout(() => toast.classList.remove('show'), 400);
    }, 3000);
}

// Tự động khởi động
window.onload = () => {
    // 1. Tải lịch sử máy
    loadLocalHistory();
    
    // 2. Thử khôi phục dữ liệu Sheets từ cache trước để hiện luôn
    const cache = localStorage.getItem('nvh_remote_cache');
    if (cache) {
        remoteDataCache = JSON.parse(cache);
        displayRemoteData();
    }
    
    // 3. Tự động cập nhật từ Sheets
    fetchDataFromSheets(true);
    
    // 4. Kiểm tra xem còn hàng đợi chưa sync không
    setTimeout(processSyncQueue, 2000);
};
