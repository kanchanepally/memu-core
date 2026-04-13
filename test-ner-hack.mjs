import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;

async function testNER() {
  const ner = await pipeline('token-classification', 'Xenova/bert-base-NER', { quantized: true });
  
  const text = "check if vinted folk sent robin's magma cube slime and minecraft phantom lego";
  // Title Case hack
  const casedText = text.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  
  console.log("Testing:", casedText);
  const results = await ner(casedText);
  
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
