from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from PIL import Image
from io import BytesIO
import base64
import json
import asyncio
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini API
GEMINI_API_KEY = " "  # Replace with your actual API key
genai.configure(api_key=GEMINI_API_KEY)

# Initialize model with enhanced configuration
generation_config = {
    "temperature": 0.9,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 8192,
}

model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=generation_config,
)

# Security analysis prompts
SECURITY_ANALYSIS_PROMPT = """
You are a cybersecurity expert analyzing this screenshot. Focus on identifying potential security threats and risks:

Key Analysis Areas:
first Check the domain like hackerearth and all also sometimed the invite links are valid so if domain is valid then say nothing to worry
1. Phishing attempts & social engineering
2. Suspicious URLs & redirects
3. Fake login forms & credential theft
4. Brand impersonation & spoofing
5. Data collection & privacy risks
6. Malware distribution tactics
7. Urgency manipulation & pressure
8. UI/UX deception patterns
9. SSL/TLS certificate issues
10. Input validation & XSS risks
11. Payment & financial fraud indicators
12. Suspicious advertisement patterns
13. Cookie and tracking concerns
14. Mobile-specific security risks
15. Authentication mechanism issues

Format your response exactly as follows:
Line 1: Single word verdict (SAFE/SUSPICIOUS/DANGEROUS)
Lines 2-4: Three most critical observations or risks, in order of severity
Be specific and actionable in your explanations.
"""

CHAT_IMAGE_ANALYSIS_PROMPT = """
Analyze this image from a security perspective. Consider:
1. Visual security indicators
2. UI elements that might be suspicious
3. Potential phishing or fraud attempts
4. Brand misuse or impersonation
5. Suspicious design patterns

Provide a clear, concise analysis focusing on security implications.
"""

class ScreenshotData(BaseModel):
    image: str

class ChatMessage(BaseModel):
    message: str = ""
    image: str = None
    context: str = ""

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.chat_history: dict = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.chat_history[id(websocket)] = []

    def disconnect(self, websocket: WebSocket):
        if id(websocket) in self.chat_history:
            del self.chat_history[id(websocket)]
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

manager = ConnectionManager()

def process_base64_image(base64_string: str) -> bytes:
    """Process base64 image string and return bytes."""
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        return base64.b64decode(base64_string)
    except Exception as e:
        logger.error(f"Image processing error: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid image format")

@app.post("/analyze")
async def analyze_screenshot(data: ScreenshotData):
    try:
        logger.info("Received screenshot analysis request")
        image_bytes = process_base64_image(data.image)
        
        # Create prompt parts
        prompt_parts = [
            SECURITY_ANALYSIS_PROMPT,
            {"mime_type": "image/png", "data": image_bytes}
        ]
        
        # Get analysis from Gemini
        try:
            response = model.generate_content(prompt_parts)
            analysis = response.text.strip()
        except Exception as e:
            logger.error(f"Gemini API error: {str(e)}")
            raise HTTPException(status_code=500, detail="Analysis service error")

        # Parse response
        lines = analysis.split('\n')
        verdict = lines[0].strip()
        explanation = [line.strip() for line in lines[1:4] if line.strip()]

        # Ensure we have exactly three explanation points
        while len(explanation) < 3:
            explanation.append("No additional concerns identified.")

        return {
            "verdict": verdict,
            "explanation": explanation[:3]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.websocket("/chat")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        chat = model.start_chat(history=[])
        
        while True:
            data = await websocket.receive_text()
            chat_input = json.loads(data)
            
            response_text = ""
            prompt_parts = []
            
            # Handle image analysis if present
            if chat_input.get('image'):
                try:
                    image_bytes = process_base64_image(chat_input['image'])
                    prompt_parts.extend([
                        CHAT_IMAGE_ANALYSIS_PROMPT,
                        {"mime_type": "image/png", "data": image_bytes}
                    ])
                except Exception as e:
                    logger.error(f"Image analysis error: {str(e)}")
                    response_text = "I apologize, but I encountered an error analyzing the image. Please try again."
            
            # Handle text message if present
            if chat_input.get('message'):
                system_prompt = f"""
                You are an AI security analyst assistant specializing in web security and threat detection. 
                Previous Analysis Context: {chat_input.get('context', 'No previous analysis')}
                
                Your role is to:
                1. Explain identified security risks in clear, simple terms
                2. Provide specific, actionable safety recommendations
                3. Help users understand technical security concepts
                4. Answer questions about online safety and digital privacy
                
                Additional Guidelines:
                - Be clear and concise
                - Use everyday examples
                - Prioritize practical advice
                - Consider both technical and non-technical users
                
                User Message: {chat_input['message']}
                """
                prompt_parts.append(system_prompt)
            
            if prompt_parts:
                try:
                    response = model.generate_content(prompt_parts)
                    response_text = response.text.strip()
                except Exception as e:
                    logger.error(f"Chat processing error: {str(e)}")
                    if not response_text:
                        response_text = "I apologize, but I encountered an error processing your message. Please try again."

            await manager.send_personal_message(response_text, websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        await manager.send_personal_message(f"Error: {str(e)}", websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)