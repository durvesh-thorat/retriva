
import React, { useState, useEffect, useRef } from 'react';
import { Chat, User, Message } from '../types';
import { Send, Search, ArrowLeft, MessageCircle, CheckCheck, Paperclip, File, ShieldBan, ShieldCheck, Lock, Globe, Users } from 'lucide-react';

interface ChatViewProps {
  user: User;
  onBack: () => void;
  onNotification: (title: string, body: string) => void;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string | null) => void;
  onSendMessage: (chatId: string, message: Message) => void;
  onBlockChat: (chatId: string) => void;
}

const ChatView: React.FC<ChatViewProps> = ({ user, onBack, onNotification, chats, activeChatId, onSelectChat, onSendMessage, onBlockChat }) => {
  const [newMessage, setNewMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const selectedChat = chats.find(c => c.id === activeChatId);
  const isBlocked = selectedChat?.isBlocked || false;
  const isGlobal = selectedChat?.type === 'global';

  useEffect(() => {
    // Auto-scroll to bottom of messages
    if (selectedChat) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedChat?.messages, activeChatId]);

  const handleSendMessage = (e?: React.FormEvent, attachment?: Message['attachment']) => {
    if (e) e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !activeChatId || isBlocked) return;

    const msg: Message = {
      id: crypto.randomUUID(),
      senderId: user.id,
      senderName: user.name, // Important for Global Chat
      text: newMessage,
      timestamp: Date.now(),
      attachment
    };

    onSendMessage(activeChatId, msg);
    setNewMessage('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeChatId && !isBlocked) {
       const reader = new FileReader();
       reader.onloadend = () => {
         handleSendMessage(undefined, {
           type: file.type.startsWith('image/') ? 'image' : 'file',
           url: reader.result as string
         });
       };
       reader.readAsDataURL(file);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-[calc(100vh-160px)] bg-white dark:bg-slate-900 rounded-[2rem] shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-800 flex relative">
      
      {/* Sidebar - Chat List */}
      <div className={`w-full md:w-80 border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-5 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Messages</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search conversations..." 
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border-none outline-none text-sm font-medium focus:ring-2 focus:ring-brand-violet/20 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {chats.map(chat => (
            <div 
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-2 ${
                activeChatId === chat.id 
                  ? 'bg-indigo-50 dark:bg-slate-800 shadow-sm' 
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm relative shrink-0 ${
                   chat.type === 'global' ? 'bg-gradient-to-br from-indigo-500 to-cyan-500' : 'bg-gradient-to-br from-indigo-400 to-purple-500'
                }`}>
                  {chat.type === 'global' ? <Globe className="w-6 h-6 text-white" /> : chat.itemTitle.charAt(0)}
                  {chat.isBlocked && (
                    <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-1 border-2 border-white dark:border-slate-900">
                      <ShieldBan className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className={`font-bold text-sm truncate ${activeChatId === chat.id ? 'text-brand-violet dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>
                      {chat.itemTitle}
                    </h3>
                    <span className="text-[10px] font-medium text-slate-400">{formatTime(chat.lastMessageTime)}</span>
                  </div>
                  <p className="text-xs truncate text-slate-500 font-medium flex items-center gap-1">
                    {chat.isBlocked ? (
                      <span className="text-red-500 flex items-center gap-1"><ShieldBan className="w-3 h-3" /> Blocked</span>
                    ) : (
                      chat.lastMessage
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-slate-50/50 dark:bg-slate-950/50 ${!activeChatId ? 'hidden md:flex' : 'flex'} relative`}>
        {selectedChat ? (
          <>
            {/* Header */}
            <div className="px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shadow-sm z-10 shrink-0">
               <div className="flex items-center gap-3">
                 <button onClick={() => onSelectChat(null)} className="md:hidden p-2 -ml-2 text-slate-500 dark:text-slate-400">
                   <ArrowLeft className="w-5 h-5" />
                 </button>
                 <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold relative ${
                     isGlobal ? 'bg-indigo-500' : 'bg-indigo-100 dark:bg-slate-800 text-indigo-600 dark:text-brand-violet'
                 }`}>
                    {isGlobal ? <Globe className="w-5 h-5" /> : selectedChat.itemTitle.charAt(0)}
                    {isBlocked && (
                      <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-0.5 border-2 border-white dark:border-slate-900">
                        <Lock className="w-3 h-3 text-white" />
                      </div>
                    )}
                 </div>
                 <div>
                   <h3 className="font-bold text-slate-900 dark:text-white leading-tight">{selectedChat.itemTitle}</h3>
                   <div className="flex items-center gap-1.5">
                     {isBlocked ? (
                       <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide flex items-center gap-1">
                         <ShieldBan className="w-3 h-3" /> Blocked
                       </span>
                     ) : (
                       isGlobal ? (
                          <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide flex items-center gap-1">
                             <Users className="w-3 h-3" /> Community
                          </span>
                       ) : (
                          <>
                           <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                           <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Online</span>
                          </>
                       )
                     )}
                   </div>
                 </div>
               </div>
               
               <div className="flex gap-2">
                 {!isGlobal && (
                    <button 
                      onClick={() => onBlockChat(selectedChat.id)} 
                      className={`p-2.5 rounded-full transition-colors ${
                        isBlocked 
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100' 
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-red-500'
                      }`}
                      title={isBlocked ? "Unblock User" : "Block User"}
                    >
                      {isBlocked ? <ShieldCheck className="w-5 h-5" /> : <ShieldBan className="w-5 h-5" />}
                    </button>
                 )}
               </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedChat.messages.map((msg, idx) => {
                const isMe = msg.senderId === user.id;
                // Show sender name if Global chat and not me
                const showSender = isGlobal && !isMe;
                
                return (
                  <div key={msg.id || idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                      {showSender && (
                        <span className="text-[10px] font-bold text-slate-400 mb-1 ml-1">{msg.senderName || 'Student'}</span>
                      )}

                      {msg.attachment && (
                        <div className={`mb-2 rounded-2xl overflow-hidden border shadow-sm ${isBlocked ? 'opacity-50 grayscale' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                             {msg.attachment.type === 'image' ? (
                               <img src={msg.attachment.url} className="max-w-full max-h-60 object-cover" />
                             ) : (
                               <div className="p-4 bg-white dark:bg-slate-800 flex items-center gap-3">
                                 <File className="w-8 h-8 text-brand-violet" />
                                 <span className="text-xs font-bold">Attachment</span>
                               </div>
                             )}
                        </div>
                      )}
                      
                      {msg.text && (
                         <div className={`px-5 py-3 text-sm font-medium leading-relaxed rounded-[1.2rem] shadow-sm ${
                           isMe 
                             ? (isBlocked ? 'bg-slate-400 text-white rounded-br-sm' : 'bg-brand-violet text-white rounded-br-sm shadow-brand-violet/20')
                             : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-800 rounded-bl-sm'
                         }`}>
                           {msg.text}
                         </div>
                      )}
                      
                      <div className="flex items-center gap-1.5 mt-1 px-1">
                        <span className="text-[10px] font-bold text-slate-400">{formatTime(msg.timestamp)}</span>
                        {isMe && <CheckCheck className="w-3 h-3 text-brand-violet" />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {isBlocked ? (
              <div className="p-6 bg-slate-100 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 text-center shrink-0">
                 <p className="text-sm font-bold text-slate-500">Conversation Blocked</p>
              </div>
            ) : (
              <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shrink-0">
                  <form onSubmit={(e) => handleSendMessage(e)} className="flex items-end gap-3 max-w-4xl mx-auto">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-brand-violet transition-colors">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    
                    <div className="flex-1 bg-slate-100 dark:bg-slate-950 rounded-2xl flex items-center border border-transparent focus-within:ring-2 focus-within:ring-brand-violet/20 transition-all">
                       <textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage(e)}
                        placeholder="Type a message..."
                        className="w-full max-h-32 px-5 py-3.5 bg-transparent border-none focus:ring-0 outline-none text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 resize-none"
                        rows={1}
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={!newMessage.trim()}
                      className="p-3.5 bg-brand-violet text-white rounded-2xl hover:bg-[#4f4dbd] transition-all disabled:opacity-50 shadow-lg shadow-brand-violet/30 transform active:scale-95"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </form>
                </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 p-8">
            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-6 ring-4 ring-slate-50 dark:ring-slate-800">
              <MessageCircle className="w-10 h-10 text-slate-300 dark:text-slate-600" />
            </div>
            <p className="font-bold text-lg text-slate-400 dark:text-slate-600">Select a chat to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatView;
