import { GoogleGenAI, Type } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport, ReportType } from "../types";

// --- TYPES ---
export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

// --- CONFIGURATION ---
const MODEL_PIPELINE = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-image',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
];

const CACHE_PREFIX = 'retriva_ai_cache_';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 Hours

// --- CACHE MANAGER ---
const CacheManager = {
  async generateKey(data: any): Promise<string> {
    try {
      const msgBuffer = new TextEncoder().encode(JSON.stringify(data));
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fallback for non-secure contexts (though unlikely in modern React apps)
      return 'fallback_' + JSON.stringify(data).length + '_' + Date.now();
    }
  },

  get<T>(key: string): T | null {
    try {
      const itemStr = localStorage.getItem(CACHE_PREFIX + key);
      if (!itemStr) return null;
      
      const item = JSON.parse(itemStr);
      if (Date.now() > item.expiry) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      // console.log(`⚡ Cache Hit: ${key.substring(0, 8)}...`);
      return item.value;
    } catch (e) {
      return null;
    }
  },

  set(key: string, value: any) {
    try {
      const item = { value, expiry: Date.now() + CACHE_EXPIRY };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(item));
    } catch (e) {
      console.warn("Cache quota exceeded. Pruning...");
      this.prune(true);
      try {
         localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, expiry: Date.now() + CACHE_EXPIRY }));
      } catch (e2) {}
    }
  },

  prune(forceFreeSpace = false) {
    const now = Date.now();
    const entries: { key: string, expiry: number }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        try {
          const item = JSON.parse(localStorage.getItem(key) || '{}');
          if (!item.expiry || now > item.expiry) {
            localStorage.removeItem(key);
          } else {
            entries.push({ key, expiry: item.expiry });
          }
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
    }

    if (forceFreeSpace && entries.length > 0) {
      // Sort by expiry (soonest to expire first) and remove oldest 30%
      entries.sort((a, b) => a.expiry - b.expiry);
      const toRemove = Math.ceil(entries.length * 0.3);
      entries.slice(0, toRemove).forEach(e => localStorage.removeItem(e.key));
    }
  }
};

// Initialize cleanup
if (typeof window !== 'undefined') {
  setTimeout(() => CacheManager.prune(), 5000);
}

// --- HELPER: API KEY ---
const getApiKey = (): string | undefined => {
  // @ts-ignore
  const key = import.meta.env.VITE_API_KEY || import.meta.env.API_KEY;
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

// --- HELPER: DATE PARSER ---
const parseDateVal = (dateStr: string): number => {
    if (!dateStr) return 0;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
    }
    return new Date(dateStr).getTime();
};

// --- MODEL MANAGER CLASS ---
class ModelManager {
  private sessionBans: Set<string> = new Set();
  private temporaryCooldowns: Map<string, number> = new Map();

  public banModel(model: string, reason: string) {
    console.warn(`⛔ Banning model ${model} for session: ${reason}`);
    this.sessionBans.add(model);
  }

  public markModelBusy(model: string) {
    const cooldownDuration = 60000;
    console.warn(`❄️ Cooling down ${model} for ${cooldownDuration/1000}s due to Rate Limiting.`);
    this.temporaryCooldowns.set(model, Date.now() + cooldownDuration);
  }

  public getAvailableModels(): string[] {
    const now = Date.now();
    let candidates = MODEL_PIPELINE.filter(model => !this.sessionBans.has(model));
    const ready = candidates.filter(model => {
        const expiry = this.temporaryCooldowns.get(model);
        return !expiry || now > expiry;
    });
    if (ready.length === 0 && candidates.length > 0) {
        console.warn("⚠️ All models are currently busy. Ignoring cooldowns to attempt request.");
        return candidates;
    }
    return ready;
  }
}

const modelManager = new ModelManager();

