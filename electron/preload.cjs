const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  sidecarPort: ipcRenderer.sendSync('sidecar-port'),
  saveFile: (text, name) => ipcRenderer.invoke('save-file', { text, name }),
});
