const express = require('express');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs/promises');
const path = require('path');
const iconv = require('iconv-lite');
const OpenCC = require('opencc-js');
const multer = require('multer');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 定義常數與檔案路徑
const RADAR_EXE_PATH = '/root/Dma_RAY_RADAR_Service/RAY_DELTA_RADAR.exe';
const LOG_FILE = '/root/Dma_RAY_RADAR_Service/radar.log';
const CONFIG_FILE = '/root/Dma_RAY_RADAR_Service/config.json';
const PORT = 3000;

let config = {}; // 全局變數，用於儲存設定

// 讀取設定檔案
const loadConfig = async () => {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        config = JSON.parse(data);
        console.log('設定檔案已成功載入。');
    } catch (e) {
        console.error('載入設定檔案失敗，將使用預設值。', e.message);
        config = {
            adminPass: 'admin666',
            appPort: '8080'
        };
    }
};

// 設定 Multer 儲存引擎
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.dirname(RADAR_EXE_PATH);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, path.basename(RADAR_EXE_PATH));
    }
});
const upload = multer({ storage: storage });

// 簡繁體轉換工具
const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

// 輔助函式：檢查檔案是否存在
const checkFileExists = async (filePath) => {
    try {
        await fs.access(filePath, fs.constants.F_OK);
        return true;
    } catch (e) {
        return false;
    }
};

// 輔助函式：檢查進程是否運行
const isRadarRunning = async () => {
    try {
        const { stdout } = await exec(`ps aux | grep "RAY_DELTA_RADAR.exe" | grep -v "grep"`);
        return stdout.trim() !== '';
    } catch (e) {
        return false;
    }
};

/**
 * 處理啟動、停止、查看狀態的指令
 */
const handleRadarAction = async (req, res) => {
    const { action } = req.params;
    
    const exeExists = await checkFileExists(RADAR_EXE_PATH);
    if (!exeExists && (action === 'start' || action === 'status')) {
        return res.status(404).send(`<h3>操作失敗：找不到執行檔</h3><pre>錯誤：${RADAR_EXE_PATH} 檔案不存在。請先上傳檔案。</pre>`);
    }

    try {
        if (action === 'start') {
            // 自動開放防火牆埠口
            await exec(`sudo ufw allow ${config.appPort}`);

            const command = `nohup bash -c "echo -e \\"${config.adminPass}\\n${config.appPort}\\" | wine \\"${RADAR_EXE_PATH}\\"" > ${LOG_FILE} 2>&1 &`;
            await exec(command);
            res.send(`<h3>Radar 已啟動</h3><pre>後台進程已成功啟動。</pre>`);
        } else if (action === 'stop') {
            try {
                await exec(`pkill -f "RAY_DELTA_RADAR.exe"`);
                res.send(`<h3>Radar 已停止</h3><pre>進程已成功終止。</pre>`);
            } catch (error) {
                res.send(`<h3>Radar 已停止</h3><pre>停止指令已完成。</pre>`);
            } finally {
                await fs.writeFile(LOG_FILE, '', 'utf8');
            }
        } else if (action === 'status') {
            const isRunning = await isRadarRunning();
            if (isRunning) {
                res.send(`<h3>Radar 狀態: 運行中</h3>`);
            } else {
                res.send(`<h3>Radar 狀態: 未運行</h3><pre>沒有找到相關進程。</pre>`);
            }
        } else {
            res.send(`<h3>未知指令: ${action}</h3>`);
        }
    } catch (error) {
        const message = action === 'start' ? '啟動' : action === 'stop' ? '停止' : '查看狀態';
        const errorOutput = (error.message || '沒有錯誤訊息').toString().trim();
        res.send(`<h3>${message} Radar 失敗</h3><pre>${errorOutput}</pre>`);
    }
};

/**
 * 讀取並傳回日誌內容
 */
const getRadarLog = async (req, res) => {
    const lang = req.query.lang || 'zh-cn';
    try {
        const data = await fs.readFile(LOG_FILE, null);
        let str = iconv.decode(data, 'gbk');
        
        if (str.trim() === '') {
            str = 'RAY Radar 尚未啟動';
        }
        
        if (lang === 'zh-tw') {
            str = s2t(str);
        } else if (lang === 'zh-cn') {
            str = t2s(str);
        }
        
        res.send(str);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.send('日誌檔案尚未建立。請啟動服務後等待日誌生成。');
        } else {
            res.send(`讀取 log 失敗: ${err.message}`);
        }
    }
};

/**
 * 處理檔案上傳
 * 僅負責上傳檔案，不負責重啟服務
 */
const handleUpload = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'error', message: '請選擇一個檔案。' });
    }
    
    // 確保上傳後檔案名正確
    const oldPath = path.join(path.dirname(RADAR_EXE_PATH), req.file.filename);
    const newPath = RADAR_EXE_PATH;
    try {
        await fs.rename(oldPath, newPath);
        res.status(200).json({ status: 'success', message: `檔案 ${path.basename(newPath)} 已成功上傳。` });
    } catch (err) {
        res.status(500).json({ status: 'error', message: `檔案重命名失敗: ${err.message}` });
    }
};

