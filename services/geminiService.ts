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

// 1. Define specific roles for models based on user request
const MODEL_ROLES = {
  // LOGIC & CREATIVE: Best for writing descriptions and complex comparisons
  REASONING: 'gemini-3-flash-preview', 
  
  // VISION & SAFETY: Balanced model for safety checks and coordinate detection
  VISION: 'gemini-2.5-flash-preview', 
  
  // SPEED & VOLUME: Fastest model for iterating through database candidates
  SCANNER: 'gemini-2.5-flash-lite-preview' 
};

// Fallback pipeline (Strictly Flash models only)
const FALLBACK_PIPELINE = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash-preview',
  'gemini-2.5-flash-lite-preview'
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
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  
  try {
      JSON.parse(cleaned);
      return cleaned;
  } catch (e) {
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      let startIdx = -1;
      let endIdx = -1;
      
      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
           startIdx = firstBrace;
           endIdx = cleaned.lastIndexOf('}');
      } else if (firstBracket !== -1) {
           startIdx = firstBracket;
           endIdx = cleaned.lastIndexOf(']');
      }
      
      if (startIdx !== -1 && endIdx !== -1) {
          return cleaned.substring(startIdx, endIdx + 1);
      }
      return "{}";
  }
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

// --- HELPER: LOCAL FUZZY MATCH (FALLBACK) ---
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 
  'lost', 'found', 'item', 'missing', 'looking', 'please', 'help', 'left', 'near', 'i', 'my',
  'black', 'white', 'blue', 'red', 'green', 'yellow', 'purple', 'pink', 'orange', 'brown', 'grey', 'gray', 'silver', 'gold',
  'brand', 'new', 'old', 'good', 'condition', 'broken', 'used', 'small', 'large', 'big'
]);

const performLocalFallbackMatch = (queryTitle: string, queryDescription: string, queryCategory: ItemCategory, candidateList: any[]): { id: string }[] => {
    console.log("[RETRIVA_AI] 🛠️ Executing Strict Local Fallback Match...");
    
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
    
    const queryTokens = new Set(normalize(queryTitle + " " + queryDescription));
    const titleTokens = new Set(normalize(queryTitle));
    
    const matches: { id: string }[] = [];

    for (const c of candidateList) {
        if (queryCategory !== ItemCategory.OTHER && c.cat !== ItemCategory.OTHER && queryCategory !== c.cat) {
            continue;
        }

        const cTitleTokens = normalize(c.title);
        const cDescTokens = normalize(c.desc);
        const cAllTokens = [...cTitleTokens, ...cDescTokens]; 
        
        let titleMatchCount = 0;
        for (const token of cTitleTokens) {
            if (titleTokens.has(token)) titleMatchCount++;
        }

        let totalMatchCount = 0;
        for (const token of cAllTokens) {
            if (queryTokens.has(token)) totalMatchCount++;
        }

        if (titleMatchCount >= 2 || (titleMatchCount >= 1 && totalMatchCount >= 4)) {
            matches.push({ id: c.id });
        }
    }
    
    return matches;
};

// --- MODEL MANAGER CLASS ---
class ModelManager {
  private sessionBans: Set<string> = new Set();
  private temporaryCooldowns: Map<string, number> = new Map();

  public banModel(model: string, reason: string) {
    console.warn(`⛔ [RETRIVA_AI] Banning model ${model} for session: ${reason}`);
    this.sessionBans.add(model);
  }

  public markModelBusy(model: string) {
    const cooldownDuration = 60000;
    console.warn(`❄️ [RETRIVA_AI] Cooling down ${model} for ${cooldownDuration/1000}s.`);
    this.temporaryCooldowns.set(model, Date.now() + cooldownDuration);
  }

  public isAvailable(model: string): boolean {
    if (this.sessionBans.has(model)) return false;
    const expiry = this.temporaryCooldowns.get(model);
    if (expiry && Date.now() < expiry) return false;
    return true;
  }
}

