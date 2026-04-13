import { pipeline, env } from '@xenova/transformers';

// Disable local models if they haven't been downloaded yet, so it fetches immediately
env.allowLocalModels = false;

async function testNER() {
  console.log("Loading model...");
  const ner = await pipeline('token-classification', 'Xenova/bert-base-NER', { quantized: true });
  
  console.log("Testing phrase...");
  const text = "check if vinted folk sent robin's magma cube slime and minecraft phantom lego";
  const results = await ner(text);
  
  console.log("Results:");
  console.log(JSON.stringify(results, null, 2));

  let currentName = "";
  let currentNames = [];
  for (const item of results) {
     if (item.entity === 'B-PER' || item.entity === 'I-PER') {
        if (item.word.startsWith('##')) currentName += item.word.replace('##', '');
        else currentName += (currentName ? ' ' : '') + item.word;
     } else {
        if (currentName) {
          currentNames.push(currentName);
          currentName = "";
        }
     }
  }
  if (currentName) currentNames.push(currentName);
  
  console.log("Extracted names:", currentNames);
}

testNER().catch(console.error);
