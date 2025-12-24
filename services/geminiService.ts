
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
    
    // Use FULL keys so AI understands context
    const aiCandidates = candidates.map(c => ({ 
        id: c.id, 
        title: c.title, 
        description: c.description,
        location: c.location,
        category: c.category,
        visual_tags: c.tags.join(', ')
    }));

    const sourceData = `TITLE: ${sourceItem.title}. DESC: ${sourceItem.description}. CAT: ${sourceItem.category}. LOC: ${sourceItem.location}. TAGS: ${sourceItem.tags.join(', ')}`;

    try {
        const fullPrompt = `
          ACT AS A LOST & FOUND MATCHER.
          
          TARGET ITEM: ${sourceData}
          CANDIDATES DATABASE: ${JSON.stringify(aiCandidates)}
          
          INSTRUCTIONS:
          1. Analyze the semantic meaning. "MacBook" == "Laptop". "Keys" == "Keychain".
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
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN' | 'NONE';
  reason: string;
}> => {
  try {
    const text = await callPuterAI(
      `Safety Check. 
       Rules: NO VIOLENCE, NO NUDITY, NO SELFIES.
       Return JSON: { "violationType": "GORE"|"NUDITY"|"HUMAN"|"NONE", "isPrank": boolean, "reason": "string" }`,
       base64Image
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
    const text = await callPuterAI(
      `Identify bounding boxes [ymin, xmin, ymax, xmax] (scale 0-1000) for: FACES, ID CARDS. 
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
  color: string;
  brand: string;
  condition: string;
  distinguishingFeatures: string[];
}> => {
  try {
    const text = await callPuterAI(
       `Extract Item Details.
        JSON Output:
        - title: string
        - category: string
        - tags: string[]
        - color: string
        - brand: string
        - condition: string
        - distinguishingFeatures: string[]`,
        base64Image
    );
    
    if (!text) throw new Error("No response");
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

export const mergeDescriptions = async (userDistinguishingFeatures: string, visualData: any): Promise<string> => {
    try {
        const text = await callPuterAI(
          `Write a 2-sentence description for a Lost & Found post based on:
           User Notes: "${userDistinguishingFeatures}"
           Visuals: ${JSON.stringify(visualData)}`,
        );
        return text || userDistinguishingFeatures;
    } catch (e) {
        return userDistinguishingFeatures;
    }
};

export const validateReportContext = async (reportData: any): Promise<{ isValid: boolean, reason: string }> => {
    try {
        const text = await callPuterAI(
          `Validate Report. Return JSON { "isValid": boolean, "reason": string }. Data: ${JSON.stringify(reportData)}`
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
           - Description: "${item1.description}"
           - Category: "${item1.category}"
           - Location: "${item1.location}"
           - Color/Brand: "${item1.tags.join(', ')}"
           
           Item B:
           - Title: "${item2.title}"
           - Description: "${item2.description}"
           - Category: "${item2.category}"
           - Location: "${item2.location}"
           - Color/Brand: "${item2.tags.join(', ')}"

           VISUAL EVIDENCE:
           ${imagesToAnalyze.length} images provided.

           EXECUTION PLAN:
           1. TEXT ANALYSIS: Compare textual attributes (Brand, Model, Serial Number). 
           2. VISUAL ANALYSIS: Inspect images for unique identifiers (scratches, stickers, wear patterns, exact color hue).
           3. EVALUATE: Calculate a confidence score based on the weight of evidence.
           
           SCORING CALIBRATION:
           - 95-100%: Definitive Match. (e.g. matching serial number, unique sticker, or distinctive damage pattern).
           - 80-94%: High Probability. (e.g. identical make/model/color, matching description, consistent location).
           - 50-79%: Plausible. (e.g. same category/color, generic item like "Black Umbrella" with no unique features).
           - 0-49%: Mismatch. (Different brand, different shape, contradictory features).

           OUTPUT FORMAT (JSON ONLY):
           { 
              "confidence": number (Integer 0-100), 
              "explanation": "Detailed chain-of-thought reasoning citing specific visual and text evidence.", 
              "similarities": ["Specific matching feature 1", "Specific matching feature 2"], 
              "differences": ["Contradiction 1", "Contradiction 2"] 
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
