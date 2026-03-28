export async function scrapeUrlContent(url: string): Promise<string> {
  try {
     const controller = new AbortController();
     const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 sec timeout
     
     const res = await fetch(url, { 
         headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MemuBot/1.0' }, 
         signal: controller.signal 
     });
     clearTimeout(timeoutId);

     const text = await res.text();
     
     // Very basic stripping to get readable text payload for Claude
     const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
     let bodyText = bodyMatch ? bodyMatch[1] : text;
     
     bodyText = bodyText.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
     bodyText = bodyText.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
     bodyText = bodyText.replace(/<[^>]+>/g, ' '); // remove all HTML tags
     bodyText = bodyText.replace(/\s+/g, ' ').trim(); 
     
     // Truncate to save tokens (first ~3000 chars usually contains the pricing/info needed)
     bodyText = bodyText.substring(0, 3000);

     const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
     const title = titleMatch ? titleMatch[1].trim() : 'Webpage';

     return `\n[Context extracted from URL: ${title}]:\n${bodyText}\n`;
  } catch (e) {
     console.error('Failed to scrape', url, e);
     return ''; // Fail silently so chat continues
  }
}
