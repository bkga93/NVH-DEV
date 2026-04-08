// Cấu hình URL Google Apps Script chính thức từ bạn
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzViEYJCUkGFTnIYmNZRMJ_Zix5yXfExvPn5yWx3nQ0/exec";

let html5QrCode;
let isScanning = false;
let isSearchScanning = false;
let lastScanTime = 0;
let isProcessing = false; // Khóa để tránh việc gửi dữ liệu trùng lặp khi đang xử lý
const SCAN_DELAY = 2000; // Độ trễ giữa các lần quét thành công (2 giây)

// Khởi tạo Audio Context cho tiếng "Tít" siêu thị
let audioCtx;
function playBeep() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime); // Tần số cao đặc trưng của máy quét
        
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

// Chớp màn hình khi thành công
function triggerFlash() {
    const flash = document.getElementById('flash-overlay');
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 500);
}

// Chuyển đổi giữa các Tab triệt để
function switchTab(tab) {
    // Ẩn tất cả view
    document.getElementById('scan-view').style.display = 'none';
    document.getElementById('history-view').style.display = 'none';
    document.getElementById('scan-view').classList.remove('active');
    document.getElementById('history-view').classList.remove('active');
    
    // Bỏ active nút tab
    document.getElementById('btn-tab-scan').classList.remove('active');
    document.getElementById('btn-tab-history').classList.remove('active');

    // Hiện view mục tiêu
    if (tab === 'scan') {
        document.getElementById('scan-view').style.display = 'flex';
        document.getElementById('scan-view').classList.add('active');
        document.getElementById('btn-tab-scan').classList.add('active');
    } else {
        document.getElementById('history-view').style.display = 'flex';
        document.getElementById('history-view').classList.add('active');
        document.getElementById('btn-tab-history').classList.add('active');
        if (isScanning) stopScanner(); // Dừng camera khi xem lịch sử
        loadLocalHistory();
    }
}

// Bật/Tắt Camera chính
async function toggleScanner() {
    const btn = document.getElementById('start-btn');
    if (!isScanning) {
        try {
            if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
            
            // Kích hoạt âm thanh (Để Safari cho phép)
            playBeep();

            await html5QrCode.start(
                { facingMode: "environment" },
                { 
                    fps: 20, 
                    qrbox: (w, h) => { return { width: w * 0.7, height: w * 0.7 }; },
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

// Khi quét thành công mã đơn hàng
async function onScanSuccess(decodedText) {
    const now = Date.now();
    if (isProcessing || (now - lastScanTime < SCAN_DELAY)) return;

    // Chế độ Tìm kiếm trong Lịch sử
    if (isSearchScanning) {
        playBeep();
        triggerFlash();
        document.getElementById('search-input').value = decodedText;
        filterHistory();
        stopScanner();
        showToast("Đã tìm thấy mã: " + decodedText);
        return;
    }

    // Chế độ Quét nạp dữ liệu bình thường
    isProcessing = true;
    lastScanTime = now;
    
    // 1. Phản hồi tức thì
    playBeep();
    triggerFlash();

    // 2. Cập nhật giao diện
    document.getElementById('scanned-result').innerText = decodedText;
    document.getElementById('sync-status').innerText = "Đang gửi lên Google Sheets...";
    document.getElementById('sync-status').style.color = "var(--primary-color)";

    // 3. Chuẩn bị dữ liệu
    const scanMode = document.querySelector('input[name="scanMode"]:checked').value;
    const orderData = {
        orderId: "NVH-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
        content: decodedText,
        scanTime: new Date().toLocaleString('vi-VN')
    };

    // Lưu vào bộ nhớ máy trước
    saveToLocal(orderData);

    // Gửi lên Google Sheets với phương thức an toàn
    const success = await sendToGoogleSheets(orderData);

    if (success) {
        document.getElementById('sync-status').innerText = "Đã gửi thành công!";
        document.getElementById('sync-status').style.color = "var(--success)";
    } else {
        document.getElementById('sync-status').innerText = "Giao diện: Lỗi đồng bộ (Đã lưu tại máy)";
        document.getElementById('sync-status').style.color = "var(--danger)";
    }

    isProcessing = false;

    // 4. Xử lý chế độ Quét tiếp hay Dừng
    if (scanMode === 'single') {
        setTimeout(() => stopScanner(), 500);
    }
}

// Gửi lên Google Sheets sử dụng định dạng Text/Plain để tránh lỗi CORS trên Safari iPhone
async function sendToGoogleSheets(data) {
    try {
        // Gửi dưới dạng văn bản thô để vượt qua kiểm tra CORS nghiêm ngặt của Safari
        const response = await fetch(APP_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            }
        });
        return true; // Thường Apps Script sẽ chấp nhận ngay cả khi không có header Access-Control
    } catch (error) {
        console.error("Fetch Error:", error);
        return false;
    }
}

// --- LOGIC LỊCH SỬ & TÌM KIẾM ---

function saveToLocal(data) {
    let history = JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
    history.unshift(data);
    localStorage.setItem('nvh_scan_history', JSON.stringify(history.slice(0, 100)));
}

function loadLocalHistory(filteredData = null) {
    const list = document.getElementById('history-list');
    const history = filteredData || JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
    
    if (history.length === 0) {
        list.innerHTML = "<p class='empty-msg'>Không tìm thấy dữ liệu nào.</p>";
        return;
    }

    list.innerHTML = history.map(item => `
        <div class="history-item">
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
    const history = JSON.parse(localStorage.getItem('nvh_scan_history') || '[]');
    const filtered = history.filter(item => 
        item.content.toLowerCase().includes(query) || 
        item.orderId.toLowerCase().includes(query)
    );
    loadLocalHistory(filtered);
}

// Bật quét để tìm kiếm trong lịch sử
function startSearchScan() {
    switchTab('scan');
    isSearchScanning = true;
    showToast("Vui lòng quét mã để tìm trong lịch sử...");
    if (!isScanning) toggleScanner();
}

function clearLocalHistory() {
    if (confirm("Xóa toàn bộ lịch sử trên máy này?")) {
        localStorage.removeItem('nvh_scan_history');
        loadLocalHistory();
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Tự động khởi động khi load (tùy chọn)
window.onload = () => {
    loadLocalHistory();
};
