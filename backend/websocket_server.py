# websocket_server.py
import os
import json
import base64
import re
import time
import hashlib
from datetime import datetime, timedelta
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Optional
import asyncio

# ================== Настройки ==================
SAMPLE_RATE = 16000
MODEL_PATH = os.path.join(os.path.dirname(__file__), "vosk-model-small-ru-0.22")
ASSISTANT_NAME = "Элли"
GGUF_PATH = os.path.join(os.path.dirname(__file__), "qwen2.5-1.5b-instruct-q4_k_m.gguf")

# Константы для обработки больших текстов
MAX_CONTEXT_SIZE = 4000
CHUNK_SIZE = 3000
MAX_HISTORY_MESSAGES = 10  # Максимальное количество сообщений в истории
CACHE_TTL = 3600  # 1 час в секундах

# ================== Импорт моделей ==================
print("🔄 Загружаю AI модели...")

# Vosk
try:
    from vosk import Model, KaldiRecognizer
    print("📦 Загружаю Vosk модель...")
    vosk_model = Model(MODEL_PATH)
    print("✅ Vosk модель загружена")
    HAS_VOSK = True
except Exception as e:
    print(f"❌ Vosk не загружен: {e}")
    vosk_model = None
    HAS_VOSK = False

# GPT4All
try:
    from gpt4all import GPT4All
    print("📦 Загружаю GPT4All...")
    llm = GPT4All(os.path.basename(GGUF_PATH), model_path=os.path.dirname(GGUF_PATH))
    print("✅ GPT4All загружена")
    HAS_LLM = True
except Exception as e:
    print(f"❌ GPT4All не загружена: {e}")
    llm = None
    HAS_LLM = False

