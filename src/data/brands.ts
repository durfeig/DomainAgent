/**
 * Basic trademark screen list (NOT legal advice, NOT exhaustive).
 * `generic: true` marks brands that are also ordinary dictionary words: using the word is
 * not automatically infringing, so they score MEDIUM instead of HIGH.
 * Extend freely; matches are case-insensitive on domain parts and substrings.
 */
export interface Brand {
  name: string;
  generic?: boolean;
}

const distinctive = [
  // AI labs & models
  "openai", "chatgpt", "gpt", "anthropic", "claude", "gemini", "bard", "deepmind", "mistral", "llama", "copilot",
  "midjourney", "perplexity", "huggingface", "replicate", "cohere", "groq", "xai", "grok", "deepseek", "qwen",
  "stability", "runway", "elevenlabs", "synthesia", "jasper", "characterai", "langchain", "llamaindex", "crewai",
  "autogpt", "devin", "cursor", "windsurf", "codeium", "lovable", "bolt", "vercel", "supabase", "firebase",
  "pinecone", "weaviate", "chroma", "ollama", "nvidia", "cuda", "openrouter", "manus", "sora", "dalle",
  // Big tech & platforms
  "google", "youtube", "android", "chrome", "gmail", "alphabet", "microsoft", "windows", "azure", "xbox", "linkedin",
  "github", "amazon", "alexa", "aws", "kindle", "facebook", "instagram", "whatsapp", "messenger", "threads", "oculus",
  "iphone", "ipad", "macbook", "itunes", "siri", "icloud", "netflix", "spotify", "tiktok", "bytedance", "snapchat",
  "twitter", "telegram", "discord", "reddit", "pinterest", "salesforce", "slack", "hubspot", "zendesk", "intercom",
  "shopify", "stripe", "paypal", "venmo", "klarna", "affirm", "adyen", "plaid", "coinbase", "binance", "visa",
  "mastercard", "amex", "revolut", "wise", "ebay", "etsy", "alibaba", "aliexpress", "temu", "shein", "walmart",
  "target", "costco", "uber", "lyft", "airbnb", "doordash", "instacart", "zoom", "dropbox", "notion", "figma",
  "canva", "adobe", "photoshop", "atlassian", "jira", "confluence", "trello", "asana", "clickup", "monday",
  "airtable", "zapier", "make", "twilio", "okta", "auth0", "cloudflare", "akamai", "oracle", "sap", "ibm", "intel",
  "amd", "qualcomm", "samsung", "sony", "tesla", "spacex", "starlink", "nike", "adidas", "cocacola", "pepsi",
  "mcdonalds", "starbucks", "disney", "marvel", "pixar", "lego", "nintendo", "playstation", "mercadolibre",
  "mercadopago", "rappi", "nubank", "vtex", "namebio", "godaddy", "namecheap", "sedo", "afternic", "squarespace",
  "wix", "wordpress", "webflow", "framer", "docusign", "calendly", "loom", "miro", "grammarly", "duolingo",
];

const genericWords = [
  "apple", "meta", "square", "linear", "notion", "slack", "zoom", "target", "visa", "wise", "make", "monday",
  "bolt", "runway", "chroma", "stability", "threads", "messenger", "windows", "cursor", "amazon", "oracle",
  "shell", "gap", "dove", "corona", "mint", "ring", "nest", "echo", "prime", "pixel", "surface", "edge", "office",
];

export const BRANDS: Brand[] = [
  ...distinctive.filter((b) => !genericWords.includes(b)).map((name) => ({ name })),
  ...genericWords.map((name) => ({ name, generic: true })),
];