// --- HELPER: DELAY ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- CORE GENERATION FUNCTION ---
const generateWithGauntlet = async (params: any, systemInstruction?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("MISSING_API_KEY");

  const ai = new GoogleGenAI({ apiKey });
  const pipeline = modelManager.getAvailableModels();
  
  if (pipeline.length === 0) {
     throw new Error("No available models. Please check your API Key permissions.");
  }

  let lastError: any = null;

  for (const model of pipeline) {
    let retries = 0;
    const MAX_RETRIES = 1;

    while (retries <= MAX_RETRIES) {
        try {
            const config = { ...params.config };
            delete config.thinkingConfig;
            
            if (systemInstruction) {
                config.systemInstruction = systemInstruction;
            }

            const response = await ai.models.generateContent({
                ...params,
                model,
                config
            });

            return response.text || "";

        } catch (error: any) {
            const msg = (error.message || "").toLowerCase();
            const status = error.status || 0;

            if (status === 404 || msg.includes('not found') || status === 400) {
                modelManager.banModel(model, `Status ${status}: ${msg}`);
                break;
            }

            if (status === 429 || status === 503 || msg.includes('quota') || msg.includes('overloaded')) {
                retries++;
                if (retries <= MAX_RETRIES) {
                    const waitTime = Math.pow(2, retries) * 1000; 
                    console.warn(`⏳ ${model} is busy (429). Retrying in ${waitTime/1000}s...`);
                    await delay(waitTime);
                    continue;
                } else {
                    console.warn(`❌ ${model} exhausted retries. Failing over to next model.`);
                    modelManager.markModelBusy(model);
                    lastError = error;
                    break;
                }
            }

            console.warn(`❌ Error with ${model}: ${msg}`);
            lastError = error;
            break;
        }
    }
  }

  if (typeof window !== 'undefined') {
      const event = new CustomEvent('retriva-toast', { 
          detail: { 
              message: "AI Service is currently high-traffic. Please wait a moment.", 
              type: 'alert' 
          } 
      });
      window.dispatchEvent(event);
  }
  
  throw lastError || new Error("All AI models failed to respond.");
};


// --- EXPORTED FEATURES (API) ---

export const findSmartMatches = async (sourceItem: ItemReport, allReports: ItemReport[]): Promise<ItemReport[]> => {
    // 1. Initial Filter (Logic Funnel)
    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST';
    
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType && 
        r.reporterId !== sourceItem.reporterId
    );

    if (candidates.length === 0) return [];

    // Category
    candidates = candidates.filter(r => r.category === sourceItem.category);
    if (candidates.length === 0) return [];

    // Date
    const sourceTime = parseDateVal(sourceItem.date);
    candidates = candidates.filter(r => {
        const rTime = parseDateVal(r.date);
        return sourceItem.type === 'LOST' ? rTime >= sourceTime : sourceTime >= rTime;
    });
    if (candidates.length === 0) return [];

    console.log(`🔍 Smart Match: Sending ${candidates.length} candidates to AI...`);

    // 2. AI Semantic Search (Wrapped in Logic)
    // We don't cache findSmartMatches directly because 'allReports' changes frequently.
    // Instead we rely on 'findPotentialMatches' caching which is based on the specific candidate set.
    
    const queryDesc = `Title: ${sourceItem.title}. Desc: ${sourceItem.description}. Loc: ${sourceItem.location}.`;
    
    const matches = await findPotentialMatches(
        { description: queryDesc, imageUrls: sourceItem.imageUrls }, 
        candidates
    );

    return candidates.filter(c => matches.some(m => m.id === c.id));
};

export const instantImageCheck = async (base64Image: string): Promise<{ 
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK';
  isPrank: boolean;
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN' | 'NONE';
  reason: string;
}> => {
  const cacheKey = await CacheManager.generateKey({ type: 'imgCheck', data: base64Image });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `SYSTEM: Security Scan. Analyze image for violations. 
            Policies: 1. GORE (bloody) 2. NUDITY 3. PRIVACY (docs). 
            Return JSON: violationType ("GORE","NUDITY","PRIVACY","NONE"), isPrank, reason.
            If safe, violationType="NONE".` 
          },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(cleanJSON(text));
    const result = {
        faceStatus: parsed.faceStatus || 'NONE',
        isPrank: parsed.isPrank || false,
        violationType: parsed.violationType || 'NONE',
        reason: parsed.reason || ''
    };
    
    CacheManager.set(cacheKey, result);
    return result as any;
  } catch (e) {
    console.error("Image Check Failed", e);
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  const cacheKey = await CacheManager.generateKey({ type: 'redact', data: base64Image });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

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
    const regions = data.regions || [];
    CacheManager.set(cacheKey, regions);
    return regions;
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
  const cacheKey = await CacheManager.generateKey({ type: 'visual', data: base64Image });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

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
    
    const parsed = JSON.parse(cleanJSON(text));
    const result = {
        title: parsed.title || "",
        category: parsed.category || ItemCategory.OTHER,
        tags: parsed.tags || [],
        color: parsed.color || "",
        brand: parsed.brand || "",
        condition: parsed.condition || "",
        distinguishingFeatures: parsed.distinguishingFeatures || []
    };
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return { 
      title: "", category: ItemCategory.OTHER, tags: [], 
      color: "", brand: "", condition: "", distinguishingFeatures: [] 
    };
  }
};

