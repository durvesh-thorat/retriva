
import { GoogleGenAI } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport, ReportType } from "../types";

// --- TYPES ---
export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

export interface MatchCandidate {
  id: string;
  confidence: number; // 0-100
  reason?: string;
}

// --- CONFIGURATION ---

// PRIORITY CASCADE:
// 1. Gemini 3.0 Flash: Best reasoning, newest model.
// 2. Gemini 2.0 Flash: Reliable fallback.
// 3. Gemini 2.0 Flash Lite: High speed, lower cost, good for retries.
const MODEL_CASCADE = [
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite-preview-02-05'
];

const MAX_RETRIES = 3;
const BASE_DELAY = 2000; // 2 seconds

// --- HELPER: API KEY ---
const getApiKey = (): string | undefined => {
  // @ts-ignore
  const key = import.meta.env.VITE_API_KEY || import.meta.env.API_KEY;
  if (!key && typeof process !== 'undefined') {
    return process.env.VITE_API_KEY || process.env.API_KEY;
  }
  return key;
};

// --- HELPER: ROBUST JSON PARSER ---
const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  // Remove Markdown code blocks
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  
  // Attempt to find the first valid JSON object or array
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  
  let start = -1;
  let end = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = cleaned.lastIndexOf('}');
  } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleaned.lastIndexOf(']');
  }

  if (start !== -1 && end !== -1) {
      cleaned = cleaned.substring(start, end + 1);
  }

  return cleaned;
};

// --- HELPER: SLEEP ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- THE INTELLIGENT CASCADE RUNNER ---
// Tries models in sequence with exponential backoff for 429s.
const runIntelligentCascade = async (params: any, systemInstruction?: string): Promise<string | null> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
      console.error("[DEBUG_GEMINI] ❌ API Key is MISSING. Check .env or Vercel settings.");
      return null;
  } else {
      // console.log(`[DEBUG_GEMINI] 🔑 API Key found (Length: ${apiKey.length})`);
  }

  const ai = new GoogleGenAI({ apiKey });
  
  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    const model = MODEL_CASCADE[i];
    
    // Retry logic for specific model
    for (let attempt = 0; attempt < 2; attempt++) { 
        try {
            // Apply delay if it's a retry or secondary model to let quota cool down
            if (i > 0 || attempt > 0) {
                const waitTime = BASE_DELAY * Math.pow(1.5, i + attempt);
                console.log(`[DEBUG_GEMINI] ⏳ Waiting ${waitTime}ms before trying ${model} (Attempt ${attempt+1})...`);
                await delay(waitTime);
            }

            const config = { ...params.config };
            delete config.thinkingConfig; // Safety cleanup
            
            if (systemInstruction) {
                config.systemInstruction = systemInstruction;
            }

            // Log payload size if images exist
            if (params.contents?.parts?.length > 1) {
                const imgPart = params.contents.parts.find((p: any) => p.inlineData);
                if (imgPart) {
                    console.log(`[DEBUG_GEMINI] 📤 Sending Image Payload (~${Math.round(imgPart.inlineData.data.length / 1024)}KB) to ${model}`);
                }
            }

            const response = await ai.models.generateContent({
                ...params,
                model,
                config
            });

            if (response.text) {
                // console.log(`[DEBUG_GEMINI] ✅ Success with ${model}`);
                return response.text;
            } else {
                console.warn(`[DEBUG_GEMINI] ⚠️ ${model} returned empty text.`);
            }
        } catch (error: any) {
            const isQuotaError = error.message?.includes('429') || error.status === 429;
            const isNotFoundError = error.message?.includes('404') || error.status === 404;
            const isOverloaded = error.message?.includes('503') || error.status === 503;

            console.error(`[DEBUG_GEMINI] 🛑 Error in ${model} (Attempt ${attempt+1}):`);
            if (error.response) {
                 console.error(`   Status: ${error.response.status}`);
                 console.error(`   Body: ${JSON.stringify(error.response)}`);
            } else {
                 console.error(`   Message: ${error.message}`);
            }

            if (isNotFoundError) {
                console.warn(`[DEBUG_GEMINI] ⏭️ Model ${model} not found/supported. Skipping to next.`);
                break; // Don't retry 404s on the same model
            }
            
            if (!isQuotaError && !isOverloaded) {
                console.warn(`[DEBUG_GEMINI] ⏭️ Non-retriable error. Skipping to next model.`);
                break; 
            }
            // If 429 or 503, loop will retry
        }
    }
  }
  
  console.error("[DEBUG_GEMINI] ❌ CRITICAL: All AI models exhausted. Returning null.");
  return null; 
};


