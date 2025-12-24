
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Chat, User, Message } from '../types';
import { Send, Search, ArrowLeft, MessageCircle, Check, CheckCheck, Paperclip, File, ShieldBan, ShieldCheck, Lock, Globe, Users, Trash2, Home, X, Pin, ChevronDown, Clock } from 'lucide-react';
import { db, FieldValue } from '../services/firebase';
import { uploadImage } from '../services/cloudinary';

interface ChatViewProps {
  user: User;
  onBack: () => void;
  onNotification: (title: string, body: string) => void;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string | null) => void;
  onBlockChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
}

const ChatView: React.FC<ChatViewProps> = ({ user, onBack, onNotification, chats, activeChatId, onSelectChat, onBlockChat, onDeleteChat }) => {
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  
  // Enhanced Online/Last Seen State
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [otherUserLastSeen, setOtherUserLastSeen] = useState<number | null>(null);
  
  const [subcollectionMessages, setSubcollectionMessages] = useState<Message[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const selectedChat = chats.find(c => c.id === activeChatId);
  const isGlobal = selectedChat?.type === 'global';
  
  // Logic to determine if blocked and by whom
  const isBlocked = selectedChat?.isBlocked || false;
  const iBlockedThem = selectedChat?.blockedBy === user.id;
  const theyBlockedMe = isBlocked && !iBlockedThem;

  const otherParticipantId = useMemo(() => {
     return selectedChat?.participants.find(p => p !== user.id);
  }, [selectedChat, user.id]);

  // 0. Listen to Subcollection Messages
  useEffect(() => {
    if (!activeChatId) {
        setSubcollectionMessages([]);
        return;
    }

    // Explicitly clear messages when ID changes to prevent stale data usage in other effects
    setSubcollectionMessages([]);

    const messagesRef = db.collection('chats').doc(activeChatId).collection('messages');
    const q = messagesRef.orderBy('timestamp', 'asc');

    const unsubscribe = q.onSnapshot((snapshot) => {
        const msgs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Message[];
        setSubcollectionMessages(msgs);
    }, (error) => {
        console.error("Error fetching subcollection messages:", error);
    });

    return () => {
        unsubscribe();
        setSubcollectionMessages([]); // Ensure cleanup to avoid race conditions
    };
  }, [activeChatId]);

  // Merge Legacy Array Messages with New Subcollection Messages
  const allMessages = useMemo(() => {
     const legacyMessages = selectedChat?.messages || [];
     const messageMap = new Map();
     
     legacyMessages.forEach(m => messageMap.set(m.id || m.timestamp, m));
     subcollectionMessages.forEach(m => messageMap.set(m.id || m.timestamp, m));
     
     const combined = Array.from(messageMap.values());
     return combined.sort((a, b) => a.timestamp - b.timestamp);
  }, [selectedChat?.messages, subcollectionMessages]);

  // 1. Mark messages as READ
  useEffect(() => {
    if (activeChatId && subcollectionMessages.length > 0) {
       const unreadDocs = subcollectionMessages.filter(m => m.senderId !== user.id && m.status !== 'read');
       
       if (unreadDocs.length > 0) {
           const batch = db.batch();
           unreadDocs.forEach(msg => {
               if (msg.id) {
                   const docRef = db.collection('chats').doc(activeChatId).collection('messages').doc(msg.id);
                   batch.update(docRef, { status: 'read' });
               }
           });
           
           // Update parent chat doc
           const chatRef = db.collection('chats').doc(activeChatId);
           batch.update(chatRef, { unreadCount: 0 });

           batch.commit().catch(e => {
               // Ignore "No document to update" errors which happen during rapid switching
               if (!e.message?.includes('No document to update')) {
                   console.error("Error marking read:", e);
               }
           });
       }
    }
  }, [activeChatId, subcollectionMessages, user.id]);

  // 2. Fetch Online Status & Last Seen
  useEffect(() => {
     if (!otherParticipantId || isGlobal) {
        setOtherUserOnline(false);
        setOtherUserLastSeen(null);
        return;
     }
     
     const userRef = db.collection('users').doc(otherParticipantId);
     const unsubscribe = userRef.onSnapshot((snap) => {
        if (snap.exists) {
            const data = snap.data();
            setOtherUserOnline(data?.isOnline || false);
            setOtherUserLastSeen(data?.lastSeen || null);
        } else {
            setOtherUserOnline(false);
            setOtherUserLastSeen(null);
        }
     });

     return () => unsubscribe();
  }, [otherParticipantId, isGlobal]);

  // 3. Scroll Logic
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (allMessages.length > 0) {
      // Auto-scroll if near bottom or if new message just arrived
      const container = scrollContainerRef.current;
      if (container) {
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 400;
          if (isNearBottom) {
              scrollToBottom();
          }
      } else {
          scrollToBottom();
      }
    }
  }, [allMessages.length, activeChatId]);

  const handleScroll = () => {
      const container = scrollContainerRef.current;
      if (container) {
          const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
          setShowScrollButton(distanceToBottom > 300);
      }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setNewMessage(e.target.value);
  };

  const handleSendMessage = async (e?: React.FormEvent, attachment?: Message['attachment']) => {
    if (e) e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !activeChatId || theyBlockedMe) return;

    const textToSend = newMessage;
    setNewMessage('');

    const timestamp = Date.now();
    const msgData: any = {
      senderId: user.id,
      senderName: user.name,
      text: textToSend,
      timestamp: timestamp,
      status: 'sent',
    };

    if (attachment) {
      msgData.attachment = attachment;
    }

    try {
      const messagesRef = db.collection('chats').doc(activeChatId).collection('messages');
      await messagesRef.add(msgData);

      const chatRef = db.collection('chats').doc(activeChatId);
      // Increment unread count for the recipient. 
      await chatRef.update({
        lastMessage: attachment ? (attachment.type === 'image' ? 'Sent a photo' : 'Sent a file') : textToSend,
        lastMessageTime: timestamp,
        deletedIds: [],
        unreadCount: FieldValue.increment(1) 
      });
      
      setTimeout(scrollToBottom, 100);
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send message. Please check your connection.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeChatId && !theyBlockedMe) {
       try {
         const secureUrl = await uploadImage(file);
         handleSendMessage(undefined, {
           type: file.type.startsWith('image/') ? 'image' : 'file',
           url: secureUrl
         });
       } catch (error) {
         console.error("Failed to upload file:", error);
         alert("Failed to upload attachment.");
       }
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateLabel = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatLastSeen = (timestamp: number) => {
      const diff = Date.now() - timestamp;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return 'a while ago';
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
                        {chat.isBlocked ? (
                        <span className="text-red-500 flex items-center gap-1"><ShieldBan className="w-3 h-3" /> Blocked</span>
                        ) : (
                        chat.lastMessage
                        )}
                        {chat.unreadCount > 0 && activeChatId !== chat.id && (
                           <span className="ml-auto w-4 h-4 rounded-full bg-brand-violet text-white text-[9px] font-bold flex items-center justify-center">
                             {chat.unreadCount}
                           </span>
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
                           <span className={`w-2 h-2 rounded-full ${otherUserOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`}></span>
                           <span className={`text-[10px] font-bold uppercase tracking-wide ${otherUserOnline ? 'text-emerald-500' : 'text-slate-500'}`}>
                             {otherUserOnline ? 'Online' : (otherUserLastSeen ? `Active ${formatLastSeen(otherUserLastSeen)}` : 'Offline')}
                           </span>
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

            {/* Messages Area */}
            <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col relative scroll-smooth">
              
              {allMessages.map((msg, idx) => {
                const isMe = msg.senderId === user.id;
                
                // --- STACKING LOGIC ---
                const prevMsg = allMessages[idx - 1];
                const nextMsg = allMessages[idx + 1];

                // Group if same sender + within 3 minutes
                const isSameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId;
                const isWithinTimeWindow = prevMsg && (msg.timestamp - prevMsg.timestamp < 3 * 60 * 1000); 
                const isGrouped = isSameSenderAsPrev && isWithinTimeWindow;

                // Determine if it's the last message in a visual group
                const isSameSenderAsNext = nextMsg && nextMsg.senderId === msg.senderId;
                const isWithinTimeWindowNext = nextMsg && (nextMsg.timestamp - msg.timestamp < 3 * 60 * 1000);
                const isLastInGroup = !isSameSenderAsNext || !isWithinTimeWindowNext;

                const showDateSeparator = !prevMsg || new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString();
                const showSender = isGlobal && !isMe && !isGrouped; 
                
                // Styles
                const marginTop = isGrouped ? 'mt-0.5' : 'mt-4';
                const bubbleRadius = isMe 
                  ? 'rounded-2xl rounded-tr-sm' 
                  : 'rounded-2xl rounded-tl-sm';

                return (
                  <React.Fragment key={msg.id || idx}>
                    {showDateSeparator && (
                       <div className="flex justify-center my-6 sticky top-0 z-10">
                          <span className="px-3 py-1 bg-slate-200/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-full text-[10px] font-bold text-slate-500 dark:text-slate-400 shadow-sm">
                             {formatDateLabel(msg.timestamp)}
                          </span>
                       </div>
                    )}
                  
                    <div className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} ${marginTop}`}>
                      <div className={`flex flex-col max-w-[80%] md:max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                        {showSender && (
                          <span className="text-[10px] font-bold text-slate-400 mb-1 ml-1">{msg.senderName || 'Student'}</span>
                        )}

                        {msg.attachment && (
                          <div className={`mb-1 rounded-2xl overflow-hidden border shadow-sm cursor-pointer ${isBlocked ? 'opacity-50 grayscale' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`} onClick={() => msg.attachment?.type === 'image' && setLightboxImg(msg.attachment.url)}>
                              {msg.attachment.type === 'image' ? (
                                <img 
                                   src={msg.attachment.url} 
                                   className="max-w-full max-h-60 object-cover" 
                                   onLoad={() => scrollToBottom()} // Ensure scroll on load
                                />
                              ) : (
                                <div className="p-4 bg-white dark:bg-slate-800 flex items-center gap-3">
                                  <File className="w-8 h-8 text-brand-violet" />
                                  <span className="text-xs font-bold">Attachment</span>
                                </div>
                              )}
                          </div>
                        )}
                        
                        {msg.text && (
                          <div className={`px-4 py-2 sm:px-5 sm:py-2.5 text-sm font-medium leading-relaxed shadow-sm relative break-words ${bubbleRadius} ${
                            isMe 
                              ? (isBlocked ? 'bg-slate-400 text-white' : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-indigo-500/20')
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-800'
                          }`}>
                            {msg.text}
                          </div>
                        )}
                        
                        {/* Status/Time - Only show for last message in sequence */}
                        {isLastInGroup && (
                            <div className={`flex items-center gap-1.5 mt-1 px-1 opacity-70 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                            <span className="text-[9px] font-bold text-slate-400">{formatTime(msg.timestamp)}</span>
                            {isMe && !isGlobal && (
                                msg.status === 'read' 
                                ? <CheckCheck className="w-3 h-3 text-brand-violet" /> 
                                : <CheckCheck className="w-3 h-3 text-slate-300" />
                            )}
                            </div>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              
              <div ref={messagesEndRef} />
              
              {/* Scroll To Bottom Button */}
              {showScrollButton && (
                  <button 
                    onClick={scrollToBottom}
                    className="fixed bottom-24 right-6 md:absolute md:bottom-6 md:right-6 p-2 bg-slate-900/80 dark:bg-white/90 text-white dark:text-slate-900 rounded-full shadow-xl hover:scale-110 transition-transform z-20 backdrop-blur-md"
                  >
                     <ChevronDown className="w-5 h-5" />
                  </button>
              )}
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
