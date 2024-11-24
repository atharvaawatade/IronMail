// background.js
let ports = new Set();

chrome.runtime.onInstalled.addListener(() => {
    console.log("IRON SECURITY Extension Installed");
    
    // Request necessary permissions early
    chrome.permissions.request({
        permissions: ['tabs', 'activeTab', 'desktopCapture']
    });
});

// Handle screenshot capture
async function captureScreen(streamId) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            }
        });
        
        const track = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);
        const bitmap = await imageCapture.grabFrame();
        
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        
        const blob = await canvas.convertToBlob();
        const reader = new FileReader();
        
        return new Promise((resolve, reject) => {
            reader.onloadend = () => {
                track.stop();
                stream.getTracks().forEach(track => track.stop());
                resolve(reader.result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Screen capture error:', error);
        throw error;
    }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "requestScreenshot") {
        chrome.desktopCapture.chooseDesktopMedia(
            ['screen', 'window', 'tab'],
            sender.tab,
            async (streamId) => {
                if (!streamId) {
                    sendResponse({ error: 'Permission denied or no source selected' });
                    return;
                }
                
                try {
                    const screenshot = await captureScreen(streamId);
                    sendResponse({ screenshot });
                } catch (error) {
                    sendResponse({ error: error.message });
                }
            }
        );
        return true; // Required for async response
    }
    
    if (message.action === "requestPermissions") {
        chrome.permissions.request({
            permissions: ['tabs', 'activeTab', 'desktopCapture']
        }, (granted) => {
            sendResponse({ granted });
        });
        return true;
    }
    
    if (message.action === "keepAlive") {
        sendResponse({ status: "alive" });
        return true;
    }
});

// Long-lived connection handling
chrome.runtime.onConnect.addListener((port) => {
    ports.add(port);
    
    port.onDisconnect.addListener(() => {
        ports.delete(port);
    });
});

// Keep service worker active
const keepAlive = () => {
    for (const port of ports) {
        port.postMessage({ type: "ping" });
    }
    setTimeout(keepAlive, 20000);
};
keepAlive();