// --- EXPORTED FEATURES (API) ---

export const findSmartMatches = async (sourceItem: ItemReport, allReports: ItemReport[]): Promise<{ report: ItemReport, confidence: number, isOffline: boolean }[]> => {
    
    console.log(`[DEBUG_GEMINI] 🔍 Starting Smart Match for: ${sourceItem.title}`);

    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST';
    
    // 1. Loose Pre-Filtering (Let AI decide the rest)
    // We only filter by status and type. We let AI handle category fuzziness (e.g. "Phone" vs "Electronics").
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType &&
        r.id !== sourceItem.id
    );

    // Optimize: If too many candidates, take the most recent 30 to prevent context overflow
    if (candidates.length > 30) {
        console.log(`[DEBUG_GEMINI] Trimming candidates from ${candidates.length} to 30`);
        candidates = candidates.slice(0, 30);
    }

    if (candidates.length === 0) {
        console.log(`[DEBUG_GEMINI] No candidates found in DB.`);
        return [];
    }

    // 2. AI Reasoning Engine
    let matchResults: MatchCandidate[] = [];
    let usedAI = false;
    
    // Minimal Candidate JSON for Token Efficiency
    const aiCandidates = candidates.map(c => ({ 
        id: c.id, 
        t: c.title, 
        d: c.description, 
        c: c.category, 
        l: c.location,
        tm: `${c.date} ${c.time}`
    }));

    const sourceData = `ITEM: ${sourceItem.title}. DESC: ${sourceItem.description}. CAT: ${sourceItem.category}. LOC: ${sourceItem.location}. TIME: ${sourceItem.date} ${sourceItem.time}`;

    try {
        const systemPrompt = `
          You are a Forensic Recovery Agent. Your goal is to match a ${sourceItem.type} item with a list of potential candidates.
          
          RULES:
          1. **Semantic Matching**: Match meaning, not just words (e.g., "AirPods" == "Earbuds", "MacBook" == "Laptop").
          2. **Hard Constraints**: Reject if visual attributes contradict (e.g., "Red Case" vs "Blue Case").
          3. **Soft Constraints**: Allow fuzzy time/location (e.g., "Library" might match "Student Center" if nearby).
          4. **Confidence**:
             - 90-100: Almost certain match (Unique ID, very specific visuals).
             - 70-89: High probability (Strong semantic match, correct location/time).
             - 40-69: Potential match (Vague description but correct category/context).
             - 0-39: Ignore.

          INPUT CANDIDATES:
          ${JSON.stringify(aiCandidates)}

          TARGET ITEM:
          ${sourceData}

          OUTPUT:
          Return a JSON object: { "matches": [ { "id": "string", "confidence": number, "reason": "string" } ] }
          Only include confidence > 40.
        `;

        const text = await runIntelligentCascade({
            contents: { parts: [{ text: systemPrompt }] },
            config: { responseMimeType: "application/json" }
        });

        if (text) {
            console.log(`[DEBUG_GEMINI] 📥 Raw AI Response:`, text.substring(0, 100) + "...");
            const cleanText = cleanJSON(text);
            try {
                const data = JSON.parse(cleanText);
                matchResults = data.matches || [];
                console.log(`[DEBUG_GEMINI] ✅ Parsed ${matchResults.length} matches.`);
                usedAI = true;
            } catch (jsonErr) {
                console.error(`[DEBUG_GEMINI] 💥 JSON Parse Error:`, jsonErr, `\nCleaned Text:`, cleanText);
            }
        }
    } catch (e) {
        console.error("[DEBUG_GEMINI] Logic Error in findSmartMatches:", e);
    }

    // 3. Fallback (Only if AI completely failed)
    if (!usedAI) {
        // Simple keyword fallback
        console.warn("[DEBUG_GEMINI] ⚠️ Switching to basic keyword fallback");
        matchResults = candidates
            .map(c => {
                let score = 0;
                if (c.category === sourceItem.category) score += 30;
                if (c.title.toLowerCase().includes(sourceItem.title.toLowerCase())) score += 40;
                return { id: c.id, confidence: score, reason: "Keyword Match" };
            })
            .filter(m => m.confidence > 30);
    }

    // Map back
    const results = matchResults.map(m => {
        const report = candidates.find(c => c.id === m.id);
        return report ? { report, confidence: m.confidence, isOffline: !usedAI } : null;
    }).filter(Boolean) as { report: ItemReport, confidence: number, isOffline: boolean }[];

    return results.sort((a, b) => b.confidence - a.confidence);
};

