require('dotenv').config();
const mongoose = require('mongoose');
const { listHostInquiries } = require('./services/inquiry.service');
const Inquiry = require('./models/Inquiry');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  require('./models/VisitSchedule');
  
  const inquiry = await Inquiry.findOne({});
  if (!inquiry) {
    console.log("No inquiries found");
    process.exit(0);
  }
  
  const user = { _id: inquiry.propertyOwnerId };
  
  try {
    const res = await listHostInquiries({ user });
    console.log("Success, returned length:", res.length);
  } catch (err) {
    console.error("Error:", err);
  }
  process.exit(0);
}
run();
