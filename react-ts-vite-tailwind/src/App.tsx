// src/App.tsx
import { useState, useEffect, useRef } from "react";
import {
  Send,
  MessageCircle,
  Plus,
  Trash2,
  Moon,
  Sun,
  Mic,
  Upload,
  FileText,
  X,
  Code,
  FileSearch,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useWebSocket } from "./hooks/useWebSocket";

// Типы для расширенной системы сообщений
interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
  timestamp: Date;
  type: "text" | "code" | "file" | "system";
  fileName?: string;
  fileSize?: number;
  fileContent?: string;
  mimeType?: string;
  prompt?: string; // Промпт для файлов
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  lastActivity: Date;
  contextId?: string; // ID контекста на сервере
}

// Константы
const MAX_INPUT_LENGTH = 15000;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ['.txt','.js','.jsx','.ts','.tsx','.py','.java','.cpp','.c','.h','.html','.css','.scss','.json','.xml','.md','.sql','.php','.rb','.go','.rs','.swift','.kt','.dart'];

// Тип для загружаемого файла
interface PendingFile {
  file: File;
  content: string;
  preview: string;
}

function App() {
  const [input, setInput] = useState("");
  const [chats, setChats] = useState<Chat[]>([
    {
      id: "1",
      title: "Новый чат",
      messages: [],
      lastActivity: new Date(),
    },
  ]);
  const [activeChatId, setActiveChatId] = useState<string>("1");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  
  // Новые состояния для двухэтапной загрузки
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [filePrompt, setFilePrompt] = useState("");
  const [showFileModal, setShowFileModal] = useState(false);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Загрузка темы
  useEffect(() => {
    const savedTheme = localStorage.getItem("elli-theme");
    if (savedTheme === "dark") setIsDarkMode(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("elli-theme", isDarkMode ? "dark" : "light");
    document.documentElement.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);

  // Авто-высота textarea
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = "auto";
      textAreaRef.current.style.height = textAreaRef.current.scrollHeight + "px";
    }
  }, [input]);

  // Обработчик изменений текста
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length > MAX_INPUT_LENGTH) {
      setInputError(`Превышен лимит ${MAX_INPUT_LENGTH} символов`);
    } else {
      setInputError(null);
    }
    setInput(value);
  };

  // Обработчик выбора файла (первый этап)
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Проверка типа файла
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_FILE_TYPES.includes(fileExtension || '')) {
      setError(`Неподдерживаемый тип файла. Разрешены: ${ALLOWED_FILE_TYPES.join(', ')}`);
      return;
    }

    // Проверка размера
    if (file.size > MAX_FILE_SIZE) {
      setError(`Файл слишком большой. Максимум: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      return;
    }

    setUploadProgress(10);
    
    const reader = new FileReader();
    reader.onloadstart = () => setUploadProgress(30);
    reader.onprogress = () => setUploadProgress(60);
    reader.onload = (e) => {
      setUploadProgress(100);
      const content = e.target?.result as string;
      
      // Сохраняем файл как ожидающий отправки
      setPendingFile({
        file,
        content,
        preview: content.slice(0, 500) + (content.length > 500 ? "..." : "")
      });
      
      setShowFileModal(true);
      setFilePrompt(""); // Сбрасываем промпт
      
      setTimeout(() => setUploadProgress(null), 1000);
    };
    reader.onerror = () => {
      setError("Ошибка при чтении файла");
      setUploadProgress(null);
    };
    
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Отправка файла с промптом (второй этап)
  const handleSendFileWithPrompt = () => {
    if (!pendingFile) return;

    const messageText = filePrompt.trim() || "Проанализируй этот файл";
    
    const fileMessage: Message = {
      id: Date.now().toString(),
      text: messageText,
      sender: "user",
      timestamp: new Date(),
      type: "file",
      fileName: pendingFile.file.name,
      fileSize: pendingFile.file.size,
      fileContent: pendingFile.content,
      prompt: messageText,
    };

    // Добавляем в чат
    setChats(prevChats =>
      prevChats.map(chat =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: [...chat.messages, fileMessage],
              lastActivity: new Date(),
              title: chat.messages.length === 0 
                ? `Файл: ${pendingFile.file.name}` 
                : chat.title,
            }
          : chat
      )
    );

    // Отправляем на сервер
    const success = sendMessage({ 
      type: "file_message",  // Важно: именно file_message
      text: pendingFile.content,
      fileName: pendingFile.file.name,
      fileSize: pendingFile.file.size,
      prompt: messageText,
      contextId: activeChat.id  // Отправляем ID чата как contextId
    });

    if (!success) {
      handleError("Не удалось отправить файл. Проверьте подключение.");
    }

    // Закрываем модалку
    setShowFileModal(false);
    setPendingFile(null);
    setFilePrompt("");
  };

  // Отмена отправки файла
  const handleCancelFile = () => {
    setShowFileModal(false);
    setPendingFile(null);
    setFilePrompt("");
  };

  // Обработчик ответов от ассистента
  const handleAssistantResponse = (text: string, contextId?: string) => {
    setIsLoading(false);
    setError(null);
    setUploadProgress(null);

    const assistantMessage: Message = {
      id: Date.now().toString(),
      text: text,
      sender: "assistant",
      timestamp: new Date(),
      type: "text",
    };

    setChats(prevChats =>
      prevChats.map(chat =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: [...chat.messages, assistantMessage],
              lastActivity: new Date(),
              contextId: contextId || chat.contextId,
            }
          : chat
      )
    );
  };

  // Обработчик ошибок
  const handleError = (errorMessage: string) => {
    setIsLoading(false);
    setError(errorMessage);
    setUploadProgress(null);

    const errorMessageObj: Message = {
      id: Date.now().toString(),
      text: `❌ ${errorMessage}`,
      sender: "assistant",
      timestamp: new Date(),
      type: "text",
    };

    setChats(prevChats =>
      prevChats.map(chat =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: [...chat.messages, errorMessageObj],
              lastActivity: new Date(),
            }
          : chat
      )
    );
  };

  const { sendMessage, isConnected } = useWebSocket("ws://127.0.0.1:8003/ws", {
    onAssistantResponse: handleAssistantResponse,
    onError: handleError,
  });

  // Обработчик клавиш для textarea
  const handleTextAreaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newValue = input.substring(0, start) + "  " + input.substring(end);
      setInput(newValue);
      setTimeout(() => {
        if (textAreaRef.current) {
          textAreaRef.current.selectionStart = textAreaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  // Получаем активный чат
  const activeChat = chats.find((chat) => chat.id === activeChatId) || chats[0];

  // Отправка текстового сообщения
  const handleSend = () => {
    if (!input.trim()) return;

    setIsLoading(true);
    setError(null);
    setInputError(null);

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
      timestamp: new Date(),
      type: "text",
    };

    // Обновляем чаты
    setChats(prevChats =>
      prevChats.map(chat =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: [...chat.messages, userMessage],
              lastActivity: new Date(),
              title:
                chat.messages.length === 0
                  ? input.slice(0, 30) + (input.length > 30 ? "..." : "")
                  : chat.title,
            }
          : chat
      )
    );

    // Очищаем поле ввода
    setInput("");

    // Отправляем на сервер с контекстом
    const success = sendMessage({ 
      type: "text_message", 
      text: input,
      contextId: activeChat.contextId
    });
    
    if (!success) {
      setIsLoading(false);
      handleError("Не удалось отправить сообщение. Проверьте подключение.");
    }
  };

  const handleVoiceMessage = (message: any) => {
    sendMessage(message);
  };

  // Создание нового чата
  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: "Новый чат",
      messages: [],
      lastActivity: new Date(),
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setInput("");
    setError(null);
    setInputError(null);
    setUploadProgress(null);
    setPendingFile(null);
    setShowFileModal(false);
  };

  // Удаление чата
  const deleteChat = (chatId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    if (chats.length === 1) {
      alert("Нельзя удалить последний чат!");
      return;
    }

    const updatedChats = chats.filter((chat) => chat.id !== chatId);
    setChats(updatedChats);

    if (chatId === activeChatId) {
      setActiveChatId(updatedChats[0].id);
    }
  };

  // Переключение темы
  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Форматирование времени
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Форматирование размера файла
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Форматирование даты для списка чатов
  const formatChatTime = (date: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return formatTime(date);
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Вчера";
    } else {
      return date.toLocaleDateString("ru-RU");
    }
  };

  // Классы для темной темы
  const bgClass = isDarkMode ? "bg-gray-900" : "bg-gray-50";
  const textClass = isDarkMode ? "text-white" : "text-gray-800";
  const sidebarBgClass = isDarkMode ? "bg-gray-800" : "bg-white";
  const sidebarBorderClass = isDarkMode ? "border-gray-700" : "border-gray-200";
  const messageBgClass = isDarkMode ? "bg-gray-700" : "bg-white";
  const messageBorderClass = isDarkMode ? "border-gray-600" : "border-gray-200";
  const inputBgClass = isDarkMode
    ? "bg-gray-700 border-gray-600 text-white"
    : "bg-white border-gray-300 text-gray-800";
  const secondaryTextClass = isDarkMode ? "text-gray-300" : "text-gray-500";
  const hoverBgClass = isDarkMode ? "hover:bg-gray-700" : "hover:bg-gray-50";
  const activeChatBgClass = isDarkMode
    ? "bg-blue-900 border-blue-700"
    : "bg-blue-50 border-blue-200";
  const errorBorderClass = isDarkMode ? "border-red-500" : "border-red-400";
  const errorTextClass = isDarkMode ? "text-red-400" : "text-red-500";
  const modalBgClass = isDarkMode ? "bg-gray-800" : "bg-white";
  const modalBorderClass = isDarkMode ? "border-gray-600" : "border-gray-200";

  // Подсчет оставшихся символов
  const remainingChars = MAX_INPUT_LENGTH - input.length;
  const isNearLimit = remainingChars < 100;
  const isOverLimit = remainingChars < 0;

  return (
    <div
      className={`flex h-screen ${bgClass} ${textClass} transition-colors duration-200`}
    >
      {/* Левая колонка - История чатов */}
      <aside
        className={`w-80 ${sidebarBgClass} border-r ${sidebarBorderClass} flex flex-col transition-colors duration-200`}
      >
        {/* Заголовок и кнопки */}
        <div className={`p-4 border-b ${sidebarBorderClass}`}>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Elli</h1>
            <div className="flex gap-2">
              <button
                onClick={toggleTheme}
                className={`p-2 rounded-lg transition ${
                  isDarkMode
                    ? "bg-gray-700 text-yellow-400 hover:bg-gray-600"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
                title={isDarkMode ? "Светлая тема" : "Тёмная тема"}
              >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>

              <button
                onClick={createNewChat}
                className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition shadow-md"
                title="Новый чат"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* Статус подключения */}
          <div className="flex items-center gap-2 mt-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            ></div>
            <span className={`text-sm ${secondaryTextClass}`}>
              {isConnected ? "Подключено к AI" : "Не подключено"}
            </span>
          </div>
        </div>

        {/* Список чатов */}
        <div className="flex-1 overflow-y-auto">
          {chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              className={`p-4 border-b ${sidebarBorderClass} cursor-pointer transition group relative ${
                activeChatId === chat.id ? activeChatBgClass : hoverBgClass
              }`}
            >
              <button
                onClick={(e) => deleteChat(chat.id, e)}
                className="absolute right-3 top-3 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Удалить чат"
              >
                <Trash2
                  size={16}
                  className={
                    isDarkMode
                      ? "text-gray-400 hover:text-red-400"
                      : "text-gray-500 hover:text-red-500"
                  }
                />
              </button>

              <div className="flex items-start gap-3 pr-6">
                <MessageCircle
                  size={20}
                  className={`mt-1 flex-shrink-0 ${
                    activeChatId === chat.id
                      ? "text-blue-500"
                      : isDarkMode
                      ? "text-gray-400"
                      : "text-gray-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{chat.title}</h3>
                  {chat.messages.length > 0 && (
                    <p
                      className={`text-sm truncate mt-1 ${secondaryTextClass}`}
                    >
                      {chat.messages[chat.messages.length - 1].sender === "user"
                        ? "Вы: "
                        : "Elli: "}
                      {chat.messages[chat.messages.length - 1].type === "file" ? (
                        <span className="flex items-center gap-1">
                          <FileText size={12} />
                          {chat.messages[chat.messages.length - 1].fileName}
                        </span>
                      ) : (
                        chat.messages[chat.messages.length - 1].text
                      )}
                    </p>
                  )}
                  <p
                    className={`text-xs mt-2 ${
                      isDarkMode ? "text-gray-400" : "text-gray-400"
                    }`}
                  >
                    {formatChatTime(chat.lastActivity)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Центральная область - Активный чат */}
      <main className="flex-1 flex flex-col">
        {/* Заголовок активного чата */}
        <div className={`border-b ${sidebarBorderClass} ${sidebarBgClass} p-4`}>
          <h2 className="text-lg font-semibold">{activeChat.title}</h2>
          <div className="flex items-center gap-2 mt-1">
            <div
              className={`w-2 h-2 rounded-full ${
                isLoading
                  ? "bg-yellow-500 animate-pulse"
                  : isConnected
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            ></div>
            <span className={`text-sm ${secondaryTextClass}`}>
              {isLoading
                ? "Elli анализирует..."
                : isConnected
                ? "Готов к работе"
                : "Не подключено"}
            </span>
          </div>
        </div>

        {/* Область сообщений */}
        <div
          className={`flex-1 overflow-y-auto p-4 ${
            isDarkMode ? "bg-gray-800" : "bg-gray-50"
          } transition-colors duration-200`}
        >
          {activeChat.messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center"
              >
                <MessageCircle
                  size={48}
                  className={`mx-auto mb-4 ${
                    isDarkMode ? "text-gray-600" : "text-gray-300"
                  }`}
                />
                <p className="text-lg">Начните общение с Elli</p>
                <p className={`text-sm mt-2 ${secondaryTextClass}`}>
                  Задайте вопрос, загрузите файл с кодом или начните голосовой диалог
                </p>
                <div className={`mt-4 p-3 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} max-w-md mx-auto`}>
                  <p className={`text-sm ${secondaryTextClass} mb-2`}>
                    <strong>Поддерживаемые форматы:</strong>
                  </p>
                  <p className={`text-xs ${secondaryTextClass}`}>
                    {ALLOWED_FILE_TYPES.join(', ')}
                  </p>
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="space-y-4">
              {activeChat.messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${
                    message.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      message.sender === "user"
                        ? message.type === "file" 
                          ? "bg-purple-500 text-white rounded-br-none"
                          : "bg-blue-500 text-white rounded-br-none"
                        : `${messageBgClass} ${textClass} border ${messageBorderClass} rounded-bl-none`
                    }`}
                  >
                    {message.type === "file" && message.fileName && (
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/20">
                        <FileText size={16} />
                        <span className="text-sm font-medium">
                          {message.fileName}
                        </span>
                        {message.fileSize && (
                          <span className="text-xs opacity-75">
                            ({formatFileSize(message.fileSize)})
                          </span>
                        )}
                      </div>
                    )}
                    
                    {message.prompt && (
                      <div className="mb-2">
                        <p className="text-sm font-medium opacity-90">Запрос:</p>
                        <p className="text-sm">{message.prompt}</p>
                      </div>
                    )}
                    
                    <pre className={`text-sm whitespace-pre-wrap font-sans ${
                      message.type === "file" && message.sender === "user" 
                        ? "bg-black/20 p-2 rounded-lg max-h-32 overflow-y-auto" 
                        : ""
                    }`}>
                      {message.type === "file" && message.sender === "user" 
                        ? message.fileContent?.slice(0, 1000) + (message.fileContent && message.fileContent.length > 1000 ? "\n..." : "")
                        : message.text
                      }
                    </pre>
                    <p
                      className={`text-xs mt-1 ${
                        message.sender === "user"
                          ? "text-blue-100"
                          : secondaryTextClass
                      }`}
                    >
                      {formatTime(message.timestamp)}
                    </p>
                  </div>
                </motion.div>
              ))}

              {/* Индикатор загрузки */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-start"
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 ${messageBgClass} ${textClass} border ${messageBorderClass} rounded-bl-none`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div
                          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: "0.1s" }}
                        ></div>
                        <div
                          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: "0.2s" }}
                        ></div>
                      </div>
                      <span className="text-sm">Анализирую...</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>

        {/* Поле ввода */}
        <div
          className={`border-t ${sidebarBorderClass} ${sidebarBgClass} p-4 transition-colors duration-200`}
        >
          {/* Сообщение об ошибке */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-3 p-3 rounded-lg border ${errorBorderClass} bg-red-50 dark:bg-red-900/20 flex items-center gap-2`}
            >
              <X size={18} className={errorTextClass} />
              <span className={`text-sm ${errorTextClass}`}>{error}</span>
            </motion.div>
          )}

          <div className="flex items-end gap-3">
            {/* Скрытый input для файлов */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept={ALLOWED_FILE_TYPES.join(',')}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConnected || isLoading}
              className="p-3 bg-purple-500 text-white rounded-full hover:bg-purple-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md mb-1"
              title="Загрузить файл с кодом"
            >
              <Upload size={20} />
            </button>

            <div className="flex-1 relative">
              <textarea
                ref={textAreaRef}
                placeholder={
                  isConnected
                    ? `Введите сообщение... (максимум ${MAX_INPUT_LENGTH} символов)`
                    : "Ожидание подключения к серверу..."
                }
                className={`w-full border rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition ${inputBgClass} resize-none min-h-[52px] max-h-32 ${
                  inputError || isOverLimit ? errorBorderClass : ""
                }`}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleTextAreaKeyDown}
                disabled={!isConnected || isLoading}
                rows={1}
              />
              
              {/* Счетчик символов */}
              {input.length > 0 && (
                <div className={`absolute bottom-2 right-3 text-xs ${
                  isOverLimit ? errorTextClass : 
                  isNearLimit ? "text-yellow-500" : secondaryTextClass
                }`}>
                  {remainingChars}
                </div>
              )}
            </div>

            <div className="flex gap-2 mb-1">
              <button
                onClick={handleSend}
                disabled={!input.trim() || !isConnected || isLoading || isOverLimit}
                className="p-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                title={isOverLimit ? "Сообщение слишком длинное" : "Отправить сообщение"}
              >
                <Send size={20} />
              </button>

              <button
                onClick={() => handleVoiceMessage({ type: "voice_start" })}
                disabled={!isConnected || isLoading}
                className="p-3 bg-green-500 text-white rounded-full hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                title="Голосовой ввод"
              >
                <Mic size={20} />
              </button>
            </div>
          </div>

          {/* Подсказка под полем ввода */}
          <div className={`mt-2 text-xs ${secondaryTextClass} flex justify-between items-center`}>
            <span>
              {input.length > MAX_INPUT_LENGTH ? (
                <span className={errorTextClass}>
                  Сообщение будет обрезано при отправке
                </span>
              ) : (
                "Shift+Enter для новой строки, Tab для отступа"
              )}
            </span>
            <span className="flex items-center gap-1">
              <Code size={14} />
              <span>Контекстный анализ</span>
            </span>
          </div>
        </div>
      </main>

      {/* Модальное окно для отправки файла с промптом */}
      <AnimatePresence>
        {showFileModal && pendingFile && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={`${modalBgClass} ${modalBorderClass} border rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto`}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <FileSearch size={20} />
                  Отправить файл
                </h3>
                <button
                  onClick={handleCancelFile}
                  className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Информация о файле */}
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <FileText size={24} className="text-purple-500" />
                    <div>
                      <h4 className="font-medium">{pendingFile.file.name}</h4>
                      <p className="text-sm opacity-75">
                        {formatFileSize(pendingFile.file.size)} • {pendingFile.content.length} символов
                      </p>
                    </div>
                  </div>
                  
                  {/* Превью файла */}
                  <div className="mt-3">
                    <p className="text-sm font-medium mb-2">Превью:</p>
                    <pre className={`text-sm whitespace-pre-wrap max-h-40 overflow-y-auto p-3 rounded ${
                      isDarkMode ? 'bg-gray-800' : 'bg-white'
                    }`}>
                      {pendingFile.preview}
                    </pre>
                  </div>
                </div>

                {/* Поле для промпта */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Что вы хотите узнать об этом файле?
                  </label>
                  <textarea
                    value={filePrompt}
                    onChange={(e) => setFilePrompt(e.target.value)}
                    placeholder="Например: 'Найди ошибки в коде', 'Объясни что делает функция main', 'Проанализируй архитектуру'..."
                    className={`w-full border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition ${inputBgClass} resize-none min-h-[100px]`}
                    rows={3}
                  />
                </div>

                {/* Кнопки действий */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCancelFile}
                    className={`flex-1 py-3 px-4 border rounded-xl transition ${
                      isDarkMode 
                        ? 'border-gray-600 hover:bg-gray-700' 
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleSendFileWithPrompt}
                    disabled={!isConnected || isLoading}
                    className="flex-1 py-3 px-4 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Отправка...
                      </div>
                    ) : (
                      "Отправить файл"
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;