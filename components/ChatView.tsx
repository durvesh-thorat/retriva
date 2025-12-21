
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Chat, User, Message } from '../types';
import { Send, Search, ArrowLeft, MessageCircle, Check, CheckCheck, Paperclip, File, ShieldBan, ShieldCheck, Lock, Globe, Users, Trash2, Home, X, Pin } from 'lucide-react';
import { doc, updateDoc, getDoc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';

interface ChatViewProps {
  user: User;
  onBack: () => void;
  onNotification: (title: string, body: string) => void;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string | null) => void;
  onSendMessage: (chatId: string, message: Message) => void;
  onBlockChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
}

const ChatView: React.FC<ChatViewProps> = ({ user, onBack, onNotification, chats, activeChatId, onSelectChat, onSendMessage, onBlockChat, onDeleteChat }) => {
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  
  // New State for Subcollection Messages
  const [subcollectionMessages, setSubcollectionMessages] = useState<Message[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const selectedChat = chats.find(c => c.id === activeChatId);
  const isGlobal = selectedChat?.type === 'global';
  
  // Logic to determine if blocked and by whom
  const isBlocked = selectedChat?.isBlocked || false;
  const iBlockedThem = selectedChat?.blockedBy === user.id;
  const theyBlockedMe = isBlocked && !iBlockedThem;

  const otherParticipantId = selectedChat?.participants.find(p => p !== user.id);

  // 0. Listen to Subcollection Messages (The Fix for 1MB Limit)
  useEffect(() => {
    if (!activeChatId) {
        setSubcollectionMessages([]);
        return;
    }

    const messagesRef = collection(db, 'chats', activeChatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Message[];
        setSubcollectionMessages(msgs);
    }, (error) => {
        console.error("Error fetching subcollection messages:", error);
    });

    return () => unsubscribe();
  }, [activeChatId]);

  // Merge Legacy Array Messages with New Subcollection Messages
  const allMessages = useMemo(() => {
     const legacyMessages = selectedChat?.messages || [];
     // Create a map to deduplicate by ID if necessary (handling migration overlap)
     const messageMap = new Map();
     
     legacyMessages.forEach(m => messageMap.set(m.id || m.timestamp, m));
     subcollectionMessages.forEach(m => messageMap.set(m.id || m.timestamp, m));
     
     const combined = Array.from(messageMap.values());
     return combined.sort((a, b) => a.timestamp - b.timestamp);
  }, [selectedChat?.messages, subcollectionMessages]);

  // 1. Mark messages as READ when opening chat (Legacy & New)
  useEffect(() => {
    if (activeChatId && selectedChat) {
      // Logic for Legacy Array (Can only read, keeping update for consistency if possible)
      const hasUnreadLegacy = selectedChat.messages.some(m => m.senderId !== user.id && m.status !== 'read');
      
      if (hasUnreadLegacy) {
         const updatedMessages = selectedChat.messages.map(m => {
             if (m.senderId !== user.id && m.status !== 'read') {
                 return { ...m, status: 'read' };
             }
             return m;
         });
         // Try to update legacy array (might fail if doc full, but less critical than sending)
         updateDoc(doc(db, 'chats', activeChatId), {
             messages: updatedMessages
         }).catch(err => console.warn("Could not mark legacy messages read:", err));
      }
    }
  }, [activeChatId, selectedChat?.messages.length]);

  // 2. Fetch Online Status of Other User
  useEffect(() => {
     if (otherParticipantId) {
        getDoc(doc(db, 'users', otherParticipantId)).then(snap => {
            if (snap.exists()) setOtherUserOnline(snap.data().isOnline || false);
        });
     }
  }, [otherParticipantId]);

  // 3. Scroll to bottom
  useEffect(() => {
    if (allMessages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allMessages, activeChatId]);

  // 4. Handle Typing
  const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setNewMessage(e.target.value);
      
      if (!activeChatId) return;

      if (!typing) {
          setTyping(true);
          updateDoc(doc(db, 'chats', activeChatId), { [`typing.${user.id}`]: true }).catch(() => {});
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      typingTimeoutRef.current = setTimeout(() => {
          setTyping(false);
          updateDoc(doc(db, 'chats', activeChatId), { [`typing.${user.id}`]: false }).catch(() => {});
      }, 2000);
  };

  const handleSendMessage = (e?: React.FormEvent, attachment?: Message['attachment']) => {
    if (e) e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !activeChatId || theyBlockedMe) return;

    const msg: Message = {
      id: crypto.randomUUID(),
      senderId: user.id,
      senderName: user.name,
      text: newMessage,
      timestamp: Date.now(),
      status: 'sent',
      attachment
    };

    onSendMessage(activeChatId, msg);
    setNewMessage('');
    setTyping(false);
    updateDoc(doc(db, 'chats', activeChatId), { [`typing.${user.id}`]: false }).catch(() => {});
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeChatId && !theyBlockedMe) {
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

  const filteredChats = chats.filter(c => 
      c.itemTitle.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-[calc(100vh-160px)] bg-white dark:bg-slate-900 rounded-[2rem] shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden border border-slate-100 dark:border-slate-800 flex relative">
      
      {/* Lightbox */}
      {lightboxImg && (
          <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
              <button className="absolute top-5 right-5 text-white p-2 rounded-full bg-white/10 hover:bg-white/20"><X className="w-8 h-8" /></button>
              <img src={lightboxImg} className="max-h-full max-w-full rounded-md shadow-2xl" onClick={e => e.stopPropagation()} />
          </div>
      )}

      {/* Sidebar - Chat List */}
      <div className={`w-full md:w-80 border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 z-10">
          <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Messages</h2>
              <button onClick={onBack} className="p-2 text-slate-400 hover:text-brand-violet transition-colors rounded-full hover:bg-off-white dark:hover:bg-slate-800" title="Back to Dashboard">
                 <Home className="w-5 h-5" />
              </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..." 
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-off-white dark:bg-slate-950 border-none outline-none focus:ring-0 text-sm font-medium transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {filteredChats.map(chat => {
            const isTyping = chat.typing && Object.entries(chat.typing).some(([uid, typing]) => uid !== user.id && typing);
            return (
                <div 
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-2 border border-transparent ${
                    activeChatId === chat.id 
                    ? 'bg-indigo-50 dark:bg-slate-800 shadow-sm border-indigo-100 dark:border-slate-700' 
                    : 'hover:bg-off-white dark:hover:bg-slate-800/50'
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
                    {chat.type === 'global' && <div className="absolute -top-1 -left-1 bg-amber-400 rounded-full p-1 border-2 border-white dark:border-slate-900 shadow-sm"><Pin className="w-2 h-2 text-white fill-white" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                        <h3 className={`font-bold text-sm truncate ${activeChatId === chat.id ? 'text-brand-violet dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>
                        {chat.itemTitle}
                        </h3>
                        <span className="text-[10px] font-medium text-slate-400">{formatTime(chat.lastMessageTime)}</span>
                    </div>
                    <p className="text-xs truncate text-slate-500 font-medium flex items-center gap-1">
                        {isTyping ? (
                            <span className="text-brand-violet animate-pulse font-bold">Typing...</span>
                        ) : chat.isBlocked ? (
                        <span className="text-red-500 flex items-center gap-1"><ShieldBan className="w-3 h-3" /> Blocked</span>
                        ) : (
                        chat.lastMessage
                        )}
                    </p>
                    </div>
                </div>
                </div>
            );
          })}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-off-white/50 dark:bg-slate-950/50 ${!activeChatId ? 'hidden md:flex' : 'flex'} relative`}>
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
                         <ShieldBan className="w-3 h-3" /> Conversation Halted
                       </span>
                     ) : (
                       isGlobal ? (
                          <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide flex items-center gap-1">
                             <Users className="w-3 h-3" /> Community
                          </span>
                       ) : (
                          <>
                           <span className={`w-2 h-2 rounded-full ${otherUserOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                           <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{otherUserOnline ? 'Online' : 'Offline'}</span>
                          </>
                       )
                     )}
                   </div>
                 </div>
               </div>
               
               <div className="flex gap-2">
                 {!isGlobal && (
                    <>
                        <button 
                            onClick={() => onBlockChat(selectedChat.id)} 
                            className={`p-2.5 rounded-full transition-colors ${
                                iBlockedThem 
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100' 
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-red-500'
                            }`}
                            title={iBlockedThem ? "Unblock User" : "Block User"}
                        >
                            {iBlockedThem ? <ShieldCheck className="w-5 h-5" /> : <ShieldBan className="w-5 h-5" />}
                        </button>
                        <button 
                            onClick={() => {
                                if(window.confirm("Remove this chat from your list? History will be kept for the other user.")) 
                                onDeleteChat(selectedChat.id);
                            }}
                            className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-red-500 transition-colors"
                            title="Delete Chat"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </>
                 )}
               </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {allMessages.map((msg, idx) => {
                const isMe = msg.senderId === user.id;
                const showSender = isGlobal && !isMe;
                
                return (
                  <div key={msg.id || idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                      {showSender && (
                        <span className="text-[10px] font-bold text-slate-400 mb-1 ml-1">{msg.senderName || 'Student'}</span>
                      )}

                      {msg.attachment && (
                        <div className={`mb-2 rounded-2xl overflow-hidden border shadow-sm cursor-pointer ${isBlocked ? 'opacity-50 grayscale' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`} onClick={() => msg.attachment?.type === 'image' && setLightboxImg(msg.attachment.url)}>
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
                         <div className={`px-5 py-3 text-sm font-medium leading-relaxed rounded-[1.25rem] shadow-sm relative ${
                           isMe 
                             ? (isBlocked ? 'bg-slate-400 text-white rounded-br-sm' : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-sm shadow-indigo-500/20')
                             : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-800 rounded-bl-sm'
                         }`}>
                           {msg.text}
                         </div>
                      )}
                      
                      <div className="flex items-center gap-1.5 mt-1 px-1">
                        <span className="text-[9px] font-bold text-slate-400 opacity-80">{formatTime(msg.timestamp)}</span>
                        {isMe && !isGlobal && (
                             msg.status === 'read' ? <CheckCheck className="w-3 h-3 text-brand-violet" /> : <Check className="w-3 h-3 text-slate-400" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {/* Typing Indicator Bubble */}
              {selectedChat.typing && Object.entries(selectedChat.typing).some(([uid, typing]) => uid !== user.id && typing) && (
                  <div className="flex justify-start animate-fade-in">
                      <div className="bg-white dark:bg-slate-900 px-4 py-3 rounded-[1.25rem] rounded-bl-sm border border-slate-100 dark:border-slate-800 flex gap-1">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                      </div>
                  </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {theyBlockedMe ? (
              <div className="p-6 bg-off-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-center shrink-0">
                 <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-bold border border-red-100 dark:border-red-900/30">
                     <ShieldBan className="w-4 h-4" /> You cannot reply to this conversation
                 </div>
              </div>
            ) : (
              <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shrink-0">
                  <form onSubmit={(e) => handleSendMessage(e)} className="flex items-end gap-3 max-w-4xl mx-auto">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-brand-violet transition-colors">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    
                    <div className="flex-1 bg-off-white dark:bg-slate-950 rounded-2xl flex items-center border border-transparent focus-within:ring-2 focus-within:ring-brand-violet/20 transition-all">
                       <textarea
                        value={newMessage}
                        onChange={handleTyping}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage(e)}
                        placeholder={iBlockedThem ? "Unblock to send message..." : "Type a message..."}
                        disabled={iBlockedThem}
                        className="w-full max-h-32 px-5 py-3.5 bg-transparent border-none focus:ring-0 outline-none text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                        rows={1}
                      />
                    </div>

                    {iBlockedThem ? (
                        <button 
                            type="button"
                            onClick={() => onBlockChat(selectedChat.id)}
                            className="p-3.5 bg-slate-200 dark:bg-slate-800 text-slate-500 rounded-2xl font-bold text-xs"
                        >
                            Unblock
                        </button>
                    ) : (
                        <button 
                            type="submit"
                            disabled={!newMessage.trim()}
                            className="p-3.5 bg-brand-violet text-white rounded-2xl hover:bg-[#4f4dbd] transition-all disabled:opacity-50 shadow-lg shadow-brand-violet/30 transform active:scale-95"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    )}
                  </form>
                </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 p-8">
            <div className="w-20 h-20 bg-white dark:bg-slate-900 rounded-full flex items-center justify-center mb-6 ring-4 ring-off-white dark:ring-slate-800">
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
