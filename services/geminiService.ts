import { GoogleGenAI, Type } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";

// --- TYPES ---
export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

// --- CONFIGURATION: THE GEMINI GAUNTLET ---
// Strict Cascade Order requested by user: 3 -> 2.5 -> 2 -> 1.5 -> 1
const MODEL_PIPELINE = [
  'gemini-3-flash-preview',      // Tier 1: Latest/Fastest
  'gemini-2.5-flash-latest',     // Tier 2: Recent Stable
  'gemini-2.0-flash-exp',        // Tier 3: Experimental 2.0
  'gemini-1.5-flash',            // Tier 4: Standard 1.5 (User requested)
  'gemini-1.0-pro'               // Tier 5: Legacy Fallback
];

const STORAGE_KEY_BANS = 'retriva_model_bans';
const STORAGE_KEY_API_HASH = 'retriva_api_hash';
const BAN_DURATION = 24 * 60 * 60 * 1000; // 24 Hours

// --- HELPER: API KEY ---
const getApiKey = (): string | undefined => {
  // @ts-ignore
  const key = import.meta.env.VITE_API_KEY || import.meta.env.API_KEY;
  // If running in node/process env fallback
  if (!key && typeof process !== 'undefined') {
    return process.env.VITE_API_KEY || process.env.API_KEY;
  }
  return key;
};

// --- HELPER: JSON CLEANER ---
const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  const firstOpen = cleaned.indexOf('{');
  const lastClose = cleaned.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    cleaned = cleaned.substring(firstOpen, lastClose + 1);
  }
  return cleaned.trim();
};

// --- MODEL MANAGER CLASS ---
class ModelManager {
  private bannedModels: Record<string, number> = {};

  constructor() {
    this.checkApiKeyAndLoadBans();
  }