/**
 * 處理服務重啟
 * 僅負責重啟服務，並在重啟前結束回應
 */
const handleRestart = async (req, res) => {
    try {
        // 先回傳成功訊息給前端
        res.status(200).json({ status: 'success', message: '正在重啟 PM2 服務。' });
        // 延遲一段時間以確保回應已發送
        await new Promise(resolve => setTimeout(resolve, 500)); 
        await exec('pm2 restart radar-panel', { env: { PATH: process.env.PATH + ':/usr/local/bin' } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `PM2 指令執行失敗：${error.message}` });
    }
};

/**
 * 處理檔案刪除
 */
const handleDelete = async (req, res) => {
    try {
        const exeExists = await checkFileExists(RADAR_EXE_PATH);
        if (!exeExists) {
            return res.status(404).json({ status: 'error', message: '檔案不存在，無法刪除。' });
        }
        
        // 停止相關進程
        try {
            await exec(`pkill -f "RAY_DELTA_RADAR.exe"`);
        } catch (stopErr) {
            // 如果進程未運行，pkill 會出錯，這屬於正常情況，忽略此錯誤
        }
        
        await fs.unlink(RADAR_EXE_PATH);
        
        // 清空日誌檔案
        try {
            await fs.writeFile(LOG_FILE, '', 'utf8');
        } catch (logErr) {
            console.error('清空日誌檔案失敗:', logErr);
        }

        res.status(200).json({ status: 'success', message: `檔案 ${path.basename(RADAR_EXE_PATH)} 已成功刪除。日誌已清空。` });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `檔案刪除失敗：${error.message}` });
    }
};

// --- API 路由 ---
// 獲取設定
app.get('/api/get-config', (req, res) => {
    res.json(config);
});

// 保存設定並依狀態決定是否重啟
app.post('/api/save-config', async (req, res) => {
    const { adminPass, appPort } = req.body;
    if (!adminPass || !appPort) {
        return res.status(400).json({ status: 'error', message: '密碼和端口不能為空。' });
    }
    
    // 密碼長度驗證
    if (adminPass.length !== 8) {
        return res.status(400).json({ status: 'error', message: '密碼長度必須為8個字元。' });
    }

    const newConfig = { adminPass, appPort };
    try {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
        config = newConfig; // 更新內存中的設定
        
        const isRunning = await isRadarRunning();
        
        if (isRunning) {
            res.status(200).json({ status: 'success', message: '設定已保存。正在重啟服務以應用新設定。' });
            // 延遲重啟，確保回應已發送
            await new Promise(resolve => setTimeout(resolve, 500));
            await exec('pm2 restart radar-panel', { env: { PATH: process.env.PATH + ':/usr/local/bin' } });
        } else {
            res.status(200).json({ status: 'success', message: '設定已保存。變更將於下次啟動時套用。' });
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: `保存設定失敗：${error.message}` });
    }
});

// 新增一個檢查檔案是否存在的 API 路由
app.get('/api/check-exe', async (req, res) => {
    const exeExists = await checkFileExists(RADAR_EXE_PATH);
    res.json({ exists: exeExists });
});

// 新增一個檢查服務是否正在運行的 API 路由
app.get('/api/check-status', async (req, res) => {
    const isRunning = await isRadarRunning();
    res.json({ isRunning: isRunning });
});

// 新增一個獲取檔案修改時間的 API 路由
app.get('/api/file-mtime', async (req, res) => {
    try {
        const stats = await fs.stat(RADAR_EXE_PATH);
        res.json({ mtime: stats.mtime });
    } catch (err) {
        res.status(404).json({ error: '找不到檔案' });
    }
});

// 核心路由設定
app.post('/radar/:action', handleRadarAction);
app.get('/radar/log', getRadarLog);
app.post('/upload', upload.single('radarFile'), handleUpload);
app.post('/restart', handleRestart);
app.post('/delete-exe', handleDelete);

// --- Web 介面路由 ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="UTF-8">
<title>RAY Radar 控制面板</title>
<style>
:root {
    --bg-color: #c9d0cf;
    --container-bg: #e3e5e5;
    --text-color: #333;
    --header-color: #2c3e50;
    --button-bg: #3498db;
    --button-hover-bg: #2980b9;
    --select-bg: #bbc9ca;
    --select-border: #bdc3c7;
    --log-bg: #c7cac9;
    --log-text-color: #333;
    --switch-bg-light: #c9d0cf;
    --switch-bg-dark: #3498db;
    --switch-thumb: #fff;
    --thumb-color: #2c3e50;
    --scrollbar-thumb: #a0a0a0;
    --scrollbar-track: #e0e0e0;
    --upload-bg: #27ae60;
    --upload-hover-bg: #229954;
    --file-input-bg: #fff;
    --delete-bg: #e74c3c;
    --delete-hover-bg: #c0392b;
    --modal-bg: rgba(0,0,0,0.5);
    --modal-content-bg: #e3e5e5;
    --input-bg: #fff;
    --save-btn-bg: #2ecc71;
    --save-btn-hover-bg: #27ae60;
    --cancel-btn-bg: #e74c3c;
    --cancel-btn-hover-bg: #c0392b;
    --warning-btn-bg: #e74c3c;
    --warning-btn-hover-bg: #c0392b;
    --reset-btn-bg: #A9A9A9;
    --reset-btn-hover-bg: #8c8c8c;
}

