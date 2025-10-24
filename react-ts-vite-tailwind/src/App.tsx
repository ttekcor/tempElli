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
} from "lucide-react";
import { motion } from "framer-motion";
import { useWebSocket } from "./hooks/useWebSocket";

// Тип для сообщения
interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
  timestamp: Date;
}

// Тип для чата
interface Chat {
  id: string;
  title: string;
  messages: Message[];
  lastActivity: Date;
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

  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Загрузка темы из localStorage при загрузке
  useEffect(() => {
    const savedTheme = localStorage.getItem("elli-theme");
    if (savedTheme === "dark") {
      setIsDarkMode(true);
    }
  }, []);

  // Сохранение темы в localStorage
  useEffect(() => {
    localStorage.setItem("elli-theme", isDarkMode ? "dark" : "light");
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Автоматическое изменение высоты текстовой области
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = "auto";
      textAreaRef.current.style.height = textAreaRef.current.scrollHeight + "px";
    }
  }, [input]);

  // Обработчик ответов от ассистента
  const handleAssistantResponse = (text: string, transcribedText?: string) => {
    setIsLoading(false);
    setError(null);

    const assistantMessage: Message = {
      id: Date.now().toString(),
      text: text,
      sender: "assistant",
      timestamp: new Date(),
    };

    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: [...chat.messages, assistantMessage],
              lastActivity: new Date(),
            }
          : chat
      )
    );
  };

  // Обработчик ошибок
  const handleError = (errorMessage: string) => {
    setIsLoading(false);
    setError(errorMessage);

    const errorMessageObj: Message = {
      id: Date.now().toString(),
      text: `❌ ${errorMessage}`,
      sender: "assistant",
      timestamp: new Date(),
    };

    setChats((prevChats) =>
      prevChats.map((chat) =>
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

  // Обработчик для текстовой области с поддержкой табов
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
      // Возвращаем курсор после таба
      setTimeout(() => {
        if (textAreaRef.current) {
          textAreaRef.current.selectionStart = textAreaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  // Получаем активный чат
  const activeChat = chats.find((chat) => chat.id === activeChatId) || chats[0];

  const handleSend = () => {
    if (!input.trim()) return;

    // Добавляем сообщение пользователя
    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
      timestamp: new Date(),
    };

    // Обновляем чаты
    setChats((prevChats) =>
      prevChats.map((chat) =>
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

    // Отправляем на сервер
    const success = sendMessage({ type: "text_message", text: input });
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
                      {chat.messages[chat.messages.length - 1].text}
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
                ? "Elli печатает..."
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
                  Задайте вопрос или начните голосовой диалог
                </p>
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
                    className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                      message.sender === "user"
                        ? "bg-blue-500 text-white rounded-br-none"
                        : `${messageBgClass} ${textClass} border ${messageBorderClass} rounded-bl-none`
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.text}</p>
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
          <div className="flex items-end gap-3">
            <textarea
              ref={textAreaRef}
              placeholder={
                isConnected
                  ? "Введите сообщение... (Shift+Enter для новой строки)"
                  : "Ожидание подключения к серверу..."
              }
              className={`flex-1 border rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition ${inputBgClass} resize-none min-h-[52px] max-h-32`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleTextAreaKeyDown}
              disabled={!isConnected || isLoading}
              rows={1}
            />

            <div className="flex gap-2 mb-1">
              <button
                onClick={handleSend}
                disabled={!input.trim() || !isConnected || isLoading}
                className="p-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
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
        </div>
      </main>
    </div>
  );
}

export default App;