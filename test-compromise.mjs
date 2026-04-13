import nlp from 'compromise';

const text = "check if vinted folk sent robin's magma cube slime and minecraft phantom lego";
const doc = nlp(text);

const people = doc.people().out('array');
console.log("Extracted people:", people);