.dark-theme {
    --bg-color: #2c3e50;
    --container-bg: #34495e;
    --text-color: #ecf0f1;
    --header-color: #ecf0f1;
    --button-bg: #3498db;
    --button-hover-bg: #2980b9;
    --select-bg: #4e6378;
    --select-border: #6d8091;
    --log-bg: #1a242f;
    --log-text-color: #b7c0cc;
    --switch-bg-light: #c9d0cf;
    --switch-bg-dark: #3498db;
    --switch-thumb: #fff;
    --thumb-color: #fff;
    --scrollbar-thumb: #5b6e82;
    --scrollbar-track: #2a3847;
    --upload-bg: #2ecc71;
    --upload-hover-bg: #27ae60;
    --file-input-bg: #3b5066;
    --delete-bg: #e74c3c;
    --delete-hover-bg: #c0392b;
    --modal-bg: rgba(0,0,0,0.7);
    --modal-content-bg: #34495e;
    --input-bg: #3b5066;
    --save-btn-bg: #2ecc71;
    --save-btn-hover-bg: #27ae60;
    --cancel-btn-bg: #e74c3c;
    --cancel-btn-hover-bg: #c0392b;
    --warning-btn-bg: #e74c3c;
    --warning-btn-hover-bg: #c0392b;
    --reset-btn-bg: #636e72;
    --reset-btn-hover-bg: #4b5458;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background-color: var(--bg-color);
    color: var(--text-color);
    margin: 0;
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: background-color 0.3s ease;
}
.container {
    background: var(--container-bg);
    padding: 30px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    width: 100%;
    max-width: 800px;
    box-sizing: border-box;
    transition: background-color 0.3s ease, box-shadow 0.3s ease;
}
h1 { color: var(--header-color); text-align: center; margin-bottom: 20px; font-weight: 500; }
.controls { 
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 10px;
    margin-bottom: 20px;
    gap: 10px;
}
button, select {
    padding: 10px 20px;
    font-size: 16px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s ease;
    font-weight: 600;
}
button { background-color: var(--button-bg); color: white; }
button.upload-btn { background-color: var(--upload-bg); }
button.upload-btn:hover { background-color: var(--upload-hover-bg); }
button.delete-btn { background-color: var(--delete-bg); }
button.delete-btn:hover { background-color: var(--delete-hover-bg); }
button.reset-btn { background-color: var(--reset-btn-bg); color: white; }
button.reset-btn:hover { background-color: var(--reset-btn-hover-bg); }

button:hover { background-color: var(--button-hover-bg); transform: translateY(-2px); }
.modal-buttons button.save-btn { background-color: var(--save-btn-bg); }
.modal-buttons button.save-btn:hover { background-color: var(--save-btn-hover-bg); }
.modal-buttons button.cancel-btn { background-color: var(--cancel-btn-bg); }
.modal-buttons button.cancel-btn:hover { background-color: var(--cancel-btn-hover-bg); }

/* 新增的樣式 */
.modal-buttons button.success-btn { background-color: var(--upload-bg); }
.modal-buttons button.success-btn:hover { background-color: var(--upload-hover-bg); }
.modal-buttons button.warning-btn { background-color: var(--warning-btn-bg); }
.modal-buttons button.warning-btn:hover { background-color: var(--warning-btn-hover-bg); }


.select-wrapper {
    position: relative;
}
select {
    padding: 10px 20px;
    font-size: 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s ease;
    font-weight: 600;
    
    background-color: var(--select-bg);
    border: 1px solid var(--select-border);
    color: var(--text-color);
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    padding-right: 40px;
    background-image: url('data:image/svg+xml;utf8,<svg fill="%23333" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>');
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 20px;
}
.dark-theme select {
    background-image: url('data:image/svg+xml;utf8,<svg fill="%23ecf0f1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>');
}
.upload-form {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 10px;
    gap: 10px;
}
.upload-form input[type="file"] {
    padding: 8px;
    background: var(--file-input-bg);
    border: 1px solid var(--select-border);
    border-radius: 8px;
    color: var(--text-color);
    font-size: 14px;
}
.dark-theme .upload-form input[type="file"] {
    border-color: #6d8091;
}

