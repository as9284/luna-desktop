/** A realistic desktop UA — many sites serve thin/blocked content to unknown agents. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export const ACCEPT_HTML =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'

/** Below this many characters of extracted text, the HTTP-tier result is "thin" and escalates to a render. */
export const THIN_TEXT_CHARS = 600
