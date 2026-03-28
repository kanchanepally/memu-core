import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/connection';
import { translateToAnonymous, translateToReal } from '../twin/translator';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function processVisualDocumentExtraction(
  profileId: string, 
  imageBuffer: Buffer, 
  mimeType: string, 
  caption: string, 
  messageId: string
) {
  const base64Image = imageBuffer.toString('base64');
  
  // 1. Translate any text caption to anonymous space
  const anonCaption = caption ? await translateToAnonymous(caption) : '';

  // 2. Claude 3.5 Sonnet Vision Pipeline for OCR and Task Synthesis
  const systemPrompt = `You are a family Chief of Staff processing a physical document (e.g., a school newsletter, fridge calendar, or handwritten note) uploaded by a parent.
Extract every single actionable event, deadline, and task from this document into a structured JSON array.
If the document is just a casual photo with no actionable family context, return an empty array [].

JSON Schema (return an array of objects):
[
  {
    "card_type": "extraction" | "reminder" | "collision" | "shopping",
    "title": "A brief, clear title (e.g., 'School Trip Consent Due', 'Dental Appointment')",
    "body": "Detailed extraction including exact dates, times, and requirements found in the text",
    "actions": [{"label": "Action name", "type": "action_id"}]
  }
]

CRITICAL CAUTION: If the extracted item is something to buy, purchase, or procure (e.g. groceries, plants, supplies), ALWAYS categorize it strictly as "card_type": "shopping" so it bypasses the stream and plots directly onto the Shopping List. Don't use "extraction".`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { 
          role: 'user', 
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as any,
                data: base64Image,
              }
            },
            {
               type: 'text',
               text: anonCaption ? `Context from parent: ${anonCaption}` : 'Please extract all family intelligence from this document.'
            }
          ] 
        }
      ],
      temperature: 0
    });

    const replyText = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Parse JSON safely
    const jsonMatch = replyText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
       console.log(`[VISION EXTRACTION] No actionable events found in document.`);
       return;
    }
    
    const extractions: any[] = JSON.parse(jsonMatch[0]);
    if (extractions.length === 0) {
        console.log(`[VISION EXTRACTION] Parsed empty array. Ignored.`);
        return;
    }

    // Determine target Family ID (Slice 2/5 workaround mapping to Adult profile)
    const adultRes = await pool.query("SELECT id FROM profiles WHERE role = 'adult' LIMIT 1");
    const familyId = adultRes.rows.length > 0 ? adultRes.rows[0].id : profileId;

    // 3. Inject into stream_cards linearly
    for (const extraction of extractions) {
       // Attempt to restore any translated IDs if they exist in the extracted text
       // Note: Because Claude is reading raw text from an image, it usually won't contain UUIDs, 
       // but we run real translation just in case it attempts to infer names from the caption.
       const realTitle = await translateToReal(extraction.title);
       const realBody = await translateToReal(extraction.body);

       await pool.query(
         `INSERT INTO stream_cards (family_id, card_type, title, body, source, source_message_id, actions)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
         [
           familyId, 
           extraction.card_type || 'document',
           realTitle,
           realBody,
           'document',
           messageId,
           JSON.stringify(extraction.actions || [])
         ]
       );
       console.log(`[DOCUMENT STREAM CARD CREATED]: ${realTitle}`);
    }
    
    return extractions.length;
  } catch (err) {
    console.error('[VISION ERROR]', err);
    return 0;
  }
}
