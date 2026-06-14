require('dotenv').config();
const mongoose = require('mongoose');
const { listHostInquiries } = require('./services/inquiry.service');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  require('./models/VisitSchedule');
  
  // mock user id that exists in db
  const user = { _id: '60c72b2f9b1d8b001c8e4e1a' }; 
  
  try {
    const res = await listHostInquiries({ user });
    console.log("Success", res);
  } catch (err) {
    console.error("Error", err);
  }
  process.exit(0);
}
run();