export const instantImageCheck = async (base64Image: string): Promise<{ 
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK';
  isPrank: boolean;
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN' | 'NONE';
  reason: string;
}> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const text = await runIntelligentCascade({
      contents: {
        parts: [
          { text: `Safety Analysis. Analyze image. Strict Policy: NO GORE, NO NUDITY, NO SELFIES.
            Return JSON: { "violationType": "GORE"|"NUDITY"|"HUMAN"|"NONE", "isPrank": boolean, "reason": string }` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });

    if (!text) return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Offline" };
    return JSON.parse(cleanJSON(text));
  } catch (e) {
    console.error("[DEBUG_GEMINI] Safety Check Failed:", e);
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const text = await runIntelligentCascade({
        contents: {
            parts: [
                { text: `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for: FACES, ID CARDS, CREDIT CARDS, SCREENS WITH PII. 
                  Return JSON { "regions": [[ymin, xmin, ymax, xmax], ...] }` },
                { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
        },
        config: { responseMimeType: "application/json" }
    });
    
    if (!text) return [];
    const data = JSON.parse(cleanJSON(text));
    return data.regions || [];
  } catch (e) {
    console.error("[DEBUG_GEMINI] Redaction Failed:", e);
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
    const text = await runIntelligentCascade({
      contents: {
        parts: [
          { text: `You are an expert appraiser. Analyze this image for a Lost & Found database.
            Extract details into JSON:
            - title: Short descriptive title (e.g. "Black North Face Backpack").
            - category: Best fit enum (Electronics, Stationery, Clothing, Accessories, ID Cards, Books, Other).
            - tags: List of visual keywords (e.g. ["zipper", "stickers", "scratch"]).
            - color: Dominant color.
            - brand: Brand name if visible (else "Unknown").
            - condition: "New", "Used", "Damaged".
            - distinguishingFeatures: List specific unique identifiers (e.g. "Crack on screen", "Batman sticker").` 
          },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });
    
    if (!text) throw new Error("No AI response");
    const parsed = JSON.parse(cleanJSON(text));
    
    return {
        title: parsed.title || "Found Item",
        category: parsed.category || ItemCategory.OTHER,
        tags: parsed.tags || [],
        color: parsed.color || "Unknown",
        brand: parsed.brand || "Unknown",
        condition: parsed.condition || "Good",
        distinguishingFeatures: parsed.distinguishingFeatures || []
    };
  } catch (e) {
    console.error("[DEBUG_GEMINI] Extraction Failed:", e);
    return { 
      title: "", category: ItemCategory.OTHER, tags: [], 
      color: "", brand: "", condition: "", distinguishingFeatures: [] 
    };
  }
};

export const mergeDescriptions = async (userDistinguishingFeatures: string, visualData: any): Promise<string> => {
    try {
        const text = await runIntelligentCascade({
            contents: {
                parts: [{ text: `
                  Act as a professional copywriter.
                  Create a clear, concise description for a Lost/Found item report.
                  Combine User Notes: "${userDistinguishingFeatures}"
                  With Visual Data: ${JSON.stringify(visualData)}
                  
                  Style: Factual, helpful, easy to read. Max 3 sentences.` 
                }]
            }
        });
        return text || userDistinguishingFeatures;
    } catch (e) {
        return userDistinguishingFeatures;
    }
};

export const validateReportContext = async (reportData: any): Promise<{ isValid: boolean, reason: string }> => {
    try {
        const text = await runIntelligentCascade({
            contents: {
                parts: [{ text: `
                  Review this Lost & Found report for logical consistency.
                  Data: ${JSON.stringify(reportData)}
                  
                  Check for:
                  1. Gibberish or spam titles.
                  2. Contradictions (e.g. Title says "Phone" but Category says "Clothing").
                  3. Abstract locations (e.g. "The Moon", "Nowhere").
                  
                  Output JSON: { "isValid": boolean, "reason": string }` 
                }]
            },
            config: { responseMimeType: "application/json" }
        });
        if (!text) return { isValid: true, reason: "" };
        return JSON.parse(cleanJSON(text));
    } catch (e) {
        return { isValid: true, reason: "" };
    }
};

export const analyzeItemDescription = async (
  description: string,
  base64Images: string[] = [],
  title: string = ""
): Promise<GeminiAnalysisResult> => {
    try {
        const parts: any[] = [{ text: `
          Analyze this item report.
          Title: ${title}
          Description: ${description}
          
          Tasks:
          1. Detect if this is a PRANK or VIOLATION (Drugs, Weapons, Explicit, Gore).
          2. Summarize content.
          3. Extract tags.
          
          Output JSON: 
          {
            "isViolating": boolean,
            "violationType": "GORE"|"ANIMAL"|"HUMAN"|"NONE",
            "violationReason": string,
            "isPrank": boolean,
            "category": string,
            "summary": string,
            "tags": string[],
            "distinguishingFeatures": string[]
          }
        ` }];
        
        base64Images.forEach(img => {
            const data = img.split(',')[1] || img;
            // Limit image size payload for this check to avoid 413
            if (data && data.length < 500000) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
        });

        const text = await runIntelligentCascade({
            contents: { parts },
            config: { responseMimeType: "application/json" }
        });

        if (!text) throw new Error("Cascade failed");
        
        const resultRaw = JSON.parse(cleanJSON(text));
        return {
            isViolating: resultRaw.isViolating || false,
            violationType: resultRaw.violationType || 'NONE',
            violationReason: resultRaw.violationReason || '',
            isPrank: resultRaw.isPrank || false,
            category: resultRaw.category || ItemCategory.OTHER,
            title: title,
            description: description,
            summary: resultRaw.summary || description.substring(0, 50),
            tags: resultRaw.tags || [],
            distinguishingFeatures: resultRaw.distinguishingFeatures || [],
            faceStatus: 'NONE'
        } as any;

    } catch (e) {
        console.error("[DEBUG_GEMINI] Description Analysis Failed:", e);
        return { 
            isViolating: false, isPrank: false, category: ItemCategory.OTHER, 
            title: title || "Item", description, distinguishingFeatures: [], summary: "", tags: [], faceStatus: 'NONE'
        } as any;
    }
};

export const parseSearchQuery = async (query: string): Promise<{ userStatus: 'LOST' | 'FOUND' | 'NONE'; refinedQuery: string }> => {
    try {
        const text = await runIntelligentCascade({
            contents: { parts: [{ text: `
              Analyze user search query: "${query}"
              Determine intent: Is user looking for something they LOST? Or reporting something FOUND?
              Extract the core item keywords.
              
              Output JSON: { "userStatus": "LOST"|"FOUND"|"NONE", "refinedQuery": string }
            ` }] },
            config: { responseMimeType: "application/json" }
        });
        if (text) return JSON.parse(cleanJSON(text));
    } catch(e) {}

    // Heuristic Fallback
    const lower = query.toLowerCase();
    if (lower.includes('lost')) return { userStatus: 'LOST', refinedQuery: query.replace('lost', '').trim() };
    if (lower.includes('found')) return { userStatus: 'FOUND', refinedQuery: query.replace('found', '').trim() };
    return { userStatus: 'NONE', refinedQuery: query };
};

export const compareItems = async (itemA: ItemReport, itemB: ItemReport): Promise<ComparisonResult> => {
  try {
    const prompt = `
      Deep Semantic Comparison.
      ITEM A (Source): ${itemA.title}, ${itemA.description}, Loc: ${itemA.location}, Date: ${itemA.date}
      ITEM B (Candidate): ${itemB.title}, ${itemB.description}, Loc: ${itemB.location}, Date: ${itemB.date}
      
      Task: Determine if these are the SAME physical object.
      1. Analyze Visual/Physical Description match.
      2. Analyze Location/Time plausibility.
      3. Identify contradictions.
      
      Output JSON:
      {
        "confidence": number (0-100),
        "explanation": "concise reasoning",
        "similarities": ["point 1", "point 2"],
        "differences": ["point 1", "point 2"]
      }
    `;

    const parts: any[] = [{ text: prompt }];
    
    const images = [itemA.imageUrls[0], itemB.imageUrls[0]].filter(Boolean);
    images.forEach(img => {
      const data = img.split(',')[1];
      if (data && data.length < 500000) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    });

    const text = await runIntelligentCascade({
       contents: { parts },
       config: { responseMimeType: "application/json" }
    });
    
    if (!text) throw new Error("No comparison result");
    return JSON.parse(cleanJSON(text));
  } catch (e) {
    console.error("[DEBUG_GEMINI] Compare Failed:", e);
    return {
        confidence: 0,
        explanation: "AI Comparison Service currently overloaded. Please review manually.",
        similarities: [],
        differences: []
    };
  }
};