const modelManager = new ModelManager();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- CORE GENERATION FUNCTION ---
const generateWithGauntlet = async (params: any, systemInstruction?: string, preferredModel?: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("MISSING_API_KEY");

  const ai = new GoogleGenAI({ apiKey });
  
  // Construct pipeline: Preferred Model First -> Then Fallbacks
  let pipeline: string[] = [];
  if (preferredModel && modelManager.isAvailable(preferredModel)) {
      pipeline.push(preferredModel);
  }
  // Add rest of fallbacks, excluding the one we just added
  pipeline = [...pipeline, ...FALLBACK_PIPELINE.filter(m => m !== preferredModel && modelManager.isAvailable(m))];
  
  if (pipeline.length === 0) {
     // If all are banned/busy, force try the preferred one anyway as last resort
     if (preferredModel) pipeline.push(preferredModel);
     else throw new Error("No available models.");
  }

  let lastError: any = null;

  for (const model of pipeline) {
    let retries = 0;
    const MAX_RETRIES = 1;

    while (retries <= MAX_RETRIES) {
        try {
            const config = { ...params.config };
            delete config.thinkingConfig; // Flash models don't support thinkingConfig usually, safekeeping
            
            if (systemInstruction) {
                config.systemInstruction = systemInstruction;
            }

            console.log(`[RETRIVA_AI] 🚀 Task assigned to: ${model}`);
            const response = await ai.models.generateContent({
                ...params,
                model,
                config
            });

            return response.text || "";

        } catch (error: any) {
            const msg = (error.message || "").toLowerCase();
            const status = error.status || 0;

            console.warn(`❌ [RETRIVA_AI] Error with ${model}: ${msg}`);

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
                    modelManager.markModelBusy(model);
                    lastError = error;
                    break;
                }
            }
            
            lastError = error;
            break;
        }
    }
  }
  
  throw lastError || new Error("All AI models failed to respond.");
};


// --- EXPORTED FEATURES (API) ---

export const findSmartMatches = async (sourceItem: ItemReport, allReports: ItemReport[]): Promise<ItemReport[]> => {
    console.group(`[RETRIVA_AI] 🧠 Analyzing: "${sourceItem.title}"`);
    
    // 1. Initial Filter
    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST';
    
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType &&
        r.id !== sourceItem.id
    );

    console.log(`Step 1: Found ${candidates.length} candidates.`);
    
    if (candidates.length === 0) {
        console.groupEnd();
        return [];
    }

    // Date Buffer
    const sourceTime = parseDateVal(sourceItem.date);
    const BUFFER_MS = 86400000 * 2; // 48 Hours

    candidates = candidates.filter(r => {
        const rTime = parseDateVal(r.date);
        if (sourceItem.type === 'LOST') return rTime >= (sourceTime - BUFFER_MS);
        else return (sourceTime + BUFFER_MS) >= rTime;
    });

    // Sort by proximity
    candidates.sort((a, b) => {
        const aTime = parseDateVal(a.date);
        const bTime = parseDateVal(b.date);
        return Math.abs(aTime - sourceTime) - Math.abs(bTime - sourceTime);
    });

    if (candidates.length === 0) {
        console.groupEnd();
        return [];
    }

    // 2. AI Semantic Filtering
    try {
        const queryDescription = `Description: ${sourceItem.description}. Visuals: ${sourceItem.tags.join(', ')}`;
        console.log("Step 3: Sending candidates to Gemini for semantic analysis...");
        
        // --- STRATEGY: Use SCANNER Model (Lite) ---
        const matchIds = await findPotentialMatches(
            { title: sourceItem.title, description: queryDescription, imageUrls: sourceItem.imageUrls, category: sourceItem.category },
            candidates
        );
        
        console.log(`Result: ${matchIds.length} matches identified.`);
        const validIds = new Set(matchIds.map(m => m.id));
        const finalMatches = candidates.filter(c => validIds.has(c.id));
        
        console.groupEnd();
        return finalMatches;
    } catch (e) {
        console.error("AI Match Failed:", e);
        const queryDesc = `${sourceItem.description} ${sourceItem.tags.join(' ')}`;
        const candidateList = candidates.map(c => ({ id: c.id, title: c.title, desc: c.description, cat: c.category, tags: c.tags }));
        const fallbackIds = performLocalFallbackMatch(sourceItem.title, queryDesc, sourceItem.category, candidateList);
        console.groupEnd();
        return candidates.filter(c => fallbackIds.some(f => f.id === c.id));
    }
};