#log-section { margin-top: 20px; }
#log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
#log-header h2 { font-size: 18px; color: var(--header-color); margin: 0; }
#log {
    background: var(--log-bg);
    color: var(--log-text-color);
    padding: 15px;
    border-radius: 8px;
    font-family: 'Courier New', Courier, monospace;
    white-space: pre-wrap;
    height: 400px;
    overflow-y: scroll;
    line-height: 1.4;
    font-size: 14px;
    box-shadow: inset 0 2px 5px rgba(0,0,0,0.1);
    transition: background-color 0.3s ease, color 0.3s ease;
}

#log::-webkit-scrollbar {
    width: 8px;
}
#log::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
    border-radius: 10px;
}
#log::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 10px;
}
#log::-webkit-scrollbar-thumb:hover {
    background: #555;
}


.theme-switch-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
}
.theme-switch {
    display: inline-block;
    height: 34px;
    position: relative;
    width: 60px;
}
.theme-switch input {
    display: none;
}
.slider {
    background-color: var(--switch-bg-light);
    border: 1px solid var(--select-border);
    bottom: 0;
    cursor: pointer;
    left: 0;
    position: absolute;
    right: 0;
    top: 0;
    transition: .4s;
    border-radius: 34px;
}
.slider:before {
    background-color: var(--thumb-color);
    bottom: 4px;
    content: '☀️';
    height: 26px;
    left: 4px;
    position: absolute;
    transition: .4s;
    width: 26px;
    border-radius: 50%;
    
    display: flex;
    align-items: center;
    justify-content: center;
}

input:checked + .slider {
    background-color: var(--switch-bg-dark);
}
input:checked + .slider:before {
    transform: translateX(26px);
    content: '🌑';
}

.warning-message {
    text-align: center;
    padding: 15px;
    background-color: #e74c3c;
    color: white;
    border-radius: 8px;
    font-weight: bold;
    margin-bottom: 20px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
}

.status-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.status-info {
    display: flex;
    align-items: center;
    gap: 10px;
}

.status-indicator {
    display: inline-block;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--text-color);
    box-shadow: 0 0 5px rgba(0,0,0,0.2);
}
.status-indicator.red {
    background-color: #e74c3c;
}
.status-indicator.green {
    background-color: #2ecc71;
}

/* 新增的 CSS 類別來隱藏檔案選擇欄位 */
.hidden {
    display: none;
}

.mtime-display {
    text-align: center;
    font-size: 14px;
    color: var(--text-color);
    width: 100%;
}
.mtime-display p {
    margin: 0;
}

/* Modal 樣式 */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--modal-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease, visibility 0.3s ease;
}

.modal-overlay.show {
    opacity: 1;
    visibility: visible;
}

.modal-content {
    background-color: var(--modal-content-bg);
    padding: 30px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    width: 90%;
    max-width: 450px;
    transform: scale(0.95);
    transition: transform 0.3s ease;
}

.modal-overlay.show .modal-content {
    transform: scale(1);
}

.modal-content h3 {
    text-align: center;
    color: var(--header-color);
    margin-top: 0;
    margin-bottom: 20px;
}
.modal-content label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
}
.modal-content input {
    width: 100%;
    padding: 10px;
    margin-bottom: 15px;
    border: 1px solid var(--select-border);
    border-radius: 8px;
    background-color: var(--input-bg);
    color: var(--text-color);
    font-size: 16px;
    box-sizing: border-box;
    transition: border-color 0.3s ease;
}
.modal-content input:focus {
    outline: none;
    border-color: var(--button-bg);
}

.modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
}
.modal-buttons button {
    min-width: 80px;
}

/* 定義慢速動畫 */
@keyframes slow-spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}

/* 定義快速動畫 */
@keyframes fast-spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}

.settings-btn {
    font-size: 20px;
    background-color: #A9A9A9; /* 灰色背景 */
    border: none;
    cursor: pointer;
    color: var(--text-color);
    transition: color 0.3s ease;
}
.gear-icon {
    display: inline-block;
    animation: slow-spin 8s linear infinite;
}
.settings-btn:hover .gear-icon {
    animation: fast-spin 2s linear infinite;
}

