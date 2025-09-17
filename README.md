### 專案說明

**Dma_RAY_RADAR_Service** 是一個網頁控制面板服務，用於在 Linux 環境中管理和控制 `RAY_DELTA_RADAR.exe` 應用程式。此專案巧妙地利用 `wine` 技術，將原本為 Windows 設計的執行檔無縫整合到 Linux 伺服器中，並提供一個基於 Node.js 的網頁介面。使用者可以透過瀏覽器輕鬆地啟動、停止服務，並查看運行日誌，實現高效的遠端管理。

---

### 一鍵部署與啟動

為了簡化部署流程，本專案提供了一個自動化腳本 `setup.sh`。只需一個指令，即可完成所有環境配置、程式碼下載和服務啟動的工作。

在 Linux 終端機中執行以下指令即可：

```bash
curl -fsSL [https://raw.githubusercontent.com/nicole27313864/Dma_RAY_RADAR_Service/main/setup.sh](https://raw.githubusercontent.com/nicole27313864/Dma_RAY_RADAR_Service/main/setup.sh) | bash