  // Generate a simple hash of the API key to detect changes
  private hashKey(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  private checkApiKeyAndLoadBans() {
    const currentKey = getApiKey();
    if (!currentKey) return;

    const currentHash = this.hashKey(currentKey);
    const storedHash = localStorage.getItem(STORAGE_KEY_API_HASH);

    // IF API KEY CHANGED: RESET EVERYTHING
    if (storedHash !== currentHash) {
      console.info("🔑 New API Key detected. Clearing all model bans.");
      localStorage.setItem(STORAGE_KEY_API_HASH, currentHash);
      localStorage.removeItem(STORAGE_KEY_BANS);
      this.bannedModels = {};
      return;
    }

    // Load existing bans
    try {
      const stored = localStorage.getItem(STORAGE_KEY_BANS);
      if (stored) {
        this.bannedModels = JSON.parse(stored);
        
        // Clean up expired bans immediately on load
        const now = Date.now();
        let changed = false;
        Object.keys(this.bannedModels).forEach(model => {
          if (now > this.bannedModels[model]) {
            delete this.bannedModels[model];
            changed = true;
          }
        });
        if (changed) this.saveBans();
      }
    } catch (e) {
      console.warn("Failed to load model bans", e);
    }
  }

  private saveBans() {
    localStorage.setItem(STORAGE_KEY_BANS, JSON.stringify(this.bannedModels));
  }

  public banModel(model: string) {
    console.warn(`⛔ BANNING MODEL: ${model} for 24 hours (Quota Exceeded).`);
    this.bannedModels[model] = Date.now() + BAN_DURATION;
    this.saveBans();
  }

  public getAvailableModels(): string[] {
    const now = Date.now();
    return MODEL_PIPELINE.filter(model => {
      const banTime = this.bannedModels[model];
      if (!banTime) return true; // Not banned
      if (now > banTime) {
        // Ban expired
        delete this.bannedModels[model];
        this.saveBans();
        return true;
      }
      return false; // Still banned
    });
  }
}

const modelManager = new ModelManager();

// --- CORE GENERATION FUNCTION ---
const generateWithGauntlet = async (params: any, systemInstruction?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("MISSING_API_KEY");

  const pipeline = modelManager.getAvailableModels();

  if (pipeline.length === 0) {
    // Dispatch event to notify UI that we are totally out of ammo
    if (typeof window !== 'undefined') {
        const event = new CustomEvent('retriva-toast', { 
            detail: { 
                message: "All AI models exhausted for today. Please try again in 24h.", 
                type: 'alert' 
            } 
        });
        window.dispatchEvent(event);
    }
    throw new Error("ALL_MODELS_EXHAUSTED_24H");
  }

  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;

  for (const model of pipeline) {
    try {
      // Clean config (remove unsupported fields if jumping between model generations)
      const config = { ...params.config };
      delete config.thinkingConfig; // Ensure stability across different model tiers
      
      // Inject system instruction if provided (and not already in contents)
      if (systemInstruction) {
         config.systemInstruction = systemInstruction;
      }

      // console.log(`🚀 Trying Model: ${model}`); // Debug log

      const response = await ai.models.generateContent({
        ...params,
        model,
        config
      });

      return response.text || "";

    } catch (error: any) {
      const msg = (error.message || "").toLowerCase();
      
      // CHECK FOR QUOTA LIMITS (429)
      // This is the "Death Note" check
      if (msg.includes("429") || msg.includes("quota") || msg.includes("exhausted") || msg.includes("resource")) {
        modelManager.banModel(model); // PERMANENT BAN (24h)
        continue; // Immediate switch to next model
      }
      
      // CHECK FOR OVERLOAD (503) - Don't ban, just skip this time
      if (msg.includes("503") || msg.includes("overloaded")) {
        console.warn(`⚠️ Model ${model} overloaded. Skipping temporarily.`);
        lastError = error;
        continue;
      }

      // Other errors (Safety, Invalid Request)
      console.warn(`❌ Model ${model} error: ${msg}`);
      lastError = error;
      // Depending on the error, we might want to fail hard or try next.
      // For safety blocks, trying another model rarely helps, but let's be resilient:
      continue; 
    }
  }

  throw lastError || new Error("All available models failed.");
};


// --- EXPORTED FEATURES (API) ---

export const instantImageCheck = async (base64Image: string): Promise<{ 
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK';
  isPrank: boolean;
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN' | 'NONE';
  reason: string;
}> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `SYSTEM: Security Scan. Analyze image for violations (GORE, NUDITY, PRIVACY). Return JSON.` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });

    return JSON.parse(cleanJSON(text));
  } catch (e) {
    console.error(e);
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for Faces, ID Cards, Credit Cards. Return JSON { "regions": [[...]] }` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });

    const data = JSON.parse(cleanJSON(text));
    return data.regions || [];
  } catch (e) {
    return [];
  }
};

export const extractVisualDetails = async (base64Image: string): Promise<{
  title: string;
  category: ItemCategory;
  tags: string[];
  color: string;
  brand: string;
  condition: string;
  distinguishingFeatures: string[];
}> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `Analyze for Lost & Found. Extract: title, category (${Object.values(ItemCategory).join(',')}), tags, color, brand, condition, distinguishingFeatures. Return JSON.` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(cleanJSON(text));
  } catch (e) {
    return { 
      title: "", category: ItemCategory.OTHER, tags: [], 
      color: "", brand: "", condition: "", distinguishingFeatures: [] 
    };
  }
};

export const mergeDescriptions = async (userContext: string, visualData: any): Promise<string> => {
  try {
    const text = await generateWithGauntlet({
      contents: {
        parts: [{ text: `Merge visual data (${JSON.stringify(visualData)}) with user context ("${userContext}") into a concise Lost & Found item description.` }]
      }
    }, "You are a helpful copywriter.");
    return text || userContext;
  } catch (e) {
    return userContext;
  }
};

export const analyzeItemDescription = async (
  description: string,
  base64Images: string[] = [],
  title: string = ""
): Promise<GeminiAnalysisResult> => {
  try {
    const parts: any[] = [{ text: `Analyze item: "${title} - ${description}". JSON output: isViolating (bool), violationType, category, summary, tags.` }];
    
    base64Images.forEach(img => {
      const data = img.split(',')[1] || img;
      if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    });

    const text = await generateWithGauntlet({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    }, "You are a content moderator and classifier.");

    const result = JSON.parse(cleanJSON(text));
    return {
      isViolating: result.isViolating || false,
      violationType: result.violationType || 'NONE',
      violationReason: result.violationReason || '',
      isPrank: false,
      category: result.category || ItemCategory.OTHER,
      title: result.title || title,
      description: result.description || description,
      summary: result.summary || description.substring(0, 50),
      tags: result.tags || [],
      distinguishingFeatures: result.distinguishingFeatures || [],
      faceStatus: 'NONE'
    };
  } catch (error) {
    return { 
      isViolating: false, isPrank: false, category: ItemCategory.OTHER, 
      title: title || "Item", description, distinguishingFeatures: [], summary: "", tags: [], faceStatus: 'NONE'
    } as any;
  }
};

export const parseSearchQuery = async (query: string): Promise<{ userStatus: 'LOST' | 'FOUND' | 'NONE'; refinedQuery: string }> => {
  try {
    const text = await generateWithGauntlet({
      contents: { parts: [{ text: `Analyze query: "${query}". Return JSON: userStatus (LOST/FOUND/NONE), refinedQuery (keywords).` }] }
    }, "You are a search intent analyzer.");
    return JSON.parse(cleanJSON(text));
  } catch (e) {
    return { userStatus: 'NONE', refinedQuery: query };
  }
};

export const findPotentialMatches = async (
  query: { description: string; imageUrls: string[] },
  candidates: ItemReport[]
): Promise<{ id: string }[]> => {
  if (candidates.length === 0) return [];
  try {
    const candidateList = candidates.map(c => ({ id: c.id, t: c.title, d: c.description, c: c.category }));
    
    const parts: any[] = [{ text: `Find matches for "${query.description}" in: ${JSON.stringify(candidateList)}. Return JSON { "matches": [{ "id": "..." }] }.` }];
    
    if (query.imageUrls[0]) {
       const data = query.imageUrls[0].split(',')[1];
       if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }

    const text = await generateWithGauntlet({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    }, "You are a matching engine.");

    const data = JSON.parse(cleanJSON(text));
    return data.matches || [];
  } catch (e) {
    console.error("Match error", e);
    return [];
  }
};

export const compareItems = async (itemA: ItemReport, itemB: ItemReport): Promise<ComparisonResult> => {
  try {
    const parts: any[] = [{ text: `Compare Item A (${itemA.title}) vs Item B (${itemB.title}). Return JSON: confidence (0-100), explanation, similarities (array), differences (array).` }];
    
    const images = [itemA.imageUrls[0], itemB.imageUrls[0]].filter(Boolean);
    images.forEach(img => {
      const data = img.split(',')[1];
      if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    });

    const text = await generateWithGauntlet({
       contents: { parts },
       config: { responseMimeType: "application/json" }
    }, "You are a forensic analyst.");
    
    return JSON.parse(cleanJSON(text));
  } catch (e) {
    return { confidence: 0, explanation: "Comparison unavailable.", similarities: [], differences: [] };
  }
};