/* 確保彈窗中的按鈕能垂直置中 */
.modal-button-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 20px;
}
</style>
</head>
<body>
<div class="container">
    <h1 data-key="title">RAY Radar 控制面板</h1>
    <div class="status-row">
        <div class="status-info">
            <span id="file-status-label" data-key="fileStatusLabel">雷達執行檔狀態：</span>
            <div id="file-status-indicator" class="status-indicator"></div>
            <span id="file-status-text">載入中...</span>
        </div>
    </div>
    
    <div id="file-actions">
        <div id="mtime-display" class="mtime-display"></div>
        <form id="upload-form" class="upload-form" enctype="multipart/form-data">
            <input type="file" name="radarFile" id="radarFile" accept=".exe" required>
            <div id="action-buttons" style="display: flex; gap: 10px;">
                <button type="submit" class="upload-btn" id="upload-button"></button>
                <button id="settings-btn" class="settings-btn" title="設定"><span class="gear-icon">⚙️</span></button>
            </div>
        </form>
    </div>

    <div class="controls">
        <button onclick="controlRadar('start')" data-key="startButton">啟動 Radar</button>
        <button onclick="controlRadar('stop')" data-key="stopButton">停止 Radar</button>
        <button onclick="controlRadar('status')" data-key="statusButton">查看狀態</button>
        <div class="select-wrapper">
            <select id="lang" onchange="switchLanguage(this.value)">
                <option value="zh-cn">简体</option>
                <option value="zh-tw">繁體</option>
            </select>
        </div>
        <div class="theme-switch-wrapper">
            <label class="theme-switch" for="checkbox">
                <input type="checkbox" id="checkbox" />
                <span class="slider"></span>
            </label>
        </div>
    </div>

    <div id="log-section">
        <div id="log-header">
            <h2 data-key="logHeader">日誌輸出</h2>
        </div>
        <div id="log" data-key="logInitial">正在載入 log...</div>
    </div>
</div>

<div id="settings-modal" class="modal-overlay">
    <div class="modal-content">
        <h3 data-key="settingsTitle">設定</h3>
        <form id="settings-form">
            <label for="adminPass" data-key="adminPassLabel">管理員密碼：</label>
            <input type="text" id="adminPass" name="adminPass" required>
            
            <label for="appPort" data-key="appPortLabel">運行端口：</label>
            <input type="number" id="appPort" name="appPort" required>
            
            <div class="modal-buttons">
                <button type="button" class="reset-btn" id="reset-settings" data-key="resetButton">重置</button>
                <button type="button" class="cancel-btn" id="cancel-settings" data-key="cancelButton">取消</button>
                <button type="submit" class="save-btn" id="save-settings" data-key="saveButton">保存</button>
            </div>
        </form>
    </div>
</div>

<div id="success-modal" class="modal-overlay">
    <div class="modal-content">
        <h3 data-key="successTitle">成功</h3>
        <p id="success-message-text" style="text-align: center; font-size: 1.1em;"></p>
        <div class="modal-button-container">
            <button id="success-confirm-btn" class="modal-buttons success-btn">確定</button>
        </div>
    </div>
</div>

<div id="status-warning-modal" class="modal-overlay">
    <div class="modal-content">
        <h3 data-key="warningTitle">警告</h3>
        <p id="status-warning-message-text" style="text-align: center; font-size: 1.1em;"></p>
        <div class="modal-button-container">
            <button id="status-warning-confirm-btn" class="modal-buttons warning-btn">確定</button>
        </div>
    </div>
</div>

<div id="warning-modal" class="modal-overlay">
    <div class="modal-content">
        <h3 data-key="warningTitle">警告</h3>
        <p id="warning-message-text" style="text-align: center; font-size: 1.1em;"></p>
        <div class="modal-button-container">
            <button id="warning-confirm-btn" class="modal-buttons warning-btn">確定</button>
        </div>
    </div>
</div>

