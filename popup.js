//popup.js
let chatSocket = null;
let currentImageData = null;

document.addEventListener('DOMContentLoaded', () => {
    const screenshotBtn = document.getElementById('screenshot-btn');
    const chatBtn = document.getElementById('chat-btn');
    const closeBtn = document.getElementById('close-btn');
    const chatContainer = document.getElementById('chat-container');
    const statusDiv = document.getElementById('status');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send');
    const chatMessages = document.getElementById('chat-messages');
    const uploadBtn = document.getElementById('upload-btn');
    const imageUpload = document.getElementById('image-upload');
    const permissionDialog = document.getElementById('permission-dialog');
    const allowPermissionBtn = document.getElementById('allow-permission');
    const denyPermissionBtn = document.getElementById('deny-permission');
    const analysisResult = document.getElementById('analysis-result');

    const initWebSocket = () => {
        chatSocket = new WebSocket('ws://localhost:8000/chat');

        chatSocket.onopen = () => updateStatus('Chat connected', 'success');

        chatSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data); 
                if (data.message) {
                    appendMessage('ai', data.message);
                } else {
                    appendMessage('ai', JSON.stringify(data)); 
                }
            } catch (error) {
                appendMessage('ai', event.data);
            }
        };
        

        chatSocket.onerror = () => updateStatus('Chat connection error', 'error');

        chatSocket.onclose = () => updateStatus('Chat disconnected', 'warning');
    };

    const updateStatus = (message, type = 'info') => {
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = `${icons[type]} ${message}`;
        statusDiv.style.backgroundColor = type === 'error' ? '#ffe6e6' : '#f8f9fa';
    };

    const appendMessage = (type, content) => {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${type}-message`);

        if (content.includes('data:image')) {
            const img = document.createElement('img');
            img.src = content;
            img.classList.add('image-preview');
            messageDiv.appendChild(img);
        } else {
            messageDiv.textContent = content;
        }

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    const handleScreenshot = async () => {
        try {
            screenshotBtn.disabled = true;
            updateStatus('Requesting permission...', 'info');

            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const video = document.createElement('video');
            video.srcObject = stream;

            await video.play();

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            stream.getTracks().forEach(track => track.stop());

            const base64Data = canvas.toDataURL('image/png');
            appendMessage('user', 'Screenshot taken.');
            appendMessage('user', base64Data);

            const response = await fetch('http://localhost:8000/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data })
            });

            if (!response.ok) throw new Error('Analysis failed');

            const result = await response.json();

            analysisResult.style.display = 'block';
            analysisResult.querySelector('.verdict').textContent = result.verdict;

            const explanationDiv = analysisResult.querySelector('.explanation');
            explanationDiv.innerHTML = '';
            result.explanation.forEach(point => {
                const pointDiv = document.createElement('div');
                pointDiv.textContent = point;
                explanationDiv.appendChild(pointDiv);
            });

            updateStatus('Analysis complete', 'success');
        } catch (error) {
            updateStatus(`Error: ${error.message}`, 'error');
        } finally {
            screenshotBtn.disabled = false;
        }
    };

    const handleImageUpload = () => imageUpload.click();

    const processUploadedImage = (file) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            currentImageData = e.target.result;
            appendMessage('user', 'Image uploaded.');
            appendMessage('user', currentImageData);
        };
        reader.readAsDataURL(file);
    };

    const sendMessage = () => {
        const message = chatInput.value.trim();
        if (!message && !currentImageData) return;

        appendMessage('user', message || 'Image sent.');

        const payload = { message, image: currentImageData };
        if (chatSocket?.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify(payload));
        } else {
            appendMessage('ai', 'Chat disconnected. Reconnecting...');
            initWebSocket();
        }

        chatInput.value = '';
        currentImageData = null;
    };

    screenshotBtn.addEventListener('click', handleScreenshot);
    chatBtn.addEventListener('click', () => {
        chatContainer.style.display = chatContainer.style.display === 'none' ? 'flex' : 'none';
        if (chatContainer.style.display === 'flex' && !chatSocket) initWebSocket();
    });
    closeBtn.addEventListener('click', () => window.close());
    uploadBtn.addEventListener('click', handleImageUpload);
    imageUpload.addEventListener('change', (e) => processUploadedImage(e.target.files[0]));
    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    initWebSocket();
});
