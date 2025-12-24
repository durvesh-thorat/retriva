import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

// --- HELPER: ROBUST JSON PARSER ---
const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  // Remove Markdown code blocks (case insensitive)
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  
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

// --- HELPER: GEMINI WRAPPER ---
const callGeminiAI = async (
  prompt: string, 
  image?: string, 
  systemInstruction?: string,
  model = 'gemini-3-flash-preview' 
): Promise<string | null> => {
  try {
    const parts: any[] = [];
    
    // Handle Image if present
    if (image) {
        // Extract base64 data and mime type
        // Assume format "data:image/png;base64,..."
        const match = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (match) {
             parts.push({
                 inlineData: {
                     mimeType: match[1],
                     data: match[2]
                 }
             });
        }
    }

    parts.push({ text: prompt });

    const config: any = {};
    if (systemInstruction) {
        config.systemInstruction = systemInstruction;
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: { parts },
      config: config
    });

    return response.text || null;

  } catch (error: any) {
    console.error(`[Gemini] AI Error (${model}):`, error);
    return null;
  }
};

// --- EXPORTED FEATURES (API) ---

export const findSmartMatches = async (sourceItem: ItemReport, allReports: ItemReport[]): Promise<{ report: ItemReport, confidence: number, isOffline: boolean }[]> => {
    
    console.log(`[Retriva] 🔍 Starting Smart Match via Gemini for: ${sourceItem.title}`);

    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST';
    
    // 1. Loose Pre-Filtering
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType &&
        r.id !== sourceItem.id
    );

    if (candidates.length > 40) candidates = candidates.slice(0, 40);
    if (candidates.length === 0) return [];

    let matchResults: MatchCandidate[] = [];
    let usedAI = false;
    
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
          You are a Forensic Recovery Agent. Match the TARGET ITEM with CANDIDATES.
          RULES:
          1. Semantic Matching: "AirPods" == "Earbuds".
          2. Hard Constraints: Reject if visual attributes contradict (e.g. Red vs Blue).
          3. Soft Constraints: Allow fuzzy time/location.
          4. Confidence Score (0-100).
          
          OUTPUT JSON: { "matches": [ { "id": "string", "confidence": number, "reason": "string" } ] }
          Only include confidence > 40. Return ONLY JSON.
        `;

        const fullPrompt = `INPUT CANDIDATES: ${JSON.stringify(aiCandidates)}\nTARGET ITEM: ${sourceData}`;
        
        // Use gemini-3-pro-preview for complex reasoning
        const text = await callGeminiAI(fullPrompt, undefined, systemPrompt, 'gemini-3-pro-preview');

        if (text) {
            const cleanText = cleanJSON(text);
            const data = JSON.parse(cleanText);
            matchResults = data.matches || [];
            usedAI = true;
        }
    } catch (e) {
        console.error("[Gemini] Smart Match Logic Error:", e);
    }

    // 3. Fallback
    if (!usedAI) {
        matchResults = candidates
            .map(c => {
                let score = 0;
                if (c.category === sourceItem.category) score += 30;
                if (c.title.toLowerCase().includes(sourceItem.title.toLowerCase())) score += 40;
                return { id: c.id, confidence: score, reason: "Keyword Fallback" };
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
    const text = await callGeminiAI(
      `Safety Analysis. Strict Policy: NO GORE, NO NUDITY, NO SELFIES.
       Return JSON: { "violationType": "GORE"|"NUDITY"|"HUMAN"|"NONE", "isPrank": boolean, "reason": string }`,
       base64Image,
       undefined,
       'gemini-3-flash-preview'
    );

    if (!text) return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Offline" };
    const result = JSON.parse(cleanJSON(text));
    return {
        faceStatus: result.faceStatus || 'NONE',
        violationType: result.violationType || 'NONE',
        isPrank: result.isPrank || false,
        reason: result.reason || ''
    };
  } catch (e) {
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  try {
    const text = await callGeminiAI(
      `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for: FACES, ID CARDS, CREDIT CARDS, SCREENS WITH PII. 
       Return JSON { "regions": [[ymin, xmin, ymax, xmax], ...] }`,
       base64Image,
       undefined,
       'gemini-3-flash-preview'
    );
    
    if (!text) return [];
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
    // Using gemini-3-pro-preview for higher quality extraction
    const text = await callGeminiAI(
       `Expert Appraiser. Extract details for Lost & Found.
        Output JSON:
        - title: Short descriptive title.
        - category: Enum (Electronics, Stationery, Clothing, Accessories, ID Cards, Books, Other).
        - tags: Visual keywords.
        - color: Dominant color.
        - brand: Brand name or "Unknown".
        - condition: "New", "Used", "Damaged".
        - distinguishingFeatures: Unique identifiers (scratches, stickers).`,
        base64Image,
        undefined,
        'gemini-3-pro-preview'
    );
    
    if (!text) throw new Error("No response");
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
    return { 
      title: "", category: ItemCategory.OTHER, tags: [], 
      color: "", brand: "", condition: "", distinguishingFeatures: [] 
    };
  }
};

export const mergeDescriptions = async (userDistinguishingFeatures: string, visualData: any): Promise<string> => {
    try {
        const text = await callGeminiAI(
          `Create a concise Lost/Found item description.
           User Notes: "${userDistinguishingFeatures}"
           Visual Data: ${JSON.stringify(visualData)}
           Style: Factual, helpful. Max 3 sentences. Return text only.`,
           undefined,
           undefined,
           'gemini-3-flash-preview'
        );
        return text || userDistinguishingFeatures;
    } catch (e) {
        return userDistinguishingFeatures;
    }
};

export const validateReportContext = async (reportData: any): Promise<{ isValid: boolean, reason: string }> => {
    try {
        const text = await callGeminiAI(
          `Review Lost & Found report for consistency.
           Data: ${JSON.stringify(reportData)}
           Output JSON: { "isValid": boolean, "reason": string }`,
           undefined,
           undefined,
           'gemini-3-flash-preview'
        );
        if (!text) return { isValid: true, reason: "" };
        const result = JSON.parse(cleanJSON(text));
        return { isValid: result.isValid ?? true, reason: result.reason || "" };
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
        const prompt = `
          Analyze item report: "${title} - ${description}".
          Tasks: Detect VIOLATION (Drugs, Weapons, Gore), summarize, tag.
          Output JSON: { "isViolating": boolean, "violationType": string, "violationReason": string, "isPrank": boolean, "category": string, "summary": string, "tags": string[], "distinguishingFeatures": string[] }
        `;
        
        // Pass first image if available
        const img = base64Images.length > 0 ? base64Images[0] : undefined;

        const text = await callGeminiAI(prompt, img, undefined, 'gemini-3-flash-preview');

        if (!text) throw new Error("Failed");
        
        const result = JSON.parse(cleanJSON(text));
        return {
            category: result.category || ItemCategory.OTHER,
            title: title,
            summary: result.summary || description,
            tags: result.tags || [],
            description: description,
            distinguishingFeatures: result.distinguishingFeatures || [],
            isPrank: result.isPrank || false,
            prankReason: result.violationReason,
            faceStatus: 'NONE',
            isViolating: result.isViolating || false,
            violationType: result.violationType,
            violationReason: result.violationReason
        };
    } catch (e) {
        // Fallback
        return {
            category: ItemCategory.OTHER,
            title,
            summary: description,
            tags: [],
            description,
            distinguishingFeatures: [],
            isPrank: false,
            faceStatus: 'NONE',
            isViolating: false
        };
    }
};

export const parseSearchQuery = async (query: string): Promise<{ userStatus: 'LOST' | 'FOUND' | 'UNKNOWN', refinedQuery: string }> => {
    try {
        const text = await callGeminiAI(
          `Parse search query: "${query}".
           Determine if user is LOOKING FOR something they lost (userStatus=LOST) or FOUND something (userStatus=FOUND).
           Extract core keywords.
           Output JSON: { "userStatus": "LOST"|"FOUND"|"UNKNOWN", "refinedQuery": "string" }`,
           undefined, 
           undefined,
           'gemini-3-flash-preview'
        );
        
        if (!text) throw new Error("No text");
        const result = JSON.parse(cleanJSON(text));
        return { userStatus: result.userStatus || 'UNKNOWN', refinedQuery: result.refinedQuery || query };
    } catch (e) {
        return { userStatus: 'UNKNOWN', refinedQuery: query };
    }
};

export const compareItems = async (item1: ItemReport, item2: ItemReport): Promise<ComparisonResult> => {
    try {
         const prompt = `
            COMPARE ITEM A and ITEM B.
            Item A: ${item1.title}, ${item1.description}, ${item1.category}, Tags: ${item1.tags?.join(', ') || 'None'}
            Item B: ${item2.title}, ${item2.description}, ${item2.category}, Tags: ${item2.tags?.join(', ') || 'None'}
            
            Are they the same physical object?
            Output JSON: { "confidence": number (0-100), "explanation": "string", "similarities": ["string"], "differences": ["string"] }
         `;

         // Use gemini-3-pro-preview for comparison reasoning
         const text = await callGeminiAI(prompt, undefined, undefined, 'gemini-3-pro-preview');

         if (!text) throw new Error("No response");
         return JSON.parse(cleanJSON(text));
    } catch (e) {
        return { confidence: 0, explanation: "Comparison failed", similarities: [], differences: [] };
    }
};