# ================== FastAPI ==================
app = FastAPI(title="Elli AI Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================== Система кэширования и истории ==================

class AnalysisCache:
    """Кэш для анализа кода"""
    def __init__(self):
        self.cache = {}
    
    def get_key(self, content: str, analysis_type: str = "full") -> str:
        """Генерирует ключ для кэша"""
        content_hash = hashlib.md5(content.encode()).hexdigest()
        return f"{analysis_type}_{content_hash}"
    
    def get(self, key: str) -> Optional[dict]:
        """Получает данные из кэша"""
        if key in self.cache:
            data, timestamp = self.cache[key]
            if time.time() - timestamp < CACHE_TTL:
                return data
            else:
                del self.cache[key]
        return None
    
    def set(self, key: str, data: dict):
        """Сохраняет данные в кэш"""
        self.cache[key] = (data, time.time())

class ChatContext:
    """Управление контекстом чата"""
    def __init__(self):
        self.chat_histories: Dict[str, List[dict]] = {}
        self.file_contents: Dict[str, dict] = {}  # Хранит содержимое файлов по chat_id
        self.cache = AnalysisCache()
    
    def get_chat_history(self, chat_id: str) -> List[dict]:
        """Возвращает историю чата"""
        return self.chat_histories.get(chat_id, [])
    
    def add_message(self, chat_id: str, message: dict):
        """Добавляет сообщение в историю"""
        if chat_id not in self.chat_histories:
            self.chat_histories[chat_id] = []
        
        self.chat_histories[chat_id].append({
            **message,
            "timestamp": datetime.now().isoformat()
        })
        
        # Ограничиваем размер истории
        if len(self.chat_histories[chat_id]) > MAX_HISTORY_MESSAGES:
            self.chat_histories[chat_id] = self.chat_histories[chat_id][-MAX_HISTORY_MESSAGES:]
    
    def store_file_content(self, chat_id: str, file_name: str, content: str, file_hash: str):
        """Сохраняет содержимое файла для чата"""
        if chat_id not in self.file_contents:
            self.file_contents[chat_id] = {}
        
        self.file_contents[chat_id][file_hash] = {
            "file_name": file_name,
            "content": content,
            "timestamp": datetime.now().isoformat()
        }
    
    def get_recent_files(self, chat_id: str) -> List[dict]:
        """Возвращает недавно загруженные файлы"""
        if chat_id not in self.file_contents:
            return []
        
        files = list(self.file_contents[chat_id].values())
        # Сортируем по времени (новые сначала)
        files.sort(key=lambda x: x["timestamp"], reverse=True)
        return files[:3]  # Возвращаем 3 последних файла

# Глобальные объекты
chat_context = ChatContext()

# ================== Помощники анализа ==================

def split_large_text(text: str, chunk_size: int = CHUNK_SIZE) -> List[str]:
    """Разделяет большой текст на чанки"""
    if len(text) <= chunk_size:
        return [text]
    
    paragraphs = text.split('\n\n')
    chunks = []
    current_chunk = ""
    
    for paragraph in paragraphs:
        if len(current_chunk) + len(paragraph) + 2 <= chunk_size:
            current_chunk += paragraph + "\n\n"
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = paragraph + "\n\n"
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    if len(chunks) == 1 and len(chunks[0]) > chunk_size:
        lines = text.split('\n')
        chunks = []
        current_chunk = ""
        
        for line in lines:
            if len(current_chunk) + len(line) + 1 <= chunk_size:
                current_chunk += line + "\n"
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = line + "\n"
        
        if current_chunk:
            chunks.append(current_chunk.strip())
    
    return chunks

def is_code(text: str) -> bool:
    """Определяет, является ли текст кодом"""
    code_indicators = [
        r'def\s+\w+', r'class\s+\w+', r'import\s+\w+', r'from\s+\w+',
        r'function\s*\w*', r'const\s+\w+', r'let\s+\w+', r'var\s+\w+',
        r'public\s+class', r'private\s+class', r'void\s+\w+',
        r'<?php', r'<html', r'<script', r'#include', r'using\s+namespace',
        r'```\w*', r'\.\w+\s*\(', r'\w+\s*=\s*[^=]', r'{\s*$', r'}\s*$'
    ]
    
    text_for_check = text[:1000]
    
    for pattern in code_indicators:
        if re.search(pattern, text_for_check, re.IGNORECASE | re.MULTILINE):
            return True
    
    special_chars = set('{}[]();,=<>+-*/%&|!~')
    char_count = len(text_for_check)
    if char_count > 0:
        special_count = sum(1 for char in text_for_check if char in special_chars)
        if special_count / char_count > 0.05:
            return True
    
    return False

def quick_code_analysis(content: str) -> dict:
    """Быстрый анализ кода (1-2 секунды)"""
    start_time = time.time()
    
    analysis = {
        "language": "unknown",
        "functions": [],
        "classes": [],
        "imports": [],
        "file_size": len(content),
        "lines": content.count('\n') + 1,
        "analysis_time": 0
    }
    
    # Быстрое определение языка
    if re.search(r'def\s+\w+|import\s+\w+|from\s+\w+', content):
        analysis["language"] = "python"
    elif re.search(r'function\s+\w+|const\s+\w+|let\s+\w+', content):
        analysis["language"] = "javascript"
    elif re.search(r'public\s+class|private\s+class|void\s+\w+', content):
        analysis["language"] = "java"
    elif re.search(r'#include|using\s+namespace', content):
        analysis["language"] = "cpp"
    
    # Быстрое извлечение функций
    if analysis["language"] == "python":
        functions = re.findall(r'def\s+(\w+)\s*\(', content)
        analysis["functions"] = functions[:10]  # Ограничиваем количество
    elif analysis["language"] in ["javascript", "typescript"]:
        functions = re.findall(r'function\s+(\w+)\s*\(', content)
        analysis["functions"] = functions[:10]
    
    # Быстрое извлечение классов
    classes = re.findall(r'class\s+(\w+)', content)
    analysis["classes"] = classes[:5]
    
    # Быстрое извлечение импортов
    imports = re.findall(r'import\s+[^\n]+|from\s+[^\n]+', content)
    analysis["imports"] = imports[:10]
    
    analysis["analysis_time"] = time.time() - start_time
    return analysis

def generate_context_prompt(chat_history: List[dict], current_query: str, recent_files: List[dict] = None) -> str:
    """Генерирует промпт с учетом контекста"""
    context_parts = []
    
    # Добавляем историю диалога
    if chat_history:
        context_parts.append("Предыдущий диалог:")
        for msg in chat_history[-6:]:  # Берем последние 6 сообщений
            role = "Пользователь" if msg.get("role") == "user" else "Ассистент"
            content = msg.get("content", "")
            context_parts.append(f"{role}: {content}")
        context_parts.append("")
    
    # Добавляем информацию о файлах
    if recent_files:
        context_parts.append("Недавно загруженные файлы:")
        for file in recent_files:
            quick_analysis = quick_code_analysis(file["content"])
            context_parts.append(f"- {file['file_name']} ({quick_analysis['language']}, {len(file['content'])} символов)")
            if quick_analysis["functions"]:
                context_parts.append(f"  Функции: {', '.join(quick_analysis['functions'][:3])}")
        context_parts.append("")
    
    context_parts.append(f"Текущий запрос: {current_query}")
    
    return "\n".join(context_parts)

def generate_response_for_chunks(chunks: List[str], is_code_text: bool = False, context: str = "") -> str:
    """Генерирует ответ для чанков большого текста"""
    if not chunks:
        return "Не получилось обработать текст."
    
    if len(chunks) == 1:
        return generate_response(chunks[0], is_code_text, context)
    
    summaries = []
    
    for i, chunk in enumerate(chunks):
        if is_code_text:
            prompt = f"""
            {context}
            
            Ты - AI ассистент Элли, эксперт по программированию.
            
            Проанализируй этот фрагмент кода (часть {i+1}/{len(chunks)}) и кратко опиши:
            - Что делает этот фрагмент
            - Какие функции/классы присутствуют
            - Основную логику
            
            Код:
            {chunk}
            
            Краткий анализ:
            """
        else:
            prompt = f"""
            {context}
            
            Ты - AI ассистент Элли.
            
            Кратко суммаризируй эту часть текста (часть {i+1}/{len(chunks)}), выделив основные идеи.
            
            Текст:
            {chunk}
            
            Краткое содержание:
            """
        
        summary = generate_response(prompt, False)
        summaries.append(f"Часть {i+1}: {summary}")
    
    # Финальный анализ
    if is_code_text:
        final_prompt = f"""
        {context}
        
        Ты - AI ассистент Элли, эксперт по программированию.
        
        На основе анализа частей кода сделай общий вывод:
        
        {' '.join(summaries)}
        
        Сделай общий анализ всего кода:
        1. Общая цель и функциональность
        2. Архитектура и структура  
        3. Заметные проблемы или возможности улучшения
        4. Рекомендации
        
        Общий анализ:
        """
    else:
        final_prompt = f"""
        {context}
        
        Ты - AI ассистент Элли.
        
        На основе суммаризированных частей сделай общий анализ текста:
        
        {' '.join(summaries)}
        
        Основные выводы и ключевые моменты:
        """
    
    return generate_response(final_prompt, False)

def generate_response(user_text: str, detect_code: bool = True, context: str = "") -> str:
    if not user_text.strip():
        return "Я не расслышала — повтори, пожалуйста."

    # Определяем тип контента
    is_code_text = is_code(user_text) if detect_code else False
    
    # Проверяем кэш для кода
    if is_code_text and len(user_text) > 100:
        cache_key = chat_context.cache.get_key(user_text, "quick_analysis")
        cached = chat_context.cache.get(cache_key)
        if cached:
            print("🎯 Использую кэшированный анализ")
            return cached.get("response", "Анализ завершен.")
    
    # Проверяем длину
    if len(user_text) > MAX_CONTEXT_SIZE:
        chunks = split_large_text(user_text, CHUNK_SIZE)
        
        print(f"📦 Разделяю большой текст на {len(chunks)} чанков (код: {is_code_text})")
        
        try:
            response = generate_response_for_chunks(chunks, is_code_text, context)
            
            # Кэшируем результат для кода
            if is_code_text:
                cache_key = chat_context.cache.get_key(user_text, "full_analysis")
                chat_context.cache.set(cache_key, {"response": response})
            
            return response
        except Exception as e:
            print(f"❌ Ошибка обработки больших чанков: {e}")
            return "Текст слишком большой для обработки. Попробуйте разбить его на части."

    # Обычная обработка для коротких текстов
    if HAS_LLM and llm:
        try:
            with llm.chat_session():
                if is_code_text:
                    # Быстрый анализ для превью
                    quick_analysis = quick_code_analysis(user_text)
                    
                    prompt = f"""
                    {context}
                    
                    Ты - Элли, AI ассистент и эксперт по программированию. 
                    
                    Пользователь прислал код. Проанализируй его и ответь на русском:
                    
                    {user_text}
                    
                    Информация о коде:
                    - Язык: {quick_analysis['language']}
                    - Функции: {', '.join(quick_analysis['functions'][:5])}
                    - Классы: {', '.join(quick_analysis['classes'][:3])}
                    - Размер: {quick_analysis['file_size']} символов, {quick_analysis['lines']} строк
                    
                    Давай структурированный ответ:
                    1. 📝 Что делает этот код?
                    2. 🔍 Заметил ли ты какие-то проблемы?
                    3. 💡 Предложения по улучшению (если есть)
                    
                    Отвечай кратко и по делу на русском языке:
                    """
                else:
                    prompt = f"""
                    {context}
                    
                    Ты - Элли, дружелюбный AI ассистент. Отвечай на русском языке.
                    
                    Вопрос: {user_text}
                    
                    Ответь кратко и полезно:
                    """
                
                start_time = time.time()
                resp = llm.generate(prompt, max_tokens=400, temp=0.7)
                response_time = time.time() - start_time
                
                print(f"⏱️ Время генерации: {response_time:.2f}с")
                
                response = resp.strip() if isinstance(resp, str) else str(resp)
                
                # Пост-обработка ответа
                if "не могу" in response.lower() and "анализировать" in response.lower():
                    return "Я проанализировала ваш код! Это выглядит как программный код. Если вам нужен более детальный анализ, попробуйте задать конкретный вопрос о коде."
                
                # Кэшируем результат для кода
                if is_code_text:
                    cache_key = chat_context.cache.get_key(user_text, "quick_analysis")
                    chat_context.cache.set(cache_key, {
                        "response": response,
                        "analysis_time": response_time
                    })
                
                return response
                
        except Exception as e:
            print(f"Ошибка LLM: {e}")

    # Фолбэк ответы
    low = user_text.lower()
    if "привет" in low: return "Привет! Я слушаю тебя 👋"
    if "как тебя зовут" in low: return f"Я {ASSISTANT_NAME}."
    if "пока" in low: return "Пока! 👋"
    if "спасибо" in low: return "Всегда пожалуйста 💚"
    
    if is_code_text:
        return "Вижу что это код! Если нужен анализ, задайте конкретный вопрос о этом коде."
    
    return f"Вы сказали: {user_text}"

def transcribe_audio_chunk(audio_data: bytes) -> str:
    if not HAS_VOSK or not vosk_model:
        return ""
    try:
        rec = KaldiRecognizer(vosk_model, SAMPLE_RATE)
        if rec.AcceptWaveform(audio_data):
            res = json.loads(rec.Result())
            return res.get("text", "")
        return ""
    except Exception as e:
        print(f"Ошибка распознавания: {e}")
        return ""

# ================== WebSocket ==================
class ConnectionManager:
    def __init__(self):
        self.active_connections = []
        self.recognizers = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)
        if HAS_VOSK:
            self.recognizers[ws] = KaldiRecognizer(vosk_model, SAMPLE_RATE)
        print(f"✅ Подключился клиент ({len(self.active_connections)})")

    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections:
            self.active_connections.remove(ws)
        if ws in self.recognizers:
            del self.recognizers[ws]
        print(f"❌ Клиент отключился ({len(self.active_connections)})")

    async def send_json(self, ws: WebSocket, message: dict):
        try:
            await ws.send_text(json.dumps(message))
        except Exception as e:
            print(f"Ошибка отправки: {e}")

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    print("✅ Клиент подключился")

    try:
        while True:
            msg_data = await ws.receive_text()
            
            if not msg_data:
                continue

            try:
                msg = json.loads(msg_data)
            except json.JSONDecodeError:
                await manager.send_json(ws, {
                    "type": "error",
                    "text": "Некорректный формат сообщения"
                })
                print(f"📨 Получено сообщение типа: {msg_type}")
                print(f"📦 Данные: {json.dumps(msg, ensure_ascii=False)[:200]}...")
                print(f"🔍 DEBUG: Получен тип сообщения = '{msg_type}'")
                print(f"🔍 DEBUG: Все ключи = {list(msg.keys())}")
                continue

            msg_type = msg.get("type")
            context_id = msg.get("contextId")  # ID чата для контекста

            if msg_type == "text_message":
                text = msg.get("text", "")
                print(f"👤 Текст ({len(text)} символов): {text[:100]}...")
                
                # Получаем историю и контекст
                chat_history = chat_context.get_chat_history(context_id) if context_id else []
                recent_files = chat_context.get_recent_files(context_id) if context_id else []
                context_prompt = generate_context_prompt(chat_history, text, recent_files)
                
                # Сохраняем сообщение пользователя в историю
                if context_id:
                    chat_context.add_message(context_id, {
                        "role": "user",
                        "content": text
                    })
                
                try:
                    reply = generate_response(text, True, context_prompt)
                    
                    # Сохраняем ответ ассистента в историю
                    if context_id:
                        chat_context.add_message(context_id, {
                            "role": "assistant", 
                            "content": reply
                        })
                    
                    await manager.send_json(ws, {
                        "type": "assistant_response",
                        "text": reply,
                        "transcribed_text": text,
                        "contextId": context_id
                    })
                    print(f"🤖 Ответ: {reply}")
                except Exception as e:
                    print(f"❌ Ошибка генерации ответа: {e}")
                    await manager.send_json(ws, {
                        "type": "error",
                        "text": f"Ошибка обработки: {str(e)}"
                    })

            elif msg_type == "file_message":
                text = msg.get("text", "")
                file_name = msg.get("fileName", "код")
                file_size = msg.get("fileSize", 0)
                prompt = msg.get("prompt", "Проанализируй этот файл")
                context_id = msg.get("contextId")
                
                print(f"💻 Файл {file_name} ({file_size} байт, {len(text)} символов)")
                print(f"📝 Промпт: {prompt}")
                
                # Сохраняем файл в контексте
                if context_id:
                    file_hash = hashlib.md5(text.encode()).hexdigest()
                    chat_context.store_file_content(context_id, file_name, text, file_hash)
                    
                    # Добавляем в историю
                    chat_context.add_message(context_id, {
                        "role": "user",
                        "content": f"Файл: {file_name}\nЗапрос: {prompt}",
                        "file_info": {
                            "name": file_name,
                            "size": file_size,
                            "hash": file_hash
                        }
                    })
                
                try:
                    # Генерируем контекст для анализа файла
                    chat_history = chat_context.get_chat_history(context_id) if context_id else []
                    recent_files = chat_context.get_recent_files(context_id) if context_id else []
                    context_prompt = generate_context_prompt(chat_history, prompt, recent_files)
                    
                    # Анализируем файл с учетом промпта
                    analysis_text = f"{prompt}\n\nФайл: {file_name}\n\n{text}"
                    reply = generate_response(analysis_text, True, context_prompt)
                    
                    # Сохраняем ответ в историю
                    if context_id:
                        chat_context.add_message(context_id, {
                            "role": "assistant",
                            "content": reply
                        })
                    
                    await manager.send_json(ws, {
                        "type": "assistant_response", 
                        "text": reply,
                        "transcribed_text": f"Файл: {file_name}",
                        "contextId": context_id
                    })
                    print(f"🤖 Анализ файла: {reply}")
                except Exception as e:
                    print(f"❌ Ошибка анализа файла: {e}")
                    await manager.send_json(ws, {
                        "type": "error", 
                        "text": f"Ошибка анализа файла: {str(e)}"
                    })

            elif msg_type == "voice_chunk":
                b64 = msg.get("audio", "")
                if b64.startswith("data:"):
                    b64 = b64.split(",")[1]
                audio = base64.b64decode(b64)
                text = transcribe_audio_chunk(audio)
                if text:
                    reply = generate_response(text)
                    await manager.send_json(ws, {
                        "type": "assistant_response",
                        "text": reply,
                        "transcribed_text": text
                    })

            else:
                print(f"⚠️ Неизвестный тип сообщения: {msg_type}")

    except WebSocketDisconnect as e:
        print(f"❌ Клиент отключился: {e}")
        manager.disconnect(ws)
    except Exception as e:
        print(f"❌ Ошибка WebSocket: {e}")
        manager.disconnect(ws)

@app.get("/")
async def root():
    return {"message": "Elli AI WebSocket Server работает 🚀"}

@app.get("/health")
async def health():
    return {
        "connections": len(manager.active_connections), 
        "vosk": HAS_VOSK, 
        "llm": HAS_LLM,
        "cache_size": len(chat_context.cache.cache),
        "active_chats": len(chat_context.chat_histories)
    }

@app.get("/debug/context/{chat_id}")
async def debug_context(chat_id: str):
    """Эндпоинт для отладки контекста"""
    history = chat_context.get_chat_history(chat_id)
    files = chat_context.get_recent_files(chat_id)
    return {
        "chat_id": chat_id,
        "history_length": len(history),
        "history": history,
        "recent_files": files
    }

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("🚀 Elli AI WebSocket Server с контекстом и кэшем")
    print("=" * 50)
    print("📡 WebSocket: ws://localhost:8003/ws")
    print("📖 REST API:  http://localhost:8003/docs")
    print(f"💾 Кэш: {CACHE_TTL} секунд")
    print(f"📚 История: {MAX_HISTORY_MESSAGES} сообщений")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8003)