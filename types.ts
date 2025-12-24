
export enum ItemCategory {
  ELECTRONICS = 'Electronics',
  STATIONERY = 'Stationery',
  CLOTHING = 'Clothing',
  ACCESSORIES = 'Accessories',
  ID_CARDS = 'ID Cards',
  BOOKS = 'Books',
  OTHER = 'Other'
}

export enum ReportType {
  LOST = 'LOST',
  FOUND = 'FOUND'
}

export interface User {
  id: string;
  name: string;
  email: string;
  studentId?: string;
  avatar?: string;
  department?: string;
  isVerified: boolean;
  isOnline?: boolean;
  lastSeen?: number;
}

export interface GeminiAnalysisResult {
  category: ItemCategory;
  title: string;
  summary: string;
  tags: string[];
  description: string;
  distinguishingFeatures: string[];
  specs?: Record<string, string>; // New structured data
  isPrank: boolean;
  prankReason?: string;
  isEmergency?: boolean; // For "Lost Person" reports
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK'; 
  // New Safety Fields
  isViolating: boolean;
  violationType?: 'GORE' | 'ANIMAL' | 'HUMAN' | 'IRRELEVANT' | 'INCONSISTENT' | 'NONE';
  violationReason?: string;
}

export interface ItemReport {
  id: string;
  type: ReportType;
  title: string;
  summary?: string; // AI generated short summary
  description: string;
  distinguishingFeatures?: string[];
  specs?: Record<string, string>; // Stored structured data (e.g. { brand: "Apple", model: "iPhone 13" })
  category: ItemCategory;
  location: string;
  date: string;
  time: string; 
  imageUrls: string[];
  tags: string[];
  status: 'OPEN' | 'RESOLVED';
  reporterId: string;
  reporterName: string;
  createdAt: number;
}

export type ViewState = 'AUTH' | 'DASHBOARD' | 'REPORT_LOST' | 'REPORT_FOUND' | 'MESSAGES' | 'PROFILE' | 'COMPARATOR' | 'FEATURES';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'match' | 'message' | 'system';
  timestamp: number;
  isRead: boolean;
  link?: ViewState;
  metadata?: {
    matchId?: string;
    sourceId?: string;
  };
}

export interface Message {
  id: string;
  senderId: string;
  senderName?: string; // Added for Global Chat context
  text: string;
  timestamp: number;
  status?: 'sent' | 'read'; 
  attachment?: {
    type: 'image' | 'video' | 'file';
    url: string;
  };
}

export interface Chat {
  id: string;
  type: 'direct' | 'global'; // Added to distinguish chat types
  itemId?: string;
  itemTitle: string;
  itemImage?: string;
  participants: string[];
  messages: Message[];
  lastMessage: string;
  lastMessageTime: number;
  lastSenderId?: string; // Added to track who sent the last message for notifications
  unreadCount: number;
  isBlocked?: boolean;
  blockedBy?: string;
  typing?: Record<string, boolean>; // userId -> isTyping
  deletedIds?: string[]; // IDs of users who deleted this chat (soft delete)
}