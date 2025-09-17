# Dma_RAY_RADAR_Service

### 專案說明

**Dma_RAY_RADAR_Service** 是一個基於 DMA 軟體 **【RAY】** 的 Web 控制面板。此專案旨在解決在 Linux 環境中運行 Windows `.exe` 應用程式的挑戰。我們利用 **`wine`** 技術，成功地將 `RAY_DELTA_RADAR.exe` 雷達程式無縫整合到 Linux 伺服器中。

專案核心是一個用 Node.js 開發的網頁介面，讓使用者可以透過任何瀏覽器輕鬆地遠端管理服務。這使得啟動、停止服務及查看日誌等操作變得前所未有的簡單，極大地提升了開發與維護的便利性。

---

### 一鍵部署與啟動

為了簡化部署流程，本專案提供了一個自動化腳本 `setup.sh`。只需一個指令，即可完成所有環境配置、程式碼下載和服務啟動的工作。

在 Linux 終端機中執行以下指令即可：

```bash
curl -fsSL [https://raw.githubusercontent.com/nicole27313864/Dma_RAY_RADAR_Service/main/setup.sh](https://raw.githubusercontent.com/nicole27313864/Dma_RAY_RADAR_Service/main/setup.sh) | bash
