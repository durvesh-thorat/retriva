import { GoogleGenAI, Type } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport, ReportType } from "../types";

// --- TYPES ---
export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

// --- CONFIGURATION: THE MODERN PIPELINE ---
// Updated to use specific stable identifiers for Gemini 3.0 and 2.5 series.
const MODEL_PIPELINE = [
  'gemini-3-flash-preview',   // Primary: Frontier-level visual reasoning
  'gemini-2.5-flash',         // Stable 2.5: 1M token context window
  'gemini-2.5-flash-image',   // Specialized: Image editing/reasoning
  'gemini-2.0-flash',         // Stable GA: Standard production model
  'gemini-2.0-flash-lite'     // Lite: High-frequency, low-cost
];

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

// --- HELPER: DATE PARSER ---
const parseDateVal = (dateStr: string): number => {
    if (!dateStr) return 0;
    // Handle DD/MM/YYYY format standard in this app
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        // Note: Month is 0-indexed in JS Date
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
    }
    // Fallback for YYYY-MM-DD or other formats
    return new Date(dateStr).getTime();
};

// --- MODEL MANAGER CLASS ---
class ModelManager {
  // We only permanently ban 404s (Model Not Found) for the session.
  private sessionBans: Set<string> = new Set();
  // We temporarily cool down models that return 429s/503s so we don't hammer them across parallel requests
  private temporaryCooldowns: Map<string, number> = new Map();

  public banModel(model: string, reason: string) {
    console.warn(`⛔ Banning model ${model} for session: ${reason}`);
    this.sessionBans.add(model);
  }

  public markModelBusy(model: string) {
    const cooldownDuration = 60000; // 1 minute cooldown
    console.warn(`❄️ Cooling down ${model} for ${cooldownDuration/1000}s due to Rate Limiting.`);
    this.temporaryCooldowns.set(model, Date.now() + cooldownDuration);
  }

