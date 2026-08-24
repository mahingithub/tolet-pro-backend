require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI('INVALID_KEY');
async function run() {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent("hello");
    console.log(result);
  } catch (err) {
    console.error("ERROR TYPE:", err.name);
    console.error("ERROR MESSAGE:", err.message);
    console.error("ERROR STATUS:", err.status);
  }
}
run();
