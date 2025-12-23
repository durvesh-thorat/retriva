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
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  
  // Try to parse directly first to avoid destroying valid JSON that doesn't look standard
  try {
      JSON.parse(cleaned);
      return cleaned;
  } catch (e) {
      // Find outermost structure
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      
      let startIdx = -1;
      let endIdx = -1;
      
      // Determine if object or array comes first
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
const performLocalFallbackMatch = (queryDescription: string, candidateList: any[]): { id: string }[] => {
    // Normalize text: lowercase, remove punctuation, split by space
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    
    // Extract tokens from query (Title + Desc + Category + Tags)
    const queryTokens = new Set(normalize(queryDescription));
    
    const matches: { id: string }[] = [];

    for (const c of candidateList) {
        // Build candidate string
        const cText = `${c.title} ${c.desc} ${c.cat} ${c.tags ? c.tags.join(' ') : ''}`;
        const cTokens = normalize(cText);
        
        // Count overlapping tokens
        let matchCount = 0;
        for (const token of cTokens) {
            if (queryTokens.has(token)) matchCount++;
        }

        // HEURISTIC:
        // If > 2 matching significant words, or if it's a short query and 50% match.
        // This is a loose fallback to ensure we return SOMETHING if AI fails or is too strict.
        if (matchCount >= 2 || (queryTokens.size < 4 && matchCount >= 1)) {
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
    console.warn(`❄️ [RETRIVA_AI] Cooling down ${model} for ${cooldownDuration/1000}s due to Rate Limiting.`);
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
    // NOTE: Using console.group instead of collapsed to ensure users see the logs!
    console.group(`[RETRIVA_AI] 🧠 Analyzing: "${sourceItem.title}" (${sourceItem.type})`);
    console.log(`Source Info: ID=${sourceItem.id}, Date=${sourceItem.date}`);
    
    // 1. Initial Filter (Logic Funnel)
    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST'; // Polarity
    
    // Status and Polarity
    // SELF-MATCHING is allowed for testing
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType &&
        r.id !== sourceItem.id
    );

    console.log(`Step 1: Found ${candidates.length} candidates with Type '${targetType}' and Status 'OPEN'.`);
    
    if (candidates.length === 0) {
        console.warn("Match Aborted: No candidates of opposite type found in database.");
        console.groupEnd();
        return [];
    }

    // Date Logic
    const sourceTime = parseDateVal(sourceItem.date);
    const dateFiltered = candidates.filter(r => {
        const rTime = parseDateVal(r.date);
        
        // BUFFER LOGIC: Allow a 48-hour buffer for date mismatches (increased from 24h)
        const BUFFER_MS = 86400000 * 2;

        if (sourceItem.type === 'LOST') {
            // Found time must be >= Lost time (physically), but allow buffer
            return rTime >= (sourceTime - BUFFER_MS);
        } else {
            // Lost time must be <= Found time (physically), but allow buffer
            return (sourceTime + BUFFER_MS) >= rTime;
        }
    });

    const droppedCount = candidates.length - dateFiltered.length;
    console.log(`Step 2: Date filter kept ${dateFiltered.length} items (Dropped ${droppedCount}).`);

    candidates = dateFiltered;

    // Sort by proximity to sourceTime (Closest dates first)
    candidates.sort((a, b) => {
        const aTime = parseDateVal(a.date);
        const bTime = parseDateVal(b.date);
        return Math.abs(aTime - sourceTime) - Math.abs(bTime - sourceTime);
    });

    if (candidates.length === 0) {
        console.log("No candidates remain after date filtering.");
        console.groupEnd();
        return [];
    }

    // 2. AI Semantic Filtering
    try {
        const queryDescription = `Title: ${sourceItem.title}. Category: ${sourceItem.category}. Description: ${sourceItem.description}. Visuals: ${sourceItem.tags.join(', ')}`;
        console.log("Step 3: Sending candidates to Gemini for semantic analysis...");
        
        // Use the existing findPotentialMatches function which calls Gemini
        const matchIds = await findPotentialMatches(
            { description: queryDescription, imageUrls: sourceItem.imageUrls },
            candidates
        );
        
        console.log(`Result: ${matchIds.length} matches identified.`);
        const validIds = new Set(matchIds.map(m => m.id));
        const finalMatches = candidates.filter(c => validIds.has(c.id));
        
        console.log("FINAL MATCHES:", finalMatches.map(m => `${m.title} (${m.id})`));
        console.groupEnd();
        return finalMatches;
    } catch (e) {
        console.error("AI Match Failed:", e);
        // Fallback: Local Keyword Match if API fails totally
        const queryDesc = `${sourceItem.title} ${sourceItem.description} ${sourceItem.category} ${sourceItem.tags.join(' ')}`;
        const fallbackIds = performLocalFallbackMatch(queryDesc, candidates.map(c => ({ id: c.id, title: c.title, desc: c.description, cat: c.category, tags: c.tags })));
        
        const fallbackMatches = candidates.filter(c => fallbackIds.some(f => f.id === c.id));
        console.log(`System Fallback: Returning ${fallbackMatches.length} matches based on keywords.`);
        console.groupEnd();
        return fallbackMatches;
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
    const text = await generateWithGauntlet({
      contents: {
        parts: [
          { text: `SYSTEM: Security Scan. Analyze image for lost & found safety.
            
            STRICT POLICIES:
            1. REJECT 'GORE': Bloody, violent, or disturbing content.
            2. REJECT 'NUDITY': Explicit content.
            3. REJECT 'HUMAN': Selfies, portraits, or photos where a person is the main subject.
               - If the image contains a person's face/body (selfie, portrait, group photo) -> REJECT.
               - EXCEPTION: If the image is a DOCUMENT (ID Card, Passport, License) containing a face -> ALLOW (NONE). (We will redact it later).
               - EXCEPTION: If the image contains hands holding an item -> ALLOW (NONE).
            
            Return JSON:
            {
              "violationType": "GORE" | "NUDITY" | "HUMAN" | "NONE",
              "isPrank": boolean,
              "reason": "User-friendly rejection message or 'Safe'"
            }
            ` 
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
          { text: `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for Faces, ID Cards, Credit Cards, and PII. Return JSON { "regions": [[...]] }` },
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
  
  const candidateIds = candidates.map(c => c.id).sort().join(',');
  const cacheKey = await CacheManager.generateKey({ type: 'match_v2', query, candidateIds });
  
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
      Role: You are a "Lost and Found" matching engine. 
      Goal: Find potential matches for a lost item among a list of found items (or vice versa).
      
      Query Item: "${query.description}"
      
      Candidates List: ${JSON.stringify(candidateList)}
      
      INSTRUCTIONS:
      1. Analyze the 'Query Item' and compare it with each 'Candidate'.
      2. Return a list of Candidate IDs that are "Possible Matches".
      3. BE LENIENT. We want high recall. If an item is the same Category (e.g. both are 'phones') and shares ANY distinct keyword (e.g. 'Samsung', 'Black', ' cracked screen'), include it.
      4. Ignore minor discrepancies in description length or detail level.
      5. If the Query mentions a specific brand (e.g. "Sony"), prioritize candidates with that brand, but also include generic items if they *could* be that brand.
      
      OUTPUT FORMAT:
      Return strictly JSON: { "matches": [{ "id": "candidate_id_here" }, ...] }
      If no matches found, return { "matches": [] }
    ` }];
    
    if (query.imageUrls[0]) {
       const data = query.imageUrls[0].split(',')[1];
       if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }

    const text = await generateWithGauntlet({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    }, "You are a semantic matching engine.");

    console.log(`[RETRIVA_AI] Raw Gemini Response: ${text.substring(0, 150)}...`);

    const data = JSON.parse(cleanJSON(text));
    let result = Array.isArray(data) ? data : (data.matches || []);
    
    // IF GEMINI RETURNS EMPTY, TRY LOCAL FALLBACK
    if (result.length === 0) {
        console.warn("[RETRIVA_AI] Gemini found 0 matches. Attempting local fallback...");
        result = performLocalFallbackMatch(query.description, candidateList);
    }
    
    CacheManager.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("[RETRIVA_AI] Match error", e);
    // FALLBACK ON ERROR
    const candidateList = candidates.slice(0, 30).map(c => ({ id: c.id, title: c.title, desc: c.description, cat: c.category, tags: c.tags }));
    return performLocalFallbackMatch(query.description, candidateList);
  }
};

export const compareItems = async (itemA: ItemReport, itemB: ItemReport): Promise<ComparisonResult> => {
  // Use content-based cache key logic to ensure if item details change, we re-evaluate.
  // We sort by ID to ensure A vs B is the same cache key as B vs A.
  const isAGreater = itemA.id > itemB.id;
  const first = isAGreater ? itemA : itemB;
  const second = isAGreater ? itemB : itemA;

  const cacheKey = await CacheManager.generateKey({ 
    type: 'compare_v3', // Bump version to force invalidate old bad prompts
    id1: first.id, desc1: first.description, title1: first.title,
    id2: second.id, desc2: second.description, title2: second.title
  });
  
  const cached = CacheManager.get(cacheKey);
  if (cached) return cached as any;

  try {
    const prompt = `
      Act as a forensic matching expert. Compare these two items to determine if they are the SAME physical object.
      
      ITEM A (${itemA.type}):
      - Title: ${itemA.title}
      - Category: ${itemA.category}
      - Description: ${itemA.description}
      - Location: ${itemA.location}
      - Date: ${itemA.date}
      - Features: ${itemA.distinguishingFeatures?.join(', ') || itemA.tags.join(', ')}

      ITEM B (${itemB.type}):
      - Title: ${itemB.title}
      - Category: ${itemB.category}
      - Description: ${itemB.description}
      - Location: ${itemB.location}
      - Date: ${itemB.date}
      - Features: ${itemB.distinguishingFeatures?.join(', ') || itemB.tags.join(', ')}

      CRITICAL RULES:
      1. ASYMMETRIC DETAIL: If one item description is detailed (e.g. mentions scratches, specific stickers) and the other is generic (omits scratches), this is NOT a mismatch. It is an "Information Gap". Assume the generic reporter simply didn't notice or mention the detail.
      2. SPECIFIC VS GENERIC: "OnePlus 13" matches "OnePlus Smartphone". "AirPods Pro 2" matches "Apple Earbuds". Treat specific model vs generic brand as a MATCH.
      3. TIME & LOCATION: If location is same/nearby and time is within reasonable proximity, increase confidence significantly.

      Task: Analyze visual similarities (from provided images) and semantic details.
      
      Output JSON:
      {
        "confidence": number (0-100), 
        "explanation": "string",
        "similarities": ["string"],
        "differences": ["string"]
      }

      Scoring Guide:
      - 90-100: Strong Match. Locations align, brands match. One might be more detailed than the other, but no direct contradictions.
      - 70-89: Probable Match. Same type, color, and location. Minor variations in naming (e.g. Headphones vs Headset).
      - 40-69: Possible. Same category, but vague.
      - 0-39: Mismatch. Different colors, brands, or distinctly different locations/dates.
    `;

    const parts: any[] = [{ text: prompt }];
    
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