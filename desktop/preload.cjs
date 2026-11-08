const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('obentoDesktop', {
  revealFile(file) {
    const filePath = webUtils.getPathForFile(file);
    return filePath ? ipcRenderer.invoke('reveal-video-file', filePath) : false;
  },
});
