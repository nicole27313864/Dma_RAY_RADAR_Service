#!/bin/bash

# 腳本說明：自動化部署 RAY Radar 服務

# 1. 更新系統並安裝必要工具
echo "更新系統並安裝 git..."
sudo apt-get update
sudo apt-get install -y git

# 2. 安裝 Node.js 與 npm
echo "安裝 Node.js..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. 安裝 PM2
echo "全域安裝 PM2..."
sudo npm install -g pm2

# 4. 下載程式碼
echo "複製 GitHub 儲存庫..."
git clone https://github.com/nicole27313864/Dma_RAY_RADAR_Service.git

# 5. 進入專案目錄
cd Dma_RAY_RADAR_Service

# 6. 安裝 Node.js 依賴套件
echo "安裝 Node.js 依賴..."
npm install

# 7. 啟動服務並設定自動啟動
echo "使用 PM2 啟動服務並設定開機自動啟動..."
pm2 start server.js --name "radar-panel"
pm2 save

echo "-------------------------------------"
echo "部署完成！服務已啟動並設定為自動啟動。"
echo "您現在可以透過網頁瀏覽器存取控制面板。"