export const instantImageCheck = async (base64Image: string): Promise<{ 
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK';
  isPrank: boolean;
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN' | 'NONE';
  reason: string;
}> => {
  const cacheKey = await CacheManager.generateKey({ type: 'imgCheck_v3', data: base64Image });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    // --- STRATEGY: Use VISION Model (2.5 Flash) ---
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `SYSTEM: Security Scan. Analyze image for lost & found safety.
            STRICT POLICIES:
            1. REJECT 'GORE': Bloody, violent content.
            2. REJECT 'NUDITY': Explicit content.
            3. REJECT 'HUMAN': Selfies or portraits where person is main subject. 
               - ID Cards/Hands holding items = ALLOW.
            Return JSON: { "violationType": "GORE"|"NUDITY"|"HUMAN"|"NONE", "isPrank": boolean, "reason": "string" }` 
          },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    }, undefined, MODEL_ROLES.VISION); // <-- Explicitly requesting Vision Model

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
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  const cacheKey = await CacheManager.generateKey({ type: 'redact', data: base64Image });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    // --- STRATEGY: Use VISION Model (2.5 Flash) ---
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for Faces, ID Cards, Credit Cards, and PII. Return JSON { "regions": [[...]] }` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    }, undefined, MODEL_ROLES.VISION);

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
    // --- STRATEGY: Use REASONING Model (3.0 Flash) for better descriptions ---
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `Analyze for Lost & Found. Extract: title, category (${Object.values(ItemCategory).join(',')}), tags, color, brand, condition, distinguishingFeatures. Return JSON.` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    }, undefined, MODEL_ROLES.REASONING);
    
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

export const mergeDescriptions = async (userDistinguishingFeatures: string, visualData: any): Promise<string> => {
  const cacheKey = await CacheManager.generateKey({ type: 'merge_v2', userDistinguishingFeatures, visualData });
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    // --- STRATEGY: Use REASONING Model (3.0 Flash) ---
    // Updated Prompt to treat user input as distinguishing features
    const text = await generateWithGauntlet({
      contents: {
        parts: [{ text: `
          Role: Professional Copywriter for Lost & Found.
          Task: Create a clear, searchable item description.
          
          Input Data:
          1. AI Visual Scan: ${JSON.stringify(visualData)}
          2. User's Observed Marks/Features: "${userDistinguishingFeatures}"
          
          Guidelines:
          - Combine the visual facts with the user's specific observations.
          - Highlight unique marks (scratches, stickers, engravings).
          - Keep it concise (under 300 chars) but detailed enough to identify.
          - Tone: Professional, helpful.
        ` }]
      }
    }, "You are a helpful copywriter.", MODEL_ROLES.REASONING);
    
    const result = text || userDistinguishingFeatures;
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return userDistinguishingFeatures; // Fallback
  }
};

export const validateReportContext = async (reportData: { title: string, category: string, location: string, description: string }): Promise<{ isValid: boolean, reason: string }> => {
  try {
    // --- STRATEGY: Use SCANNER Model (Lite) for fast pre-submission validation ---
    const text = await generateWithGauntlet({
       contents: {
         parts: [{ text: `
           Role: Content Moderator & Logic Validator.
           Task: Validate a Lost & Found report for consistency and realism.
           
           Report Data:
           - Title: "${reportData.title}"
           - Category: "${reportData.category}"
           - Location: "${reportData.location}"
           - Description: "${reportData.description}"
           
           Validation Rules:
           1. Consistency: Does Title match Category? (e.g. Title "iPhone" vs Category "Clothing" is INVALID).
           2. Realism: Is Location a plausible real-world place? (e.g. "Narnia", "Mars", "The Void" is INVALID).
           3. Safety: Is the content appropriate? (No gore, hate speech, spam).
           4. Coherence: Is the description gibberish?
           
           Output JSON: { "isValid": boolean, "reason": "Short explanation if invalid" }
         ` }]
       },
       config: { responseMimeType: "application/json" }
    }, undefined, MODEL_ROLES.SCANNER);

    return JSON.parse(cleanJSON(text));
  } catch (e) {
    // Fail open if AI fails, let human moderation handle it later
    return { isValid: true, reason: "" };
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

    // --- STRATEGY: Use REASONING Model (3.0 Flash) ---
    const text = await generateWithGauntlet({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    }, "You are a content moderator and classifier.", MODEL_ROLES.REASONING);

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
    // --- STRATEGY: Use SCANNER Model (Lite is smart enough for search intent) ---
    const text = await generateWithGauntlet({
      contents: { parts: [{ text: `Analyze query: "${query}". Return JSON: userStatus (LOST/FOUND/NONE), refinedQuery (keywords).` }] }
    }, "You are a search intent analyzer.", MODEL_ROLES.SCANNER);
    const result = JSON.parse(cleanJSON(text));
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return { userStatus: 'NONE', refinedQuery: query };
  }
};

export const findPotentialMatches = async (
  query: { title: string; description: string; imageUrls: string[]; category: ItemCategory },
  candidates: ItemReport[]
): Promise<{ id: string }[]> => {
  if (candidates.length === 0) return [];
  
  const candidateIds = candidates.map(c => c.id).sort().join(',');
  const cacheKey = await CacheManager.generateKey({ type: 'match_v5', query, candidateIds });
  
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const candidateList = candidates.slice(0, 30).map(c => ({ 
        id: c.id, 
        title: c.title, 
        desc: c.description, 
        cat: c.category, 
        tags: c.tags 
    }));

    // DEBUG: Log what we are sending
    console.log(`[RETRIVA_AI] Sending ${candidateList.length} candidates to model:`, candidateList);
    
    const parts: any[] = [{ text: `
      Role: Semantic Matching Engine. 
      Goal: Find candidates that represent the SAME PHYSICAL OBJECT.
      QUERY: "${query.title}" (${query.category}) - ${query.description}
      CANDIDATES: ${JSON.stringify(candidateList)}
      
      INSTRUCTIONS:
      1. STRICT OBJECT TYPE CHECK: "Mouse" != "Calculator".
      2. IGNORE GENERIC ATTRIBUTES if object type differs.
      
      OUTPUT: JSON { "matches": [{ "id": "..." }] }
    ` }];
    
    if (query.imageUrls[0]) {
       const data = query.imageUrls[0].split(',')[1];
       if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }

    // --- STRATEGY: Use SCANNER Model (Lite) for high throughput / low latency ---
    const text = await generateWithGauntlet({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    }, "Semantic matcher.", MODEL_ROLES.SCANNER);

    console.log(`[RETRIVA_AI] Raw Gemini Response: ${text.substring(0, 150)}...`);

    const data = JSON.parse(cleanJSON(text));
    let result = Array.isArray(data) ? data : (data.matches || []);
    
    if (result.length === 0) {
        result = performLocalFallbackMatch(query.title, query.description, query.category, candidateList);
    }
    
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("[RETRIVA_AI] Match error", e);
    const candidateList = candidates.slice(0, 30).map(c => ({ id: c.id, title: c.title, desc: c.description, cat: c.category, tags: c.tags }));
    return performLocalFallbackMatch(query.title, query.description, query.category, candidateList);
  }
};

export const compareItems = async (itemA: ItemReport, itemB: ItemReport): Promise<ComparisonResult> => {
  const isAGreater = itemA.id > itemB.id;
  const first = isAGreater ? itemA : itemB;
  const second = isAGreater ? itemB : itemA;

  const cacheKey = await CacheManager.generateKey({ 
    type: 'compare_v3', 
    id1: first.id, desc1: first.description, title1: first.title,
    id2: second.id, desc2: second.description, title2: second.title
  });
  
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const prompt = `
      Compare items to determine if they are the SAME physical object.
      ITEM A: ${itemA.title} - ${itemA.description}
      ITEM B: ${itemB.title} - ${itemB.description}
      Output JSON: { "confidence": number(0-100), "explanation": string, "similarities": [], "differences": [] }
    `;

    const parts: any[] = [{ text: prompt }];
    
    const images = [itemA.imageUrls[0], itemB.imageUrls[0]].filter(Boolean);
    images.forEach(img => {
      const data = img.split(',')[1];
      if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    });

    // --- STRATEGY: Use REASONING Model (3.0 Flash) for high logic comparison ---
    const text = await generateWithGauntlet({
       contents: { parts },
       config: { responseMimeType: "application/json" }
    }, "Forensic analyst.", MODEL_ROLES.REASONING);
    
    const result = JSON.parse(cleanJSON(text));
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    return { confidence: 0, explanation: "Comparison unavailable.", similarities: [], differences: [] };
  }
};