<script>
// 語言包
const translations = {
    'zh-cn': {
        title: 'RAY Radar 控制面板',
        fileStatusLabel: '雷达执行档状态：',
        fileStatusExists: '文件已存在',
        fileStatusNotExists: '文件不存在',
        fileStatusChecking: '加载中...',
        fileMtimeLabel: '文件上传时间：',
        fileMtimeNotFound: '找不到文件',
        uploadButton: '上传 EXE',
        updateButton: '更新雷达 EXE',
        deleteButton: '删除雷达 EXE',
        startButton: '启动 Radar',
        stopButton: '停止 Radar',
        statusButton: '查看状态',
        logHeader: '日志输出',
        logInitial: '正在加载 log...',
        logUploading: '正在上传中...',
        uploadSuccess: '上传成功：',
        restartPrompt: '正在重启服务...',
        restartSuccess: '重启成功：',
        refreshPrompt: '页面即将刷新。',
        uploadFailed: '操作失败: ',
        deleteConfirm: '您确定要删除雷达执行档吗？此操作将同时停止相关服务并清除日誌。',
        deleteDeleting: '正在删除文件...',
        deleteSuccess: '删除成功：',
        deleteLogMessage: '文件已成功删除。日誌已清空。',
        deleteFailed: '删除操作失败: ',
        checkFailed: '检查状态失败',
        fileDeleteFailed: '文件删除失败：',
        // 新增設定彈窗翻譯
        settingsTitle: '设置',
        adminPassLabel: '管理员密码：',
        appPortLabel: '运行端口：',
        saveButton: '保存',
        cancelButton: '取消',
        saveSuccess: '设置已保存。正在重启服务以应用新设置。',
        saveFailed: '保存设置失败：',
        radarRunningWarning: '雷达正在运行，请于停止状态再变更。', // 新增
        warningTitle: '警告',
        radarRunningInfo: '雷达正在运行，变更将于下次启动生效。',
        saveSuccessNotRunning: '设置已保存。变更将于下次启动时套用。', // 新增
        successTitle: '成功', // 新增
        resetButton: '重置' // 新增
    },
    'zh-tw': {
        title: 'RAY Radar 控制面板',
        fileStatusLabel: '雷達執行檔狀態：',
        fileStatusExists: '檔案已存在',
        fileStatusNotExists: '檔案不存在',
        fileStatusChecking: '載入中...',
        fileMtimeLabel: '檔案上傳時間：',
        fileMtimeNotFound: '找不到檔案',
        uploadButton: '上傳 EXE',
        updateButton: '更新雷達 EXE',
        deleteButton: '刪除雷達 EXE',
        startButton: '啟動 Radar',
        stopButton: '停止 Radar',
        statusButton: '查看狀態',
        logHeader: '日誌輸出',
        logInitial: '正在載入 log...',
        logUploading: '正在上傳中...',
        uploadSuccess: '上傳成功：',
        restartPrompt: '正在重啟服務...',
        restartSuccess: '重啟成功：',
        refreshPrompt: '頁面即將刷新。',
        uploadFailed: '操作失敗: ',
        deleteConfirm: '您確定要刪除雷達執行檔嗎？此操作將同時停止相關服務並清除日誌。',
        deleteDeleting: '正在刪除檔案...',
        deleteSuccess: '刪除成功：',
        deleteLogMessage: '檔案已成功刪除。日誌已清空。',
        deleteFailed: '刪除操作失敗: ',
        checkFailed: '檢查狀態失敗',
        fileDeleteFailed: '檔案刪除失敗：',
        // 新增設定彈窗翻譯
        settingsTitle: '設定',
        adminPassLabel: '管理員密碼：',
        appPortLabel: '運行端口：',
        saveButton: '保存',
        cancelButton: '取消',
        saveSuccess: '設定已保存。正在重啟服務以應用新設定。',
        saveFailed: '保存設定失敗：',
        radarRunningWarning: '雷達正在運行，請於停止狀態再變更。', // 新增
        warningTitle: '警告',
        radarRunningInfo: '雷達正在運行，變更將於下次啟動生效。',
        saveSuccessNotRunning: '設定已保存。變更將於下次啟動時套用。', // 新增
        successTitle: '成功', // 新增
        resetButton: '重置' // 新增
    }
};

let currentLang = 'zh-tw'; // 預設為繁體

function switchLanguage(lang) {
    currentLang = lang;
    document.querySelectorAll('[data-key]').forEach(el => {
        const key = el.getAttribute('data-key');
        if (translations[currentLang][key]) {
            el.textContent = translations[currentLang][key];
        }
    });
    // 更新動態產生的按鈕文字
    checkFileStatus();
    // 更新 log 內容
    viewLog();
}

function controlRadar(action) {
    fetch('/radar/' + action, { method: 'POST' })
        .then(response => response.text())
        .then(html => document.getElementById('log').innerHTML = html)
        .catch(err => document.getElementById('log').innerHTML = '錯誤：' + err);
}

function viewLog() {
    fetch('/radar/log?lang=' + currentLang)
        .then(response => response.text())
        .then(html => {
            const logDiv = document.getElementById('log');
            logDiv.innerHTML = html;
            logDiv.scrollTop = logDiv.scrollHeight;
        });
}

// 處理檔案上傳
document.getElementById('upload-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    const formData = new FormData(this);
    const logDiv = document.getElementById('log');
    logDiv.innerHTML = translations[currentLang].logUploading;

    try {
        const uploadResponse = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorData = await uploadResponse.text();
            throw new Error(errorData);
        }

        const uploadData = await uploadResponse.json();
        logDiv.innerHTML = translations[currentLang].uploadSuccess + uploadData.message + '<br>' + translations[currentLang].restartPrompt;

        const restartResponse = await fetch('/restart', { method: 'POST' });
        
        if (!restartResponse.ok) {
            const errorData = await restartResponse.text();
            throw new Error(errorData);
        }
        
        const restartData = await restartResponse.json();
        
        if (restartData.status === 'success') {
            logDiv.innerHTML = translations[currentLang].restartSuccess + restartData.message + '<br>' + translations[currentLang].refreshPrompt;
            setTimeout(() => {
                window.location.reload();
            }, 1000); 
        } else {
            throw new Error(restartData.message);
        }
    } catch (error) {
        logDiv.innerHTML = translations[currentLang].uploadFailed + error.message;
    }
});

