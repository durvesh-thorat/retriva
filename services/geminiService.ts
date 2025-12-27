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

// --- HELPER: PUTER WRAPPER (FIXED) ---
const callPuterAI = async (
  prompt: string, 
  images?: string | string[], 
  systemInstruction?: string
): Promise<string | null> => {
  if (typeof puter === 'undefined') {
      console.error("[Retriva] Puter.js is not loaded in window.");
      return null;
  }

  const fullPrompt = systemInstruction 
      ? `SYSTEM INSTRUCTION: ${systemInstruction}\n\nUSER QUERY: ${prompt}` 
      : prompt;

  // OPTIMIZATION: Puter V2 works best with a single image string.
  // Sending an array of large base64 strings often causes "No response" timeouts.
  let imagePayload: string | undefined = undefined;
  if (images) {
      if (Array.isArray(images)) {
          // Take the first image only to reduce payload size
          imagePayload = images.length > 0 ? images[0] : undefined;
      } else {
          imagePayload = images;
      }
  }

  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        let response;
        
        if (imagePayload) {
           response = await puter.ai.chat(fullPrompt, imagePayload);
        } else {
           response = await puter.ai.chat(fullPrompt);
        }

        // Check for specific Puter failure object
        if (typeof response === 'object' && response !== null) {
            if (response.success === false) {
                 throw new Error(response.error || "Puter returned success: false");
            }
        }

        if (typeof response === 'string') return response;
        if (response?.message?.content) return response.message.content;
        if (response?.text) return response.text;
        
        return JSON.stringify(response);

      } catch (innerError: any) {
        lastError = innerError;
        console.warn(`[Puter] Attempt ${attempt} failed:`, innerError);

        // Handle Auth Challenge
        if (innerError?.message?.includes('401') || innerError?.code === 401) {
             console.log("[Puter] Auth required. Attempting to sign in...");
             try {
                 await puter.auth.signIn();
                 continue; // Retry immediately
             } catch (authErr) {
                 console.error("Puter Auth failed", authErr);
                 return null;
             }
        }

        // For "No response" or other network errors, wait before retrying (Exponential Backoff)
        if (attempt < MAX_RETRIES) {
             const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
             await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
  }

  console.error(`[Puter] AI Error after ${MAX_RETRIES} attempts:`, lastError);
  return null;
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

    // Limit candidates to 8 to reduce context window size
    if (candidates.length > 8) candidates = candidates.slice(0, 8);

    let matchResults: MatchCandidate[] = [];
    let usedAI = false;
    
    // Use simplified keys to save tokens
    const aiCandidates = candidates.map(c => ({ 
        id: c.id, 
        title: c.title, 
        desc: c.description.slice(0, 100), // Truncate for performance
        cat: c.category
    }));

    const sourceData = `ITEM: ${sourceItem.title}. DESC: ${sourceItem.description.slice(0, 150)}. CAT: ${sourceItem.category}.`;

    try {
        const fullPrompt = `
          ACT AS A MATCHER.
          TARGET: ${sourceData}
          CANDIDATES: ${JSON.stringify(aiCandidates)}
          
          TASK: Return JSON of matches > 40% probability.
          FORMAT: { "matches": [ { "id": "candidate_id", "confidence": number } ] }
        `;
        
        const text = await callPuterAI(fullPrompt);

        if (text) {
            const cleanText = cleanJSON(text);
            try {
                const data = JSON.parse(cleanText);
                matchResults = data.matches || [];
                usedAI = true;
            } catch (jsonErr) {
                 const sanitized = cleanText.replace(/[\x00-\x1F]/g, " ");
                 const data = JSON.parse(sanitized);
                 matchResults = data.matches || [];
                 usedAI = true;
            }
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
    // Simplify prompt to reduce token usage and improve response speed
    const text = await callPuterAI(
      `Analyze image for Lost & Found safety.
       RULES:
       1. REJECT if Animal/Pet ("ANIMAL").
       2. REJECT if Selfie/Person ("HUMAN_PORTRAIT").
       3. REJECT if Gore/Violence ("GORE").
       4. ACCEPT if ID Card ("DOCUMENT").
       5. ACCEPT if Object ("ITEM").

       JSON OUTPUT: 
       { 
         "violationType": "GORE"|"ANIMAL"|"HUMAN_PORTRAIT"|"NONE", 
         "context": "ITEM"|"DOCUMENT"|"HUMAN",
         "isPrank": boolean, 
         "reason": "string" 
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
      `Find bounding boxes [ymin, xmin, ymax, xmax] (0-1000) for FACES or ID NUMBERS.
       JSON: { "regions": [[ymin, xmin, ymax, xmax]] }`,
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
       `Extract item details JSON:
        {
          "title": "Short title",
          "category": "Electronics" | "Clothing" | "Accessories" | "Stationery" | "ID Cards" | "Other",
          "color": "Color",
          "tags": ["tag1"],
          "specs": { "brand": "Brand", "model": "Model" },
          "distinguishingFeatures": ["scratch", "dent"]
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
          `Write concise Lost&Found description.
           User: "${userDistinguishingFeatures}"
           Visual: ${JSON.stringify(visualData)}`,
        );
        return text || userDistinguishingFeatures;
    } catch (e) {
        return userDistinguishingFeatures;
    }
};

export const validateReportContext = async (reportData: any): Promise<{ isValid: boolean, reason: string }> => {
    try {
        const text = await callPuterAI(
          `Validate Lost & Found Item.
           Block: Animals, Illicit, Nonsense.
           JSON: { "isValid": boolean, "reason": "string" }.
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
        
        const text = await callPuterAI(prompt, base64Images);

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
        // Optimization: Only use the first image from each to reduce payload
        const imagesToAnalyze: string[] = [];
        if (item1.imageUrls?.[0]) imagesToAnalyze.push(item1.imageUrls[0]);
        if (item2.imageUrls?.[0]) imagesToAnalyze.push(item2.imageUrls[0]);

        const prompt = `
           Compare Item A and Item B. Same object?
           
           A: ${item1.title}, ${item1.description}, ${item1.category}
           B: ${item2.title}, ${item2.description}, ${item2.category}

           OUTPUT JSON:
           { 
              "confidence": number (0-100), 
              "explanation": "string", 
              "similarities": ["string"], 
              "differences": ["string"] 
           }
        `;

        const text = await callPuterAI(prompt, imagesToAnalyze);

        if (!text) throw new Error("No response");
        
        const cleanedText = cleanJSON(text);
        let result;
        
        try {
            result = JSON.parse(cleanedText);
        } catch (parseError: any) {
            const sanitized = cleanedText.replace(/[\x00-\x1F]/g, " ");
            result = JSON.parse(sanitized);
        }
        
        let conf = result.confidence;
        if (conf === 1) conf = 100;
        else if (conf < 1 && conf > 0) conf = conf * 100;
        conf = Math.round(conf);
        
        const textSim = calculateTextSimilarity(item1.title, item2.title);
        if (textSim > 0.8 && conf < 60) {
            conf = 75; 
            result.explanation += " (Title match boost)";
        }
        
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