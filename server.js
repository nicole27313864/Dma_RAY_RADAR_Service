const express = require('express');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs/promises');
const iconv = require('iconv-lite');
const OpenCC = require('opencc-js');

const app = express();
app.use(express.urlencoded({ extended: true }));

// 定義常數
const RADAR_EXE_PATH = '/root/Dma_RAY_RADAR_Service/RAY_DELTA_RADAR.exe';
const LOG_FILE = '/root/Dma_RAY_RADAR_Service/radar.log'; // 建議將日誌檔也放在專案目錄下
const PORT = 3000;
const ADMIN_PASS = 'admin666';
const APP_PORT = '8080';

// 簡繁體轉換工具
const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

/**
 * 處理啟動、停止、查看狀態的指令
 */
const handleRadarAction = async (req, res) => {
    const { action } = req.params;

    try {
        if (action === 'start') {
            //const command = `nohup wine "${RADAR_EXE_PATH}" >/dev/null 2>&1 &`;
			const command = `nohup bash -c "echo -e \\"${ADMIN_PASS}\\n${APP_PORT}\\" | wine \\"${RADAR_EXE_PATH}\\"" > ${LOG_FILE} 2>&1 &`;
            await exec(command);
            res.send(`<h3>Radar 已啟動</h3><pre>後台進程已成功啟動。</pre>`);
        } else if (action === 'stop') {
            try {
                // 嘗試終止進程
                await exec(`pkill -f "RAY_DELTA_RADAR.exe"`);
                res.send(`<h3>Radar 已停止</h3><pre>進程已成功終止。</pre>`);
            } catch (error) {
                // 如果 pkill 失敗，回傳成功停止的訊息，因為最終目的已達成
                res.send(`<h3>Radar 已停止</h3><pre>停止指令已完成。</pre>`);
            } finally {
                // **修正：無論 pkill 成功或失敗，都保證日誌被清空**
                await fs.writeFile(LOG_FILE, '', 'utf8');
            }
        } else if (action === 'status') {
			try {
				const { stdout } = await exec(`ps aux | grep "RAY_DELTA_RADAR.exe" | grep -v "grep"`);
				// 檢查 stdout 是否有任何內容
				// 如果 stdout.trim() 是空字串，表示沒有找到程序
				if (stdout.trim() === '') {
					// 如果 stdout 為空，進入未運行狀態
					res.send(`<h3>Radar 狀態: 未運行</h3><pre>沒有找到相關進程。</pre>`);
				} else {
					// 如果 stdout 有內容，表示找到程序並顯示 PID
					res.send(`<h3>Radar 狀態: 運行中</h3>`);
				}
			} catch (error) {
				// 萬一執行命令時真的發生了其他錯誤，仍然進入 catch 區塊
				res.send(`<h3>Radar 狀態: 未運行</h3><pre>執行命令時發生錯誤，或沒有找到相關進程。</pre>`);
			}
        } else {
            res.send(`<h3>未知指令: ${action}</h3>`);
        }
    } catch (error) {
        // 捕獲並顯示執行命令時的錯誤
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
        res.send(`讀取 log 失敗: ${err.message}`);
    }
};

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
    --thumb-color: #fff;
    --scrollbar-thumb: #5b6e82;
    --scrollbar-track: #2a3847;
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
.controls { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; margin-bottom: 20px; gap: 10px; }
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
button:hover { background-color: var(--button-hover-bg); transform: translateY(-2px); }

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
</style>
</head>
<body>
<div class="container">
    <h1>RAY Radar 控制面板</h1>
    <div class="controls">
        <button onclick="controlRadar('start')">啟動 Radar</button>
        <button onclick="controlRadar('stop')">停止 Radar</button>
        <button onclick="controlRadar('status')">查看狀態</button>
        <div class="select-wrapper">
            <select id="lang" onchange="viewLog()">
                <option value="zh-cn">簡體</option>
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
            <h2>日誌輸出</h2>
        </div>
        <div id="log">正在載入 log...</div>
    </div>
</div>

<script>
function controlRadar(action) {
    fetch('/radar/' + action, { method: 'POST' })
        .then(r => r.text())
        .then(html => document.getElementById('log').innerHTML = html)
        .catch(err => document.getElementById('log').innerHTML = '錯誤：' + err);
}

function viewLog() {
    const lang = document.getElementById('lang').value;
    fetch('/radar/log?lang=' + lang)
        .then(r => r.text())
        .then(html => {
            const logDiv = document.getElementById('log');
            logDiv.innerHTML = html;
            logDiv.scrollTop = logDiv.scrollHeight;
        });
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
setupThemeToggle();

setInterval(viewLog, 5000);
</script>
</body>
</html>
    `);
});

// --- API 路由 ---
app.post('/radar/:action', handleRadarAction);
app.get('/radar/log', getRadarLog);

// --- 啟動伺服器 ---
app.listen(PORT, () => {
    console.log(`RAY Radar 網頁控制面板已啟動，監聽埠口 ${PORT}`);
});