  public getAvailableModels(): string[] {
    const now = Date.now();
    
    // 1. Filter out permanently banned models (404s)
    let candidates = MODEL_PIPELINE.filter(model => !this.sessionBans.has(model));
    
    // 2. Filter out temporarily busy models (429s)
    const ready = candidates.filter(model => {
        const expiry = this.temporaryCooldowns.get(model);
        return !expiry || now > expiry;
    });

    // 3. Fail-safe: If ALL models are cooling down, return the banned-filtered list
    // (Better to try a busy model than to have 0 models and crash)
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

  // Iterate through available models
  for (const model of pipeline) {
    let retries = 0;
    const MAX_RETRIES = 1; // Reduced from 3 to 1 to failover faster if a model is stalling

    // Inner Loop: Retry the SAME model if it is just busy (429/503)
    while (retries <= MAX_RETRIES) {
        try {
            // Clean config
            const config = { ...params.config };
            delete config.thinkingConfig; // Ensure compatibility
            
            if (systemInstruction) {
                config.systemInstruction = systemInstruction;
            }

            // console.log(`🚀 Sending to ${model} (Attempt ${retries + 1})`);

            const response = await ai.models.generateContent({
                ...params,
                model,
                config
            });

            return response.text || "";

        } catch (error: any) {
            const msg = (error.message || "").toLowerCase();
            const status = error.status || 0;

            // 1. MODEL NOT FOUND (404) or INVALID ARGUMENT (400)
            // This model name is wrong for this key/region. Ban it and move to next model immediately.
            if (status === 404 || msg.includes('not found') || status === 400) {
                modelManager.banModel(model, `Status ${status}: ${msg}`);
                break; // Break inner loop, outer loop moves to next model
            }

            // 2. RATE LIMIT (429) or OVERLOAD (503)
            // The model exists but is busy. Wait and retry.
            if (status === 429 || status === 503 || msg.includes('quota') || msg.includes('overloaded')) {
                retries++;
                if (retries <= MAX_RETRIES) {
                    // Exponential backoff: 2s (1st retry)
                    const waitTime = Math.pow(2, retries) * 1000; 
                    console.warn(`⏳ ${model} is busy (429). Retrying in ${waitTime/1000}s...`);
                    await delay(waitTime);
                    continue; // Continue inner loop (retry same model)
                } else {
                    console.warn(`❌ ${model} exhausted retries. Failing over to next model.`);
                    modelManager.markModelBusy(model); // Mark it busy for OTHER parallel requests too
                    lastError = error;
                    break; // Break inner loop, outer loop moves to next model
                }
            }

            // 3. OTHER ERRORS (500, Unknown)
            // Log and try next model immediately
            console.warn(`❌ Error with ${model}: ${msg}`);
            lastError = error;
            break; // Break inner loop, outer loop moves to next model
        }
    }
  }

  // If we exhaust the entire pipeline
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

/**
 * HIGH EFFICIENCY MATCHING ENGINE
 * Filters candidates based on strict logic before sending to AI.
 * 
 * Logic:
 * 1. Status: Must be OPEN
 * 2. Polarity: LOST vs FOUND
 * 3. Date: Found Date >= Lost Date
 * 4. Category: Strict match
 * 5. Tags: At least one tag overlap
 */
export const findSmartMatches = async (sourceItem: ItemReport, allReports: ItemReport[]): Promise<ItemReport[]> => {
    // 1. Initial Filter: Status, Type (Polarity), and Exclude Self
    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST';
    
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType && 
        r.reporterId !== sourceItem.reporterId
    );

    if (candidates.length === 0) return [];

    // 2. Strict Category Match
    candidates = candidates.filter(r => r.category === sourceItem.category);

    if (candidates.length === 0) return [];

    // 3. Date Logic
    // Logic: An item cannot be found BEFORE it was lost.
    // IF Source is LOST: Candidate (Found) Date must be >= Source (Lost) Date
    // IF Source is FOUND: Source (Found) Date must be >= Candidate (Lost) Date
    const sourceTime = parseDateVal(sourceItem.date);
    
    candidates = candidates.filter(r => {
        const rTime = parseDateVal(r.date);
        // Allow for same-day matches
        if (sourceItem.type === 'LOST') {
            return rTime >= sourceTime;
        } else {
            return sourceTime >= rTime;
        }
    });

    if (candidates.length === 0) return [];

    // 4. Tag Overlap (At least one tag must match)
    // Normalize source tags for case-insensitive comparison
    const sourceTags = new Set(sourceItem.tags.map(t => t.toLowerCase().trim()));
    
    candidates = candidates.filter(r => {
        // If either has no tags, we can't enforce overlap strictly? 
        // User rule: "A and B must've atleast one tag same"
        // If a report has 0 tags, it can never match.
        if (sourceItem.tags.length === 0 || r.tags.length === 0) return false;
        
        return r.tags.some(t => sourceTags.has(t.toLowerCase().trim()));
    });

    // If no candidates left after strict logic, return early (Saves API call & Time)
    if (candidates.length === 0) return [];

    console.log(`🔍 Smart Match: Filtered down to ${candidates.length} logical candidates from ${allReports.length}. Sending to AI...`);

    // 5. AI Semantic Search on remaining filtered candidates
    // Construct text query for the AI
    const queryDesc = `Title: ${sourceItem.title}. Desc: ${sourceItem.description}. Loc: ${sourceItem.location}.`;
    
    // Call the AI matching function with the reduced list
    const matches = await findPotentialMatches(
        { description: queryDesc, imageUrls: sourceItem.imageUrls }, 
        candidates
    );

    // Map back the ID results to full objects
    const matchedReports = candidates.filter(c => matches.some(m => m.id === c.id));
    return matchedReports;
};

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
          { text: `SYSTEM: Security Scan. Analyze image for violations. 
            Policies: 
            1. GORE (bloody, violent)
            2. NUDITY (explicit content)
            3. PRIVACY (harassment, sensitive docs). 
            
            Return JSON with:
            - violationType: "GORE", "NUDITY", "PRIVACY", or "NONE"
            - isPrank: boolean
            - reason: string
            
            If safe, violationType must be "NONE".` 
          },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(cleanJSON(text));
    
    // Explicitly set defaults to prevent "undefined" being treated as a violation
    return {
        faceStatus: parsed.faceStatus || 'NONE',
        isPrank: parsed.isPrank || false,
        violationType: parsed.violationType || 'NONE',
        reason: parsed.reason || ''
    };
  } catch (e) {
    console.error("Image Check Failed", e);
    // Fail safe - Default to NONE if the check crashes, to avoid blocking valid users during outages
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
    
    const parsed = JSON.parse(cleanJSON(text));
    return {
        title: parsed.title || "",
        category: parsed.category || ItemCategory.OTHER,
        tags: parsed.tags || [],
        color: parsed.color || "",
        brand: parsed.brand || "",
        condition: parsed.condition || "",
        distinguishingFeatures: parsed.distinguishingFeatures || []
    };
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