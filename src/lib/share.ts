/* Share-by-URL: the buffer travels in the URL fragment — no backend, and the
 * fragment never reaches the server. The encoding (versioned base64url over
 * UTF-8, `#code=v1:…`) is byte-compatible with the language repo's reference
 * playground (web/playground/share.js), so links move freely between the two. */

const PREFIX = "code=v1:";

/** The URL fragment (without `#`) carrying `source`. */
export function encodeShare(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64url = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return PREFIX + base64url;
}

/** The source carried by a URL fragment (without `#`), or `null` if it carries
 * none / is not a recognized share encoding — a malformed fragment must never
 * break page load. */
export function decodeShare(fragment: string): string | null {
  if (!fragment.startsWith(PREFIX)) return null;
  const base64url = fragment.slice(PREFIX.length);
  try {
    const binary = atob(base64url.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
