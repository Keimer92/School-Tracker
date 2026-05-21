import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { ConfirmDialog } from './ConfirmDialog';
import { openUrl } from '@tauri-apps/plugin-opener';

const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
const DESKTOP_REDIRECT_URI = 'http://localhost:51733/callback';
const ANDROID_REDIRECT_URI = 'http://127.0.0.1/callback';

export interface GoogleDriveSettings {
    clientId: string;
    backupEnabled: boolean;
    backupInterval: number;
    lastBackupTime: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiry: number | null;
    deviceName: string;
    googleUserEmail: string | null;
    googleUserName: string | null;
    googleUserProfilePic: string | null;
}

export interface GoogleDriveFile {
    id: string;
    name: string;
    size: number;
    createdTime: string;
    device: string;
}

const STORAGE_KEY = 'schooltracker-google-drive-settings';
const CACHE_KEY = 'schooltracker-google-drive-backups-cache';

export const GoogleDriveBackup: React.FC = () => {
    const [settings, setSettings] = useState<GoogleDriveSettings>({
        clientId: DEFAULT_CLIENT_ID,
        backupEnabled: false,
        backupInterval: 12,
        lastBackupTime: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
        deviceName: 'PC Principal',
        googleUserEmail: null,
        googleUserName: null,
        googleUserProfilePic: null,
    });

    const [authCode, setAuthCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [driveFiles, setDriveFiles] = useState<GoogleDriveFile[]>([]);
    const [isFetchingFiles, setIsFetchingFiles] = useState(false);
    const [backupProgress, setBackupProgress] = useState<'idle' | 'backing_up' | 'uploading' | 'done'>('idle');
    const [progressBytes, setProgressBytes] = useState({ loaded: 0, total: 0 });
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        variant: 'danger' | 'warning' | 'info';
        onConfirm: () => void;
    }>({ isOpen: false, title: '', message: '', variant: 'danger', onConfirm: () => {} });

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setSettings(prev => ({
                    ...prev,
                    ...parsed,
                    clientId: parsed.clientId || DEFAULT_CLIENT_ID,
                    backupInterval: parsed.backupInterval || 12,
                    deviceName: parsed.deviceName || 'PC Principal'
                }));
            } catch (e) {
                console.error('Failed to parse Google Drive settings:', e);
            }
        }
    }, []);

    const saveSettings = (newSettings: GoogleDriveSettings) => {
        setSettings(newSettings);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
    };

    const refreshAccessTokenIfNeeded = useCallback(async (currentSettings: GoogleDriveSettings): Promise<string | null> => {
        if (!currentSettings.refreshToken) return null;
        
        const now = Date.now();
        if (currentSettings.accessToken && currentSettings.tokenExpiry && currentSettings.tokenExpiry > now + 120000) {
            return currentSettings.accessToken;
        }

        console.log('GD_BACKUP: Access token expired. Refreshing...');
        setIsRefreshing(true);
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: currentSettings.clientId,
                    client_secret: DEFAULT_CLIENT_SECRET,
                    refresh_token: currentSettings.refreshToken,
                    grant_type: 'refresh_token',
                }),
            });

            if (!response.ok) throw new Error(`Refresh token failed: ${response.statusText}`);

            const data = await response.json();
            const updated = {
                ...currentSettings,
                accessToken: data.access_token,
                tokenExpiry: Date.now() + (data.expires_in * 1000),
            };
            
            if (data.refresh_token) updated.refreshToken = data.refresh_token;

            saveSettings(updated);
            return data.access_token;
        } catch (e) {
            console.error('GD_BACKUP: Failed to refresh access token:', e);
            emit("show-toast", { message: "Sesión de Google Drive expirada. Vuelve a vincular tu cuenta.", type: "error" });
            return null;
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    const fetchGoogleUserInfo = async (token: string) => {
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                return {
                    email: data.email || null,
                    name: data.name || null,
                    picture: data.picture || null,
                };
            }
        } catch (e) {
            console.error('Failed to fetch user info:', e);
        }
        return null;
    };

    const completeConnectWithCode = async (codeToUse: string) => {
        setIsLoading(true);
        const isAndroid = /Android/i.test(navigator.userAgent);
        const redirectUri = isAndroid ? ANDROID_REDIRECT_URI : DESKTOP_REDIRECT_URI;
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code: codeToUse.trim(),
                    client_id: settings.clientId,
                    client_secret: DEFAULT_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error_description || `OAuth error: ${response.statusText}`);
            }

            const data = await response.json();
            const profile = await fetchGoogleUserInfo(data.access_token);

            const updatedSettings: GoogleDriveSettings = {
                ...settings,
                accessToken: data.access_token,
                refreshToken: data.refresh_token || settings.refreshToken,
                tokenExpiry: Date.now() + (data.expires_in * 1000),
                googleUserEmail: profile?.email || 'Cuenta de Google',
                googleUserName: profile?.name || 'Usuario School Tracker',
                googleUserProfilePic: profile?.picture || null,
            };

            saveSettings(updatedSettings);
            emit("show-toast", { message: "¡Cuenta de Google Drive vinculada exitosamente!", type: "success" });
            setAuthCode('');
            fetchDriveBackups(updatedSettings);
        } catch (e: any) {
            console.error('OAuth complete failed:', e);
            emit("show-toast", { message: `Error al vincular cuenta: ${e.message || e}`, type: "error" });
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleConnect = async () => {
        setIsLoading(true);
        
        const isAndroid = /Android/i.test(navigator.userAgent);
        const redirectUri = isAndroid ? ANDROID_REDIRECT_URI : DESKTOP_REDIRECT_URI;
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${settings.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=https://www.googleapis.com/auth/drive.file%20https://www.googleapis.com/auth/userinfo.email%20https://www.googleapis.com/auth/userinfo.profile&access_type=offline&prompt=consent`;
        
        if (isAndroid) {
            try {
                await openUrl(authUrl);
                const unlisten = await listen<string>('oauth-callback-android', (event) => {
                    unlisten();
                    completeConnectWithCode(event.payload);
                });
            } catch (e) {
                emit("show-toast", { message: `Error al abrir navegador: ${e}`, type: "error" });
                setIsLoading(false);
            }
        } else {
            emit("show-toast", { message: "Esperando autorización en el navegador...", type: "info" });
            const serverPromise = invoke<string>('gd_start_oauth_server', { port: 51733 });
            try {
                await invoke('gd_open_url_browser', { url: authUrl });
            } catch (e) {
                window.open(authUrl, '_blank');
            }
            try {
                const capturedCode = await serverPromise;
                await completeConnectWithCode(capturedCode);
            } catch (error: any) {
                emit("show-toast", { message: `Vínculo automático cancelado: ${error}`, type: "error" });
                setIsLoading(false);
            }
        }
    };

    const handleCompleteConnect = async () => {
        if (!authCode.trim()) {
            emit("show-toast", { message: 'Por favor ingresa el código de autorización.', type: "warning" });
            return;
        }
        await completeConnectWithCode(authCode);
    };

    const handleGoogleDisconnect = () => {
        setConfirmDialog({
            isOpen: true,
            title: 'Desvincular Cuenta',
            message: '¿Estás seguro de que deseas desvincular tu cuenta de Google Drive? Se perderá la conexión automática de respaldos.',
            variant: 'warning',
            onConfirm: () => {
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                const cleared: GoogleDriveSettings = {
                    clientId: DEFAULT_CLIENT_ID,
                    backupEnabled: false,
                    backupInterval: 12,
                    lastBackupTime: null,
                    accessToken: null,
                    refreshToken: null,
                    tokenExpiry: null,
                    deviceName: settings.deviceName,
                    googleUserEmail: null,
                    googleUserName: null,
                    googleUserProfilePic: null,
                };
                saveSettings(cleared);
                setDriveFiles([]);
                emit("show-toast", { message: 'Cuenta desvinculada correctamente.', type: "success" });
            },
        });
    };

    const getOrCreateBackupFolder = async (token: string): Promise<string> => {
        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name%3D%27SchoolTracker%20Backups%27%20and%20mimeType%3D%27application%2Fvnd.google-apps.folder%27%20and%20trashed%3Dfalse`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const data = await searchResponse.json();
        if (data.files && data.files.length > 0) return data.files[0].id;

        const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: 'SchoolTracker Backups',
                mimeType: 'application/vnd.google-apps.folder',
            }),
        });

        const folder = await createResponse.json();
        return folder.id;
    };

    const fetchDriveBackups = async (currentSettings = settings) => {
        const token = await refreshAccessTokenIfNeeded(currentSettings);
        if (!token) return;

        setIsFetchingFiles(true);
        try {
            const folderId = await getOrCreateBackupFolder(token);
            
            const listResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27%20in%20parents%20and%20trashed%3Dfalse&fields=files(id,name,size,createdTime,description)&orderBy=createdTime%20desc`,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const data = await listResponse.json();
            const list: GoogleDriveFile[] = (data.files || []).map((f: any) => {
                let dev = 'Dispositivo Desconocido';
                try {
                    if (f.description) {
                        const parsed = JSON.parse(f.description);
                        dev = parsed.device || dev;
                    }
                } catch (_) {}
                return {
                    id: f.id,
                    name: f.name,
                    size: parseInt(f.size || '0'),
                    createdTime: f.createdTime,
                    device: dev
                };
            });

            setDriveFiles(list);
            localStorage.setItem(CACHE_KEY, JSON.stringify(list));
        } catch (e: any) {
            console.error('GD_BACKUP: Failed to load drive files:', e);
        } finally {
            setIsFetchingFiles(false);
        }
    };

    const handleBackupNow = async () => {
        const token = await refreshAccessTokenIfNeeded(settings);
        if (!token) return;

        setIsTesting(true);
        setBackupProgress('backing_up');
        emit("show-toast", { message: 'Creando copia de seguridad local...', type: "info" });
        
        try {
            const localBackupPath = await invoke<string>('gd_create_backup');

            setBackupProgress('uploading');
            emit("show-toast", { message: 'Cargando base de datos a Google Drive...', type: "info" });

            const dbBase64 = await invoke<string>('gd_read_file_base64', { path: localBackupPath });
            const folderId = await getOrCreateBackupFolder(token);

            const timestampStr = new Date().toISOString();
            const cleanDate = timestampStr.split('T')[0];
            const cleanTime = timestampStr.split('T')[1].slice(0, 8).replace(/:/g, '-');
            
            const metadata = {
                name: `SchoolTracker_Backup_${settings.deviceName.replace(/\s+/g, '_')}_${cleanDate}_${cleanTime}.db`,
                parents: [folderId],
                description: JSON.stringify({
                    device: settings.deviceName,
                    timestamp: timestampStr,
                    type: 'schooltracker_backup'
                })
            };

            const boundary = 'schooltracker_backup_boundary';
            const multipartBody = 
                `--${boundary}\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${JSON.stringify(metadata)}\r\n` +
                `--${boundary}\r\n` +
                `Content-Type: application/octet-stream\r\n` +
                `Content-Transfer-Encoding: base64\r\n\r\n` +
                `${dbBase64}\r\n` +
                `--${boundary}--`;

            setBackupProgress('uploading');
            const uploadResponse = await new Promise<{ ok: boolean; statusText: string }>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
                
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setProgressBytes({ loaded: event.loaded, total: event.total });
                        const loadedMB = (event.loaded / (1024 * 1024)).toFixed(2);
                        const totalMB = (event.total / (1024 * 1024)).toFixed(2);
                        const pct = Math.round((event.loaded / event.total) * 100);
                        emit("show-toast", { message: `Subiendo: ${loadedMB} MB / ${totalMB} MB (${pct}%)`, type: "info" });
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve({ ok: true, statusText: xhr.statusText });
                    } else {
                        resolve({ ok: false, statusText: xhr.responseText || xhr.statusText });
                    }
                };

                xhr.onerror = () => reject(new Error('Network error during upload'));
                xhr.send(multipartBody);
            });

            if (!uploadResponse.ok) throw new Error(`Upload error: ${uploadResponse.statusText}`);

            try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}

            await pruneOldGoogleDriveBackups(token, folderId);

            const updatedSettings = { ...settings, lastBackupTime: timestampStr };
            saveSettings(updatedSettings);
            
            emit("show-toast", { message: '¡Copia de seguridad subida exitosamente a Google Drive!', type: "success" });
            setBackupProgress('done');
            fetchDriveBackups(updatedSettings);
        } catch (e: any) {
            console.error('GD_BACKUP: Failed to complete manual backup:', e);
            emit("show-toast", { message: `Error al respaldar: ${e.message || e}`, type: "error" });
        } finally {
            setIsTesting(false);
            setBackupProgress('idle');
        }
    };

    const handleRestoreBackup = async (file: GoogleDriveFile) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Restaurar Respaldo',
            message: `¿Estás seguro de que deseas restaurar el respaldo del dispositivo "${file.device}" creado el ${new Date(file.createdTime).toLocaleString()}?\n\nEsto reemplazará COMPLETAMENTE tu base de datos actual.`,
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                await executeRestoreBackup(file);
            },
        });
    };

    const executeRestoreBackup = async (file: GoogleDriveFile) => {
        const token = await refreshAccessTokenIfNeeded(settings);
        if (!token) return;

        setIsTesting(true);
        emit("show-toast", { message: 'Descargando archivo de Google Drive...', type: "info" });

        try {
            const downloadResult = await new Promise<{ ok: boolean; statusText: string; arrayBuffer: ArrayBuffer }>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.responseType = 'arraybuffer';
                
                xhr.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setProgressBytes({ loaded: event.loaded, total: event.total });
                        const loadedMB = (event.loaded / (1024 * 1024)).toFixed(2);
                        const totalMB = (event.total / (1024 * 1024)).toFixed(2);
                        const pct = Math.round((event.loaded / event.total) * 100);
                        emit("show-toast", { message: `Descargando: ${loadedMB} MB / ${totalMB} MB (${pct}%)`, type: "info" });
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve({ ok: true, statusText: xhr.statusText, arrayBuffer: xhr.response as ArrayBuffer });
                    } else {
                        resolve({ ok: false, statusText: xhr.statusText, arrayBuffer: new ArrayBuffer(0) });
                    }
                };

                xhr.onerror = () => reject(new Error('Network error during download'));
                xhr.send();
            });

            if (!downloadResult.ok) throw new Error(`Download failed: ${downloadResult.statusText}`);

            const arrayBuffer = downloadResult.arrayBuffer;
            let binary = '';
            const bytes = new Uint8Array(arrayBuffer);
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
            const base64Str = window.btoa(binary);

            emit("show-toast", { message: 'Guardando copia temporal...', type: "info" });

            const backups = await invoke<any[]>('gd_get_backups');
            let tempRestorePath = 'school_drive_restore.db';
            if (backups.length > 0) {
                const pathParts = backups[0].path.split(/[\\/]/);
                pathParts.pop();
                tempRestorePath = pathParts.join('/') + '/school_drive_restore.db';
            }

            await invoke('gd_write_file_base64', { path: tempRestorePath, contentBase64: base64Str });
            emit("show-toast", { message: 'Restaurando base de datos...', type: "info" });

            await invoke('gd_import_db_from_file', { sourcePath: tempRestorePath });
            try { await invoke('gd_delete_backup', { path: tempRestorePath }); } catch (_) {}

            emit("show-toast", { message: '¡Base de datos restaurada! La aplicación se reiniciará.', type: "success" });
            setTimeout(() => { window.location.reload(); }, 2000);
        } catch (e: any) {
            console.error('GD_BACKUP: Failed to restore backup:', e);
            emit("show-toast", { message: `Error al restaurar: ${e.message || e}`, type: "error" });
        } finally {
            setIsTesting(false);
        }
    };

    const handleDeleteDriveBackup = async (file: GoogleDriveFile) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Eliminar Respaldo',
            message: '¿Eliminar este respaldo de Google Drive? Esta acción no se puede deshacer.',
            variant: 'danger',
            onConfirm: async () => {
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                await executeDeleteDriveBackup(file);
            },
        });
    };

    const executeDeleteDriveBackup = async (file: GoogleDriveFile) => {
        const token = await refreshAccessTokenIfNeeded(settings);
        if (!token) return;

        setIsTesting(true);
        try {
            const deleteResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!deleteResponse.ok) throw new Error(`Delete error: ${deleteResponse.statusText}`);

            emit("show-toast", { message: 'Respaldo eliminado correctamente', type: "success" });
            fetchDriveBackups(settings);
        } catch (e: any) {
            emit("show-toast", { message: `Error al eliminar: ${e.message || e}`, type: "error" });
        } finally {
            setIsTesting(false);
        }
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    useEffect(() => {
        if (settings.accessToken && settings.refreshToken) fetchDriveBackups(settings);
    }, [settings.refreshToken]);

    const isConnected = !!settings.refreshToken;

    return (
        <>
            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                title={confirmDialog.title}
                message={confirmDialog.message}
                variant={confirmDialog.variant}
                onConfirm={confirmDialog.onConfirm}
                onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
            />
            <div style={{ 
            background: 'rgba(30, 41, 59, 0.5)', 
            borderRadius: '16px', 
            border: '1px solid rgba(255, 255, 255, 0.1)',
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{ 
                padding: '1.5rem', 
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ 
                        padding: '0.75rem', 
                        background: 'rgba(99, 102, 241, 0.2)', 
                        borderRadius: '12px',
                        color: '#818cf8'
                    }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z"/>
                        </svg>
                    </div>
                    <div>
                        <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 'bold' }}>Respaldo Automático Google Drive</h3>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>Copia de seguridad automática de tu base de datos SQLite</p>
                    </div>
                </div>
                <div style={{ 
                    padding: '0.4rem 0.8rem', 
                    borderRadius: '9999px',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                    color: isConnected ? '#10b981' : '#64748b',
                    border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`
                }}>
                    <span style={{ 
                        display: 'inline-block', 
                        width: '6px', 
                        height: '6px', 
                        borderRadius: '50%', 
                        background: isConnected ? '#10b981' : '#64748b',
                        marginRight: '6px'
                    }}></span>
                    {isConnected ? 'Conectado' : 'Desconectado'}
                </div>
            </div>

            {/* Main Area */}
            <div style={{ padding: '1.5rem' }}>
                {!isConnected ? (
                    <div style={{ 
                        background: 'rgba(15, 23, 42, 0.4)', 
                        padding: '1.5rem', 
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        maxWidth: '600px',
                        margin: '0 auto'
                    }}>
                        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>☁️</div>
                            <h4 style={{ margin: '0 0 0.5rem 0', color: '#e2e8f0' }}>Vincular cuenta de Google</h4>
                            <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
                                Al conectar tu cuenta, School Tracker Pro podrá subir copias de seguridad a una carpeta segura llamada <strong style={{ color: '#818cf8' }}>SchoolTracker Backups</strong> en tu Google Drive.
                            </p>
                        </div>

                        <button
                            onClick={handleGoogleConnect}
                            disabled={isLoading}
                            style={{ 
                                width: '100%', 
                                padding: '0.85rem', 
                                background: '#6366f1', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: '10px',
                                fontWeight: 'bold',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                opacity: isLoading ? 0.7 : 1,
                                fontSize: '0.95rem'
                            }}
                        >
                            {isLoading ? 'Esperando autorización...' : 'Iniciar Sesión con Google'}
                        </button>

                        <div style={{ 
                            margin: '1.5rem 0', 
                            display: 'flex', 
                            alignItems: 'center',
                            gap: '1rem'
                        }}>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.1)' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>Paso Final</span>
                            <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.1)' }}></div>
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                Código de Autorización
                            </label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    value={authCode}
                                    onChange={(e) => setAuthCode(e.target.value)}
                                    placeholder="Pega el código aquí..."
                                    style={{ 
                                        flex: 1, 
                                        padding: '0.65rem', 
                                        background: 'rgba(15, 23, 42, 0.6)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '8px',
                                        color: '#e2e8f0',
                                        fontSize: '0.85rem'
                                    }}
                                />
                                <button
                                    onClick={handleCompleteConnect}
                                    disabled={isLoading || !authCode.trim()}
                                    style={{ 
                                        padding: '0.65rem 1.25rem', 
                                        background: '#10b981', 
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontWeight: 'bold',
                                        cursor: isLoading || !authCode.trim() ? 'not-allowed' : 'pointer',
                                        opacity: isLoading || !authCode.trim() ? 0.5 : 1,
                                        fontSize: '0.85rem'
                                    }}
                                >
                                    Vincular
                                </button>
                            </div>
                            <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.5rem' }}>
                                Una vez que apruebes el acceso en tu navegador, se te mostrará una pantalla con un código. Cópialo y pégalo arriba.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {/* Connected User */}
                        <div style={{ 
                            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1))',
                            padding: '1.25rem',
                            borderRadius: '16px',
                            border: '1px solid rgba(99, 102, 241, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ 
                                    width: '50px', 
                                    height: '50px', 
                                    borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontSize: '1.5rem',
                                    overflow: 'hidden',
                                    flexShrink: 0
                                }}>
                                    {settings.googleUserProfilePic ? (
                                        <img src={settings.googleUserProfilePic} alt="Google User" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : '👤'}
                                </div>
                                <div>
                                    <p style={{ margin: 0, fontSize: '0.65rem', color: '#818cf8', fontWeight: 'bold', textTransform: 'uppercase' }}>Cuenta Google Vinculada</p>
                                    <h4 style={{ margin: '0.25rem 0 0 0', color: '#f1f5f9', fontSize: '1rem', fontWeight: 'bold' }}>{settings.googleUserName || 'Usuario Google'}</h4>
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>{settings.googleUserEmail}</p>
                                </div>
                            </div>
                            <button
                                onClick={handleGoogleDisconnect}
                                style={{ 
                                    padding: '0.5rem 1rem', 
                                    background: 'rgba(239, 68, 68, 0.1)', 
                                    color: '#ef4444',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: '8px',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                }}
                            >
                                Desvincular Cuenta
                            </button>
                        </div>

                        {/* Config & Manual Backup */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                            {/* Automatic Settings */}
                            <div style={{ 
                                background: 'rgba(15, 23, 42, 0.4)',
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.05)'
                            }}>
                                <h4 style={{ margin: '0 0 1rem 0', color: '#e2e8f0', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span>⚙️</span> Automatización
                                </h4>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '1rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={settings.backupEnabled}
                                        onChange={(e) => saveSettings({ ...settings, backupEnabled: e.target.checked })}
                                        style={{ width: '18px', height: '18px', accentColor: '#6366f1' }}
                                    />
                                    <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>Respaldo Automático Activo</span>
                                </label>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.35rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Frecuencia (Horas)</label>
                                        <select
                                            value={settings.backupInterval}
                                            disabled={!settings.backupEnabled}
                                            onChange={(e) => saveSettings({ ...settings, backupInterval: parseInt(e.target.value) })}
                                            style={{ 
                                                width: '100%', 
                                                padding: '0.5rem', 
                                                background: 'rgba(15, 23, 42, 0.6)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '6px',
                                                color: '#e2e8f0',
                                                fontSize: '0.8rem',
                                                opacity: settings.backupEnabled ? 1 : 0.5
                                            }}
                                        >
                                            <option value={1}>Cada 1 hora</option>
                                            <option value={6}>Cada 6 horas</option>
                                            <option value={12}>Cada 12 horas</option>
                                            <option value={24}>Cada 24 horas</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.35rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Nombre de Equipo</label>
                                        <input
                                            type="text"
                                            value={settings.deviceName}
                                            onChange={(e) => saveSettings({ ...settings, deviceName: e.target.value })}
                                            placeholder="Ej: PC Principal"
                                            style={{ 
                                                width: '100%', 
                                                padding: '0.5rem', 
                                                background: 'rgba(15, 23, 42, 0.6)',
                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                borderRadius: '6px',
                                                color: '#e2e8f0',
                                                fontSize: '0.8rem',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Manual Backup */}
                            <div style={{ 
                                background: 'rgba(15, 23, 42, 0.4)',
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between'
                            }}>
                                <div>
                                    <h4 style={{ margin: '0 0 1rem 0', color: '#e2e8f0', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span>🚀</span> Respaldar Ahora
                                    </h4>
                                    <div style={{ marginBottom: '0.5rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                                            <span style={{ color: '#94a3b8' }}>Último respaldo:</span>
                                            <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>
                                                {settings.lastBackupTime ? new Date(settings.lastBackupTime).toLocaleString('es-ES') : 'Nunca'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                            <span style={{ color: '#94a3b8' }}>Ubicación:</span>
                                            <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>/SchoolTracker Backups/</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={handleBackupNow}
                                    disabled={isTesting}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.75rem', 
                                        background: '#6366f1', 
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontWeight: 'bold',
                                        cursor: isTesting ? 'not-allowed' : 'pointer',
                                        opacity: isTesting ? 0.7 : 1,
                                        fontSize: '0.85rem',
                                        marginTop: '0.75rem'
                                    }}
                                >
                                    {isTesting ? 'Procesando...' : 'Subir Respaldo Manual'}
                                </button>
                            </div>
                        </div>

                        {/* List of Backups */}
                        <div style={{ 
                            background: 'rgba(15, 23, 42, 0.4)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            overflow: 'hidden'
                        }}>
                            <div style={{ 
                                padding: '0.85rem 1rem', 
                                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                background: 'rgba(255, 255, 255, 0.02)'
                            }}>
                                <h4 style={{ margin: 0, color: '#e2e8f0', fontSize: '0.8rem', fontWeight: 'bold' }}>Copias en Google Drive</h4>
                                <button
                                    onClick={() => fetchDriveBackups(settings)}
                                    disabled={isFetchingFiles}
                                    style={{ 
                                        background: 'transparent', 
                                        border: 'none', 
                                        color: '#94a3b8', 
                                        cursor: isFetchingFiles ? 'not-allowed' : 'pointer',
                                        padding: '0.35rem',
                                        opacity: isFetchingFiles ? 0.5 : 1
                                    }}
                                    title="Refrescar"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isFetchingFiles ? 'animate-spin' : ''}>
                                        <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                                    </svg>
                                </button>
                            </div>

                            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                {isFetchingFiles && driveFiles.length === 0 ? (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                        <p style={{ fontSize: '0.8rem' }}>Buscando respaldos...</p>
                                    </div>
                                ) : driveFiles.length > 0 ? (
                                    driveFiles.map(file => (
                                        <div key={file.id} style={{ 
                                            padding: '0.85rem 1rem', 
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            gap: '1rem'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                                                <div style={{ 
                                                    width: '36px', 
                                                    height: '36px', 
                                                    borderRadius: '8px',
                                                    background: 'rgba(99, 102, 241, 0.1)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: '#818cf8',
                                                    flexShrink: 0
                                                }}>
                                                    💾
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <h5 style={{ margin: 0, color: '#e2e8f0', fontSize: '0.8rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {file.name}
                                                    </h5>
                                                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.15rem' }}>
                                                        {file.device} • {new Date(file.createdTime).toLocaleString()} • {formatBytes(file.size)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                                <button
                                                    onClick={() => handleRestoreBackup(file)}
                                                    style={{ 
                                                        padding: '0.4rem 0.75rem', 
                                                        background: '#10b981', 
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        fontSize: '0.7rem',
                                                        fontWeight: 'bold',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Restaurar
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteDriveBackup(file)}
                                                    style={{ 
                                                        padding: '0.4rem', 
                                                        background: 'rgba(239, 68, 68, 0.1)', 
                                                        color: '#ef4444',
                                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer'
                                                    }}
                                                    title="Eliminar"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                        <p style={{ fontSize: '0.8rem' }}>No se encontraron respaldos en /SchoolTracker Backups/</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Info */}
            <div style={{ 
                padding: '0.75rem 1rem', 
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(15, 23, 42, 0.3)'
            }}>
                <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>
                    Cifrado e Integridad Garantizada
                </span>
                <span style={{ fontSize: '0.65rem', color: '#475569', fontStyle: 'italic' }}>Google Drive API v3</span>
            </div>
        </div>
        </>
    );
};

export const pruneOldGoogleDriveBackups = async (token: string, folderId: string) => {
    try {
        const listResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27%20in%20parents%20and%20trashed%3Dfalse&fields=files(id,name,createdTime)&orderBy=createdTime%20desc`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const data = await listResponse.json();
        const files = data.files || [];
        
        if (files.length > 3) {
            const filesToDelete = files.slice(3);
            for (const file of filesToDelete) {
                await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
        }
    } catch (e) {
        console.error('GD_BACKUP: Error during old backups pruning:', e);
    }
};

export const runAutomaticGoogleDriveBackupIfNeeded = async () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;

        const settings: GoogleDriveSettings = JSON.parse(stored);
        
        if (!settings.backupEnabled || !settings.refreshToken || !settings.accessToken) return;

        if (settings.lastBackupTime) {
            const lastBackup = new Date(settings.lastBackupTime).getTime();
            const now = Date.now();
            const intervalMs = settings.backupInterval * 60 * 60 * 1000;
            
            if (now - lastBackup < intervalMs) return;
        }

        console.log('GD_BACKUP: Running automatic backup...');

        // Refresh token
        const token = await (async () => {
            const now = Date.now();
            if (settings.accessToken && settings.tokenExpiry && settings.tokenExpiry > now + 120000) {
                return settings.accessToken;
            }

            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: settings.clientId,
                    client_secret: DEFAULT_CLIENT_SECRET,
                    refresh_token: settings.refreshToken!,
                    grant_type: 'refresh_token',
                }),
            });

            if (!response.ok) return null;
            const data = await response.json();
            const updated = { ...settings, accessToken: data.access_token, tokenExpiry: Date.now() + (data.expires_in * 1000) };
            if (data.refresh_token) updated.refreshToken = data.refresh_token;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            return data.access_token;
        })();

        if (!token) return;

        // Create backup
        const localBackupPath = await invoke<string>('gd_create_backup');
        const dbBase64 = await invoke<string>('gd_read_file_base64', { path: localBackupPath });

        // Get folder
        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name%3D%27SchoolTracker%20Backups%27%20and%20mimeType%3D%27application%2Fvnd.google-apps.folder%27%20and%20trashed%3Dfalse`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const searchData = await searchResponse.json();
        let folderId: string;
        
        if (searchData.files && searchData.files.length > 0) {
            folderId = searchData.files[0].id;
        } else {
            const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'SchoolTracker Backups', mimeType: 'application/vnd.google-apps.folder' }),
            });
            const folder = await createResponse.json();
            folderId = folder.id;
        }

        // Upload
        const timestampStr = new Date().toISOString();
        const cleanDate = timestampStr.split('T')[0];
        const cleanTime = timestampStr.split('T')[1].slice(0, 8).replace(/:/g, '-');
        
        const metadata = {
            name: `SchoolTracker_Backup_${settings.deviceName.replace(/\s+/g, '_')}_${cleanDate}_${cleanTime}.db`,
            parents: [folderId],
            description: JSON.stringify({ device: settings.deviceName, timestamp: timestampStr, type: 'schooltracker_backup' })
        };

        const boundary = 'schooltracker_backup_boundary';
        const multipartBody = 
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: application/octet-stream\r\n` +
            `Content-Transfer-Encoding: base64\r\n\r\n` +
            `${dbBase64}\r\n` +
            `--${boundary}--`;

        await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.statusText));
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(multipartBody);
        });

        try { await invoke('gd_delete_backup', { path: localBackupPath }); } catch (_) {}
        await pruneOldGoogleDriveBackups(token, folderId);

        const updated = { ...settings, lastBackupTime: timestampStr };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        console.log('GD_BACKUP: Automatic backup completed');
    } catch (e) {
        console.error('GD_BACKUP: Automatic backup failed:', e);
    }
};