// 處理檔案刪除
async function deleteRadarExe() {
    const logDiv = document.getElementById('log');
    if (!confirm(translations[currentLang].deleteConfirm)) {
        return;
    }

    logDiv.innerHTML = translations[currentLang].deleteDeleting;
    try {
        const response = await fetch('/delete-exe', { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            logDiv.innerHTML = translations[currentLang].deleteLogMessage + '<br>' + translations[currentLang].refreshPrompt;
            setTimeout(() => {
                window.location.reload();
            }, 1000); 
        } else {
            throw new Error(data.message || translations[currentLang].fileDeleteFailed);
        }
    } catch (error) {
        logDiv.innerHTML = translations[currentLang].deleteFailed + error.message;
    }
}

// 獲取並顯示檔案修改時間
async function getFileMtime() {
    const mtimeDiv = document.getElementById('mtime-display');
    
    try {
        const response = await fetch('/api/file-mtime');
        if (response.ok) {
            const data = await response.json();
            const mtime = new Date(data.mtime);
            mtimeDiv.textContent = translations[currentLang].fileMtimeLabel + mtime.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        } else {
            mtimeDiv.textContent = translations[currentLang].fileMtimeLabel + translations[currentLang].fileMtimeNotFound;
        }
    } catch (err) {
        console.error('Failed to get file mtime:', err);
        mtimeDiv.textContent = translations[currentLang].fileMtimeLabel + translations[currentLang].fileMtimeNotFound;
    }
}

// 檢查 EXE 檔案是否存在並在介面顯示提示
async function checkFileStatus() {
    const statusIndicator = document.getElementById('file-status-indicator');
    const statusText = document.getElementById('file-status-text');
    const fileInput = document.getElementById('radarFile');
    const uploadButton = document.getElementById('upload-button');
    const mtimeDisplay = document.getElementById('mtime-display');
    const controls = document.querySelector('.controls');
    const actionButtonsDiv = document.getElementById('action-buttons');
    
    try {
        const response = await fetch('/api/check-exe');
        const data = await response.json();
        
        if (data.exists) {
            statusIndicator.classList.remove('red');
            statusIndicator.classList.add('green');
            statusText.textContent = translations[currentLang].fileStatusExists;
            
            // 檔案存在時的顯示邏輯
            mtimeDisplay.style.display = 'block';
            fileInput.classList.add('hidden');
            uploadButton.textContent = translations[currentLang].updateButton;
            uploadButton.setAttribute('type', 'button');
            controls.style.display = 'flex';
            
            // 動態新增刪除按鈕
            let deleteButton = document.getElementById('delete-button');
            if (!deleteButton) {
                deleteButton = document.createElement('button');
                deleteButton.id = 'delete-button';
                deleteButton.classList.add('delete-btn');
                deleteButton.addEventListener('click', deleteRadarExe);
                
                // 將刪除按鈕插入到最前面
                actionButtonsDiv.insertBefore(deleteButton, actionButtonsDiv.firstChild);
            }
            deleteButton.textContent = translations[currentLang].deleteButton;
            
        } else {
            statusIndicator.classList.remove('green');
            statusIndicator.classList.add('red');
            statusText.textContent = translations[currentLang].fileStatusNotExists;
            
            // 檔案不存在時的顯示邏輯
            mtimeDisplay.style.display = 'none';
            fileInput.classList.remove('hidden');
            uploadButton.textContent = translations[currentLang].uploadButton;
            uploadButton.setAttribute('type', 'submit');
            controls.style.display = 'none';
            
            // 移除刪除按鈕
            const deleteButton = document.getElementById('delete-button');
            if (deleteButton) {
                deleteButton.remove();
            }
        }
    } catch (err) {
        statusIndicator.classList.remove('green');
        statusIndicator.classList.add('red');
        statusText.textContent = translations[currentLang].checkFailed;
        mtimeDisplay.style.display = 'none';
        fileInput.classList.remove('hidden');
        uploadButton.textContent = translations[currentLang].uploadButton;
        uploadButton.setAttribute('type', 'submit');
        console.error('Failed to check file status:', err);
    }
}


function setupThemeToggle() {
    const checkbox = document.getElementById('checkbox');
    if (!checkbox) return;
    
    const currentTheme = localStorage.getItem('theme');
    
    if (currentTheme !== 'light') {
        document.body.classList.add('dark-theme');
        checkbox.checked = true;
    } else {
        document.body.classList.remove('dark-theme');
        checkbox.checked = false;
    }

    checkbox.addEventListener('change', function() {
        if (this.checked) {
            document.body.classList.add('dark-theme');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-theme');
            localStorage.setItem('theme', 'light');
        }
    });
}

// 頁面載入時執行
window.onload = () => {
    // 立即執行一次
    checkFileStatus();
    viewLog(); 
    getFileMtime();

    // 每 5 秒執行一次
    setInterval(() => {
        checkFileStatus();
        viewLog();
        getFileMtime();
    }, 5000);
    
    setupThemeToggle();
    switchLanguage('zh-tw'); // 初始載入時切換為繁體中文
};

// 新增監聽器以處理動態點擊
document.getElementById('upload-form').addEventListener('click', function(event) {
    const fileInput = document.getElementById('radarFile');
    const target = event.target;
    // 只有在按鈕文字為「更新雷達 EXE」時才觸發 click
    if (target.id === 'upload-button' && target.textContent === translations[currentLang].updateButton) {
        event.preventDefault(); // 阻止表單提交
        fileInput.click();
    }
});

// 監聽文件選擇欄位的變動
document.getElementById('radarFile').addEventListener('change', function() {
    // 當使用者選擇了檔案，手動觸發表單提交
    if (this.files.length > 0) {
        document.getElementById('upload-form').dispatchEvent(new Event('submit'));
    }
});

// --- 設定彈窗相關 JavaScript ---
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const saveBtn = document.getElementById('save-settings');
const cancelBtn = document.getElementById('cancel-settings');
const resetBtn = document.getElementById('reset-settings'); // 新增重置按鈕變數
const settingsForm = document.getElementById('settings-form');
const adminPassInput = document.getElementById('adminPass');
const appPortInput = document.getElementById('appPort');

// 顯示設定彈窗
settingsBtn.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/check-status');
        const data = await response.json();
        
        if (data.isRunning) {
            showStatusWarningModal(translations[currentLang].radarRunningInfo);
        } else {
            // 服務未啟動時直接顯示設定介面
            fetchAndPopulateConfig();
            settingsModal.classList.add('show');
        }
    } catch (error) {
        console.error('檢查雷達狀態失敗:', error);
        alert('檢查雷達狀態失敗。');
    }
});

