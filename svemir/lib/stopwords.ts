/**
 * Shared English stopword set. Single source of truth for both the channel
 * suggester (lib/suggest.ts) and the concept extractor (lib/extract-terms.ts),
 * so the two stay consistent.
 *
 * These are words too common to carry meaning on their own. In the extractor
 * they also act as phrase boundaries (RAKE-style): a run of non-stopwords
 * between two stopwords becomes a candidate concept.
 */
export const STOPWORDS = new Set<string>([
  // articles / conjunctions / prepositions
  "the", "and", "a", "an", "of", "to", "in", "for", "on", "with", "is", "it",
  "this", "that", "you", "are", "be", "as", "at", "by", "or", "if", "but",
  "not", "from", "into", "your", "our", "his", "her", "their", "they", "we",
  "i", "me", "my", "so", "do", "does", "did", "was", "were", "been", "have",
  "has", "had", "will", "would", "can", "could", "should", "about", "than",
  "then", "more", "most", "some", "any", "all", "no", "yes",
  // extra function words common in prose
  "what", "which", "who", "whom", "when", "where", "why", "how", "there",
  "here", "out", "up", "down", "over", "under", "again", "once", "also",
  "just", "very", "too", "only", "own", "same", "such", "each", "few", "both",
  "its", "him", "she", "he", "them", "us", "am", "being", "doing", "having",
  "get", "got", "make", "made", "use", "used", "using", "via", "etc",
  // web/archive noise — boilerplate that shows up in scraped page text
  "http", "https", "www", "com", "org", "net", "html", "read", "reading",
  "click", "here", "more", "article", "page", "site", "website", "blog",
  "post", "posts", "home", "menu", "search", "share", "comment", "comments",
  "subscribe", "newsletter", "cookie", "cookies", "privacy", "terms",
  // UI chrome / navigation text left over from scraped pages
  "view", "views", "image", "images", "full", "size", "press", "enter",
  "scroll", "load", "loading", "clicking", "close", "copy", "download",
  "upload", "button", "tab", "tabs", "toggle", "sign", "login", "signup",
  // social / app navigation chrome (X, Instagram, Medium, SaaS marketing, …).
  // Deliberately excludes design-vocabulary words (product, features, …) so
  // topical phrases like "product design" survive.
  "explore", "notifications", "notification", "messages", "message", "chat",
  "grok", "bookmarks", "bookmark", "premium", "profile", "following",
  "followers", "follow", "feed", "trending", "trends", "happening", "relevant",
  "reply", "replies", "repost", "retweet", "likes", "settings", "account",
  "logout", "join", "verified", "show", "showing", "see", "trial", "pricing",
  "started", "contact", "support", "help", "docs", "careers", "resources",
  "back", "next", "previous", "skip", "continue",
  // filler, determiners, vague nouns and time words
  "every", "one", "two", "three", "ago", "year", "years", "day", "days",
  "week", "weeks", "month", "months", "time", "times", "thing", "things",
  "way", "ways", "lot", "first", "last", "really", "actually", "probably",
  "maybe", "something", "someone", "anything", "everything", "nothing",
  "stuff", "part", "kind", "sort",
]);
