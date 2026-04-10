# ==========================================
# SYNC OLD DATA TO CLOUD V1.2.2.0 (INDEX BASED)
# ==========================================

$csvFile = Get-ChildItem -Filter "*.csv" | Select-Object -First 1
if ($null -eq $csvFile) {
    Write-Host "Error: No CSV file found!" -ForegroundColor Red
    exit
}
$csvPath = $csvFile.FullName
$firebaseUrl = "https://tct-scanner-pro-default-rtdb.asia-southeast1.firebasedatabase.app/scans.json"

Write-Host "Starting sync process (Index Mode)..." -ForegroundColor Cyan

# Read all lines directly to avoid header encoding issues
$lines = Get-Content -Path $csvPath -Encoding UTF8
if ($lines.Count -lt 2) {
    Write-Host "Error: CSV is empty!" -ForegroundColor Red
    exit
}

$uploadData = @{}
$count = 0

# Skip header row (index 0)
for ($i = 1; $i -lt $lines.Count; $i++) {
    $line = $lines[$i].Trim()
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    $cols = $line -split ","
    if ($cols.Count -lt 2) { continue }

    $orderId = $cols[0].Trim()
    $rawTime = $cols[1].Trim()

    if ([string]::IsNullOrWhiteSpace($orderId)) { continue }

    # Format: 03-04-2026 21:13:38 -> 21:13:38 03/04/2026
    try {
        $parts = $rawTime -split " "
        if ($parts.Count -lt 2) { continue }
        
        $dateParts = $parts[0] -split "-"
        if ($dateParts.Count -lt 3) { continue }
        
        $newTimeStr = "$($parts[1]) $($dateParts[0])/$($dateParts[1])/$($dateParts[2])"

        $uploadData[$orderId] = @{
            content = $orderId
            time    = $newTimeStr
            user    = "Data Cu"
        }
        $count++
    } catch {
        Write-Host "Warn: Skip line $i" -ForegroundColor Yellow
    }
}

if ($count -eq 0) {
    Write-Host "No valid records found to upload." -ForegroundColor Yellow
    exit
}

Write-Host "Prepared $count records. Uploading..." -ForegroundColor Green

# Convert to JSON and use PATCH
$jsonBody = $uploadData | ConvertTo-Json -Depth 5
try {
    $response = Invoke-RestMethod -Uri $firebaseUrl -Method PATCH -Body $jsonBody -ContentType "application/json"
    Write-Host "SUCCESS: Synced $count orders!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