export const mergeDescriptions = async (userContext: string, visualData: any): Promise<string> => {
  const cacheKey = await CacheManager.generateKey({ type: 'merge', userContext, visualData });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const text = await generateWithGauntlet({
      contents: {
        parts: [{ text: `Merge visual data (${JSON.stringify(visualData)}) with user context ("${userContext}") into a concise Lost & Found item description.` }]
      }
    }, "You are a helpful copywriter.");
    
    const result = text || userContext;
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return userContext;
  }
};

export const analyzeItemDescription = async (
  description: string,
  base64Images: string[] = [],
  title: string = ""
): Promise<GeminiAnalysisResult> => {
  const cacheKey = await CacheManager.generateKey({ type: 'analyze', description, title, imageHashes: base64Images.map(s => s.length) });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

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

    const resultRaw = JSON.parse(cleanJSON(text));
    const result = {
      isViolating: resultRaw.isViolating || false,
      violationType: resultRaw.violationType || 'NONE',
      violationReason: resultRaw.violationReason || '',
      isPrank: false,
      category: resultRaw.category || ItemCategory.OTHER,
      title: resultRaw.title || title,
      description: resultRaw.description || description,
      summary: resultRaw.summary || description.substring(0, 50),
      tags: resultRaw.tags || [],
      distinguishingFeatures: resultRaw.distinguishingFeatures || [],
      faceStatus: 'NONE'
    };
    
    CacheManager.set(cacheKey, result);
    return result as any;
  } catch (error) {
    return { 
      isViolating: false, isPrank: false, category: ItemCategory.OTHER, 
      title: title || "Item", description, distinguishingFeatures: [], summary: "", tags: [], faceStatus: 'NONE'
    } as any;
  }
};

export const parseSearchQuery = async (query: string): Promise<{ userStatus: 'LOST' | 'FOUND' | 'NONE'; refinedQuery: string }> => {
  const cacheKey = await CacheManager.generateKey({ type: 'search', query });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const text = await generateWithGauntlet({
      contents: { parts: [{ text: `Analyze query: "${query}". Return JSON: userStatus (LOST/FOUND/NONE), refinedQuery (keywords).` }] }
    }, "You are a search intent analyzer.");
    const result = JSON.parse(cleanJSON(text));
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return { userStatus: 'NONE', refinedQuery: query };
  }
};

export const findPotentialMatches = async (
  query: { description: string; imageUrls: string[] },
  candidates: ItemReport[]
): Promise<{ id: string }[]> => {
  if (candidates.length === 0) return [];
  
  // Create a key based on the query AND the candidate set IDs.
  // If candidates change (new items added), the key changes, invalidating cache. Correct behavior.
  const candidateIds = candidates.map(c => c.id).sort().join(',');
  const cacheKey = await CacheManager.generateKey({ type: 'match', query, candidateIds });
  
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    // Increased to 30 to capture more candidates in one pass since Gemini Flash has large context
    const candidateList = candidates.slice(0, 30).map(c => ({ 
        id: c.id, 
        title: c.title, 
        desc: c.description, 
        cat: c.category,
        tags: c.tags 
    }));
    
    const parts: any[] = [{ text: `Perform a fuzzy semantic search.
      Query Item: "${query.description}".
      
      Task: Return a list of IDs from the Candidates list that represent the SAME object or a HIGHLY PROBABLE match.
      
      Rules:
      1. Be lenient with keywords. "Sony WH-1000XM4" (Specific) matches "Sony Wireless Headphones" (Generic).
      2. Ignore minor color naming differences (e.g. "Space Grey" == "Grey").
      3. Focus on object type and key visual identifiers.
      
      Candidates: ${JSON.stringify(candidateList)}. 
      
      Return JSON { "matches": [{ "id": "..." }] }. Return empty array if no likely matches.` }];
    
    if (query.imageUrls[0]) {
       const data = query.imageUrls[0].split(',')[1];
       if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }

    const text = await generateWithGauntlet({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    }, "You are a semantic matching engine.");

    const data = JSON.parse(cleanJSON(text));
    const result = data.matches || [];
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("Match error", e);
    return [];
  }
};

export const compareItems = async (itemA: ItemReport, itemB: ItemReport): Promise<ComparisonResult> => {
  // Use IDs for cache key. We assume items don't mutate significantly for comparison purposes.
  // Sorting IDs ensures A vs B is same as B vs A cache hit.
  const ids = [itemA.id, itemB.id].sort().join('_');
  const cacheKey = await CacheManager.generateKey({ type: 'compare', ids });
  
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

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
    
    const result = JSON.parse(cleanJSON(text));
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return { confidence: 0, explanation: "Comparison unavailable.", similarities: [], differences: [] };
  }
};