// 隱藏設定彈窗
cancelBtn.addEventListener('click', () => {
    settingsModal.classList.remove('show');
});

// 點擊設定彈窗外部區域也隱藏彈窗
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.remove('show');
    }
});

// 讀取並填充設定
async function fetchAndPopulateConfig() {
    try {
        const response = await fetch('/api/get-config');
        const configData = await response.json();
        adminPassInput.value = configData.adminPass;
        appPortInput.value = configData.appPort;
    } catch (error) {
        console.error('讀取設定失敗:', error);
    }
}

// 處理重置按鈕點擊
resetBtn.addEventListener('click', () => {
    fetchAndPopulateConfig();
});

// --- 警告彈窗相關 JavaScript ---
const warningModal = document.getElementById('warning-modal');
const warningMessageText = document.getElementById('warning-message-text');
const warningConfirmBtn = document.getElementById('warning-confirm-btn');

function showWarningModal(message) {
    warningMessageText.textContent = message;
    warningModal.classList.add('show');
}

warningConfirmBtn.addEventListener('click', () => {
    warningModal.classList.remove('show');
});

// --- 新增的狀態警告彈窗 JavaScript ---
const statusWarningModal = document.getElementById('status-warning-modal');
const statusWarningMessageText = document.getElementById('status-warning-message-text');
const statusWarningConfirmBtn = document.getElementById('status-warning-confirm-btn');

function showStatusWarningModal(message) {
    statusWarningMessageText.textContent = message;
    statusWarningModal.classList.add('show');
}

statusWarningConfirmBtn.addEventListener('click', () => {
    statusWarningModal.classList.remove('show');
    fetchAndPopulateConfig(); // 點擊確定後，讀取並顯示設定彈窗
    settingsModal.classList.add('show');
});

// --- 新增的成功提示彈窗 JavaScript ---
const successModal = document.getElementById('success-modal');
const successMessageText = document.getElementById('success-message-text');
const successConfirmBtn = document.getElementById('success-confirm-btn');

function showSuccessModal(message, shouldReload = false) {
    successMessageText.textContent = message;
    successModal.classList.add('show');
    
    if (shouldReload) {
        successConfirmBtn.addEventListener('click', () => {
            window.location.reload();
        }, { once: true }); // 使用 once: true 確保只執行一次
    } else {
        successConfirmBtn.addEventListener('click', () => {
            successModal.classList.remove('show');
            settingsModal.classList.remove('show');
        }, { once: true });
    }
}


// 儲存設定
settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const logDiv = document.getElementById('log');
    
    const newConfig = {
        adminPass: adminPassInput.value,
        appPort: appPortInput.value
    };
    
    try {
        const response = await fetch('/api/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newConfig)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // 根據後端回傳的訊息判斷是否需要重新整理
            const shouldReload = (data.message === translations[currentLang].saveSuccess);
            showSuccessModal(data.message, shouldReload);
            logDiv.innerHTML = data.message;
        } else {
            showWarningModal(data.message);
            logDiv.innerHTML = translations[currentLang].saveFailed + data.message;
        }
    } catch (error) {
        showWarningModal(translations[currentLang].saveFailed + error.message);
        logDiv.innerHTML = translations[currentLang].saveFailed + error.message;
    }
});
</script>
</body>
</html>
    `);
});

// --- 啟動伺服器 ---
loadConfig().then(() => {
    app.listen(PORT, () => {
        console.log(`RAY Radar 網頁控制面板已啟動，監聽埠口 ${PORT}`);
    });
});