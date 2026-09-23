import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  fnoAuth: {
    login: (conn: unknown) => ipcRenderer.invoke('fno:auth:login', conn),
    silent: (conn: unknown) => ipcRenderer.invoke('fno:auth:silent', conn),
    account: (conn: unknown) => ipcRenderer.invoke('fno:auth:account', conn),
    logout: (conn: unknown) => ipcRenderer.invoke('fno:auth:logout', conn),
  },
  fnoRequest: (payload: unknown) => ipcRenderer.invoke('fno:request', payload),
  // Cancels the in-flight `fnoRequest` carrying the same `requestId`.
  fnoAbort: (requestId: string) => ipcRenderer.send('fno:abort', requestId),
});
