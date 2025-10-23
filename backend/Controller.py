from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import tempfile
import shutil
from Beta import transcribe_from_file, generate_response, speak, ASSISTANT_NAME

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/audio")
async def process_audio(file: UploadFile = File(...)):
    try:
        # Сохраняем файл временно
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        # Распознаём речь
        user_text = transcribe_from_file(tmp_path)
        if not user_text:
            return {"text": "", "reply": "Не удалось распознать речь"}

        # Ответ
        reply = generate_response(user_text)
        speak(reply)

        return {"text": user_text, "reply": reply}

    except Exception as e:
        return {"error": str(e)}
