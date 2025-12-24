
import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";

// Declare global Puter object from the script tag in index.html
declare const puter: any;

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

// --- HELPER: MATCH TIER LOGIC ---
export const getMatchTier = (confidence: number) => {
  if (confidence >= 90) return { label: "Definitive Match", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800", iconName: 'ShieldCheck' };
  if (confidence >= 70) return { label: "Strong Candidate", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-200 dark:border-blue-800", iconName: 'Check' };
  if (confidence >= 40) return { label: "Potential Match", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-200 dark:border-amber-800", iconName: 'HelpCircle' };
  return { label: "Unlikely Match", color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-800", border: "border-slate-200 dark:border-slate-700", iconName: 'X' };
};

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

// --- HELPER: TEXT SIMILARITY (Jaccard Index) - Used for Fallback only ---
const calculateTextSimilarity = (str1: string, str2: string): number => {
    const set1 = new Set(str1.toLowerCase().split(/\W+/).filter(x => x.length > 2));
    const set2 = new Set(str2.toLowerCase().split(/\W+/).filter(x => x.length > 2));
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
};

// --- HELPER: PUTER WRAPPER ---
// Updated to accept string array for images
const callPuterAI = async (
  prompt: string, 
  images?: string | string[], 
  systemInstruction?: string
): Promise<string | null> => {
  if (typeof puter === 'undefined') {
      console.error("[Retriva] Puter.js is not loaded in window.");
      return null;
  }

  try {
    const fullPrompt = systemInstruction 
      ? `SYSTEM INSTRUCTION: ${systemInstruction}\n\nUSER QUERY: ${prompt}` 
      : prompt;

    let response;
    
    try {
        if (images) {
           // Pass images (single string or array) directly to puter
           response = await puter.ai.chat(fullPrompt, images);
        } else {
           response = await puter.ai.chat(fullPrompt);
        }
    } catch (innerError: any) {
        if (innerError?.message?.includes('401') || innerError?.code === 401) {
             console.log("[Puter] Auth required. Attempting to sign in...");
             await puter.auth.signIn();
             if (images) {
                response = await puter.ai.chat(fullPrompt, images);
             } else {
                response = await puter.ai.chat(fullPrompt);
             }
        } else {
            throw innerError;
        }
    }

    if (typeof response === 'string') return response;
    if (response?.message?.content) return response.message.content;
    if (response?.text) return response.text;
    
    return JSON.stringify(response);

  } catch (error: any) {
    console.error(`[Puter] AI Error:`, error);
    return null;
  }
};

// --- FALLBACK LOGIC ---
const fallbackComparison = (item1: ItemReport, item2: ItemReport): ComparisonResult => {
     let score = 0;
     const sim = [];
     const diff = [];
     
     // 1. Category Check
     if (item1.category === item2.category) {
         score += 25;
         sim.push("Same Category");
     } else {
         diff.push(`Different Categories`);
     }
     
     // 2. Title Similarity
     const titleSim = calculateTextSimilarity(item1.title, item2.title);
     if (titleSim > 0.8) {
         score += 35;
         sim.push("Identical Titles");
     } else if (titleSim > 0.4) {
         score += 20;
         sim.push("Similar Titles");
     }

     // 3. Description Similarity
     const descSim = calculateTextSimilarity(item1.description, item2.description);
     if (descSim > 0.8) {
         score += 40;
         sim.push("Matching Description");
     } else if (descSim > 0.3) {
         score += 15 + (descSim * 20);
         sim.push("Shared Keywords");
     }

     return {
         confidence: Math.min(Math.round(score), 90),
         explanation: "AI Unavailable. Comparison based on text keywords.",
         similarities: sim,
         differences: diff
     };
};

// --- EXPORTED FEATURES (API) ---

export const findSmartMatches = async (sourceItem: ItemReport, allReports: ItemReport[]): Promise<{ report: ItemReport, confidence: number, isOffline: boolean }[]> => {
    
    const targetType = sourceItem.type === 'LOST' ? 'FOUND' : 'LOST';
    
    let candidates = allReports.filter(r => 
        r.status === 'OPEN' && 
        r.type === targetType &&
        r.id !== sourceItem.id
    );

    if (candidates.length === 0) return [];

    // Removed strict category filtering to allow for user classification errors (e.g. Electronics vs Accessories)
    // We limit candidates to top 15 by recency to save tokens
    if (candidates.length > 15) candidates = candidates.slice(0, 15);

    let matchResults: MatchCandidate[] = [];
    let usedAI = false;
    
    // Use FULL keys so AI understands context, including SPECS if available
    const aiCandidates = candidates.map(c => ({ 
        id: c.id, 
        title: c.title, 
        description: c.description,
        specs: c.specs || {}, // Pass structured data to AI
        location: c.location,
        category: c.category,
        visual_tags: c.tags.join(', ')
    }));

    const sourceData = `TITLE: ${sourceItem.title}. DESC: ${sourceItem.description}. CAT: ${sourceItem.category}. SPECS: ${JSON.stringify(sourceItem.specs || {})}. LOC: ${sourceItem.location}.`;

    try {
        const fullPrompt = `
          ACT AS A LOST & FOUND MATCHER.
          
          TARGET ITEM: ${sourceData}
          CANDIDATES DATABASE: ${JSON.stringify(aiCandidates)}
          
          INSTRUCTIONS:
          1. Analyze the semantic meaning AND specific specs (e.g. Serial numbers are definitive).
          2. Ignore minor category mismatches (e.g. Electronics vs Other).
          3. Return a JSON object with a list of matches that have a probability > 40%.
          
          JSON FORMAT: 
          { "matches": [ { "id": "candidate_id", "confidence": number } ] }
        `;
        
        const text = await callPuterAI(fullPrompt);

        if (text) {
            const cleanText = cleanJSON(text);
            const data = JSON.parse(cleanText);
            matchResults = data.matches || [];
            usedAI = true;
        }
    } catch (e) {
        console.error("[Gemini] Smart Match Logic Error:", e);
    }

    // Fallback
    if (!usedAI || matchResults.length === 0) {
        matchResults = candidates.map(c => {
            const titleSim = calculateTextSimilarity(sourceItem.title, c.title);
            const descSim = calculateTextSimilarity(sourceItem.description, c.description);
            let score = (titleSim * 50) + (descSim * 50);
            if (c.category === sourceItem.category) score += 10;
            return { id: c.id, confidence: Math.min(score, 100) };
        }).filter(m => m.confidence > 20);
    }

    const results = matchResults.map(m => {
        const report = candidates.find(c => c.id === m.id);
        return report ? { report, confidence: Math.round(m.confidence), isOffline: !usedAI } : null;
    }).filter(Boolean) as { report: ItemReport, confidence: number, isOffline: boolean }[];

    return results.sort((a, b) => b.confidence - a.confidence);
};

export const instantImageCheck = async (base64Image: string): Promise<{ 
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK';
  isPrank: boolean;
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN_PORTRAIT' | 'NONE';
  context: 'ITEM' | 'DOCUMENT' | 'HUMAN';
  reason: string;
}> => {
  try {
    const text = await callPuterAI(
      `Safety & Context Analysis for Lost & Found.
       
       STRICT RULES:
       1. REJECT ("HUMAN_PORTRAIT") if the main subject is a live human, selfie, or group photo.
       2. REJECT ("GORE" / "ANIMAL") if violence, nudity, or dead animals.
       3. ACCEPT ("DOCUMENT") if it is an ID Card, Student ID, or Document, EVEN IF IT HAS A FACE. We will redact it later.
       4. ACCEPT ("ITEM") if it is an inanimate object (phone, keys, etc).

       Return JSON: 
       { 
         "violationType": "GORE"|"ANIMAL"|"HUMAN_PORTRAIT"|"NONE", 
         "context": "ITEM"|"DOCUMENT"|"HUMAN",
         "isPrank": boolean, 
         "reason": "short explanation" 
       }`,
       base64Image
    );

    if (!text) return { faceStatus: 'NONE', violationType: 'NONE', context: 'ITEM', isPrank: false, reason: "Offline" };
    const result = JSON.parse(cleanJSON(text));
    
    return {
        faceStatus: result.faceStatus || 'NONE',
        violationType: result.violationType || 'NONE',
        context: result.context || 'ITEM',
        isPrank: result.isPrank || false,
        reason: result.reason || ''
    };
  } catch (e) {
    return { faceStatus: 'NONE', violationType: 'NONE', context: 'ITEM', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  try {
    const text = await callPuterAI(
      `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for sensitive info.
       TARGETS: 
       1. FACES (Both real faces and ID card photos)
       2. ID NUMBERS / NAMES / ADDRESSES
       
       Return JSON { "regions": [[ymin, xmin, ymax, xmax], ...] }`,
       base64Image
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
  specs: Record<string, string>;
  color: string;
  distinguishingFeatures: string[];
}> => {
  try {
    const text = await callPuterAI(
       `Extract strict technical item details.
        
        OUTPUT JSON FORMAT:
        {
          "title": "Short title",
          "category": "Electronics" | "Clothing" | "Accessories" | "Stationery" | "ID Cards" | "Other",
          "color": "Dominant Color",
          "tags": ["tag1", "tag2"],
          "specs": {
             // IF ELECTRONICS: "brand", "model", "serialNumber" (if visible)
             // IF CLOTHING: "brand", "size" (if visible), "material"
             // IF ID CARD: "issuer", "type"
             // IF KEYS: "count", "type" (car/house), "keychain"
             // OTHERWISE: generic key-value pairs of visible text/data
          },
          "distinguishingFeatures": ["scratch on screen", "sticker", "dent"]
        }`,
        base64Image
    );
    
    if (!text) throw new Error("No response");
    const parsed = JSON.parse(cleanJSON(text));
    
    return {
        title: parsed.title || "",
        category: parsed.category || ItemCategory.OTHER,
        tags: parsed.tags || [],
        specs: parsed.specs || {},
        color: parsed.color || "",
        distinguishingFeatures: parsed.distinguishingFeatures || []
    };
  } catch (e) {
    return { 
      title: "", category: ItemCategory.OTHER, tags: [], 
      specs: {}, color: "", distinguishingFeatures: [] 
    };
  }
};

export const mergeDescriptions = async (userDistinguishingFeatures: string, visualData: any): Promise<string> => {
    try {
        const text = await callPuterAI(
          `Write a concise, factual description for a Lost & Found report.
           Focus on identifiers (Brand, Specs, Markings).
           User Input: "${userDistinguishingFeatures}"
           AI Visual Data: ${JSON.stringify(visualData)}`,
        );
        return text || userDistinguishingFeatures;
    } catch (e) {
        return userDistinguishingFeatures;
    }
};

export const validateReportContext = async (reportData: any): Promise<{ isValid: boolean, reason: string }> => {
    try {
        const text = await callPuterAI(
          `Validate Report Logic. 
           Check for:
           1. Mismatch (e.g. Title says "Laptop" but Category is "Clothing")
           2. Vague Location (e.g. "On earth")
           
           Return JSON { "isValid": boolean, "reason": string }. 
           Data: ${JSON.stringify(reportData)}`
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
          Analyze: "${title} - ${description}".
          Output JSON: { "isViolating": boolean, "violationType": string, "summary": string, "tags": string[] }
        `;
        
        const img = base64Images.length > 0 ? base64Images[0] : undefined;
        const text = await callPuterAI(prompt, img);

        if (!text) throw new Error("Failed");
        
        const result = JSON.parse(cleanJSON(text));
        return {
            category: result.category || ItemCategory.OTHER,
            title: title,
            summary: result.summary || description,
            tags: result.tags || [],
            description: description,
            distinguishingFeatures: [],
            isPrank: false,
            faceStatus: 'NONE',
            isViolating: result.isViolating || false,
            violationType: result.violationType,
            violationReason: result.violationReason
        };
    } catch (e) {
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
        const text = await callPuterAI(
          `Analyze query: "${query}". Return JSON { "userStatus": "LOST"|"FOUND"|"UNKNOWN", "refinedQuery": "keywords" }`
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
        // Collect images from both items for visual comparison
        const imagesToAnalyze: string[] = [];
        if (item1.imageUrls?.[0]) imagesToAnalyze.push(item1.imageUrls[0]);
        if (item2.imageUrls?.[0]) imagesToAnalyze.push(item2.imageUrls[0]);

        const prompt = `
           You are a highly precise Forensic Object Analyst using Gemini 3.0 Vision capabilities.
           
           OBJECTIVE:
           Compare "Item A" (Lost Report) and "Item B" (Found Report) tip-to-tip and determine the probability (0-100%) that they are the EXACT SAME physical object.
           
           DATA SOURCE:
           Item A:
           - Title: "${item1.title}"
           - Category: "${item1.category}"
           - Specs: ${JSON.stringify(item1.specs || {})}
           - Visual Tags: "${item1.tags.join(', ')}"
           
           Item B:
           - Title: "${item2.title}"
           - Category: "${item2.category}"
           - Specs: ${JSON.stringify(item2.specs || {})}
           - Visual Tags: "${item2.tags.join(', ')}"

           VISUAL EVIDENCE:
           ${imagesToAnalyze.length} images provided.

           EXECUTION PLAN:
           1. SPEC ANALYSIS: Compare strict specs (e.g. Serial #, Brand, Model). Exact Match = 100%. Mismatch = 0%.
           2. VISUAL ANALYSIS: Inspect images for unique identifiers (scratches, stickers, wear patterns, exact color hue).
           3. EVALUATE: Calculate a confidence score based on the weight of evidence.
           
           SCORING CALIBRATION:
           - 99-100%: Definitive Match (Matching Serial # or unique wear pattern).
           - 80-94%: High Probability (Identical model + color + no contradictions).
           - 50-79%: Plausible (Same generic category/color).
           - 0-49%: Mismatch (Different specs, brand, or shape).

           OUTPUT FORMAT (JSON ONLY):
           { 
              "confidence": number (Integer 0-100), 
              "explanation": "Detailed chain-of-thought reasoning.", 
              "similarities": ["Sim 1", "Sim 2"], 
              "differences": ["Diff 1", "Diff 2"] 
           }
        `;

        // Pass array of images (1 or 2 images) to the AI
        const text = await callPuterAI(prompt, imagesToAnalyze.length > 0 ? imagesToAnalyze : undefined);

        if (!text) throw new Error("No response");
        
        const result = JSON.parse(cleanJSON(text));
        
        // --- SCORE NORMALIZATION LOGIC ---
        let conf = result.confidence;
        
        // Fix: Some models output "1" to mean "100% / True". 
        // If score is exactly 1, and the explanation is positive, treat as 100%.
        if (conf === 1) {
             conf = 100;
        } else if (conf < 1 && conf > 0) {
             // Handle decimal (0.95 -> 95)
             conf = conf * 100;
        }
        
        // Ensure integer
        conf = Math.round(conf);
        
        // --- LOGIC SAFETY NET ---
        // If texts are highly similar (Jaccard > 0.8), don't let AI hallucinate a very low score.
        const textSim = calculateTextSimilarity(item1.title, item2.title);
        if (textSim > 0.8 && conf < 60) {
            conf = 75; // Boost to "Plausible" if title is identical but AI was unsure visually
            result.explanation += " (Score boosted due to exact title match).";
        }
        
        // Safety cap
        if (conf > 100) conf = 100;

        return {
            ...result,
            confidence: conf
        };

    } catch (e) {
        console.error("AI Compare Failed, using fallback:", e);
        return fallbackComparison(item1, item2);
    }
};
